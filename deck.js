// The DJ rig: a turntable (start/stop, 33/45, pitch) and a mixer channel (BPM, EQ, flanger, level).
// The track runs through Web Audio, so everything here really changes the sound and the BPM is measured.
// Source: audio/track.mp3 if it exists (see data.js). Until then the deck plays a groove generated here in the
// browser as a stand-in. It is not Omri's music, and the turntable says so.
(function () {
  const D = window.OMRI, $ = s => document.querySelector(s);
  const NOMINAL_BPM = 122; // only used for the lights until the track has been analysed
  const RPM_DEG = 200;     // 33 1/3 rpm in degrees per second

  const audio = new Audio();
  audio.crossOrigin = 'anonymous'; audio.loop = true; audio.preload = 'auto';
  audio.preservesPitch = audio.webkitPreservesPitch = audio.mozPreservesPitch = false; // vinyl: speed bends pitch

  const st = { want: false, pitch: 0, speed: 1, rate: 0, period: 0, phase: 0, analysed: false, source: null };
  let ctx = null, analyser = null, eq = {}, fl = {}, master = null;
  let beatPos = 0, wraps = 0, lastCT = 0, angle = 0, dotAngle = 0, lastT = performance.now(), level = 0;
  const freq = new Uint8Array(1024), wave = new Uint8Array(2048);

  const DECK = window.DECK = {
    freq, wave, onState: null,
    get playing() { return st.want; },
    get bpm() { return st.analysed ? (60 / st.period) * st.rate : 0; },
    beat: () => beatPos,
    start, play() { st.want = true; sync(); }, stop() { st.want = false; sync(); }, toggle() { st.want = !st.want; sync(); }
  };

  /* ---------- Audio graph ---------- */
  async function hasTrack() { // a real mp3 wins if someone has added one
    try {
      const r = await fetch(D.track.src, { method: 'HEAD' });
      return r.ok && /audio|octet/.test(r.headers.get('content-type') || '');
    } catch (e) { return false; }
  }
  // Stand-in groove: 8 bars of house at 122 BPM, rendered offline so it loops cleanly and can be analysed like a file.
  async function renderGroove() {
    const beat = 60 / NOMINAL_BPM, bar = beat * 4, sr = 44100;
    const oc = new OfflineAudioContext(2, Math.round(bar * 8 * sr), sr);
    const comp = oc.createDynamicsCompressor(), out = oc.createGain(); out.gain.value = 0.8; out.connect(comp); comp.connect(oc.destination);
    const noise = oc.createBuffer(1, sr, sr), nd = noise.getChannelData(0); for (let i = 0; i < sr; i++) nd[i] = Math.random() * 2 - 1;
    const env = (t, peak, dur) => { const g = oc.createGain(); g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur); g.connect(out); return g; };
    const tone = (type, f, t, dur, dest) => { const o = oc.createOscillator(); o.type = type; o.frequency.value = f; o.connect(dest); o.start(t); o.stop(t + dur + 0.02); return o; };
    const hiss = (t, dur, type, f, q, peak) => {
      const s = oc.createBufferSource(), flt = oc.createBiquadFilter(); s.buffer = noise; flt.type = type; flt.frequency.value = f; flt.Q.value = q;
      s.connect(flt); flt.connect(env(t, peak, dur)); s.start(t, Math.random() * 0.5, dur + 0.02);
    };
    const lowpass = (t, from, to, dur, dest) => { const f = oc.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 4; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur); f.connect(dest); return f; };
    const ROOT = [55, 55, 43.65, 49], CHORD = [[220, 261.63, 329.63], [220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66]];
    for (let b = 0; b < 8; b++) {
      const t0 = b * bar, root = ROOT[b % 4], chord = CHORD[b % 4];
      for (let q = 0; q < 4; q++) {
        const t = t0 + q * beat;
        const k = tone('sine', 150, t, 0.34, env(t, 1, 0.34)); k.frequency.setValueAtTime(150, t); k.frequency.exponentialRampToValueAtTime(42, t + 0.13); // kick
        hiss(t + beat / 2, 0.06, 'highpass', 7500, 0.7, 0.28);                                   // off-beat hat
        if (b >= 2) hiss(t + beat / 4, 0.03, 'highpass', 9000, 0.7, 0.1), hiss(t + beat * 0.75, 0.03, 'highpass', 9000, 0.7, 0.1);
        if (q % 2 === 1) hiss(t, 0.2, 'bandpass', 1500, 0.9, 0.55);                              // clap on 2 and 4
        tone('sawtooth', root * (q === 3 ? 1.5 : 1), t + beat / 2, 0.22, lowpass(t + beat / 2, 700, 160, 0.2, env(t + beat / 2, 0.5, 0.24))); // off-beat bass
      }
      [1.75, 3.5].forEach(pos => { // syncopated chord stabs
        const t = t0 + pos * beat, f = lowpass(t, 2600, 500, 0.3, env(t, 0.13, 0.34));
        chord.forEach(n => { tone('sawtooth', n, t, 0.32, f); tone('sawtooth', n * 1.006, t, 0.32, f); });
      });
      if (b >= 4) for (let s16 = 0; s16 < 16; s16++) { // arpeggio joins for the second half
        const t = t0 + s16 * beat / 4, n = chord[[0, 1, 2, 1, 2, 0, 1, 2][s16 % 8]] * (s16 % 8 > 4 ? 4 : 2);
        tone('square', n, t, 0.1, lowpass(t, 2200, 900, 0.1, env(t, 0.045, 0.12)));
      }
    }
    return oc.startRendering();
  }
  function toWav(buf) {
    const n = buf.length, ch = buf.numberOfChannels, dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
    dv.setUint32(24, buf.sampleRate, true); dv.setUint32(28, buf.sampleRate * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, n * ch * 2, true);
    const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
    for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) dv.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 32767, true);
    return URL.createObjectURL(new Blob([dv], { type: 'audio/wav' }));
  }
  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaElementSource(audio);
    const shelf = (type, f) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; return n; };
    eq.low = shelf('lowshelf', 220); eq.mid = shelf('peaking', 1000); eq.mid.Q.value = 0.7; eq.hi = shelf('highshelf', 3600);
    // flanger: a very short delay swept by a slow LFO, fed back into itself, mixed with the dry signal
    fl.delay = ctx.createDelay(0.05); fl.delay.delayTime.value = 0.004;
    fl.wet = ctx.createGain(); fl.wet.gain.value = 0; fl.fb = ctx.createGain(); fl.fb.gain.value = 0;
    fl.lfo = ctx.createOscillator(); fl.lfo.frequency.value = 0.28; fl.depth = ctx.createGain(); fl.depth.gain.value = 0.0028;
    fl.lfo.connect(fl.depth); fl.depth.connect(fl.delay.delayTime); fl.lfo.start();
    master = ctx.createGain(); master.gain.value = 0.85;
    analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.72;
    src.connect(eq.low); eq.low.connect(eq.mid); eq.mid.connect(eq.hi);
    eq.hi.connect(master); eq.hi.connect(fl.delay); fl.delay.connect(fl.fb); fl.fb.connect(fl.delay); fl.delay.connect(fl.wet); fl.wet.connect(master);
    master.connect(analyser); analyser.connect(ctx.destination);
    applyKnobs();
  }
  async function start() { // called once from the launch gesture
    if (ctx) { st.want = true; return sync(); }
    build(); st.want = true; sync();
    const info = $('#mxInfo'); info.textContent = 'loading';
    let buf = null, title = D.track.title;
    try {
      if (await hasTrack()) { audio.src = D.track.src; sync(); buf = await ctx.decodeAudioData(await (await fetch(D.track.src)).arrayBuffer()); }
      else { buf = await renderGroove(); audio.src = toWav(buf); title = 'Demo groove, not Omri · add audio/track.mp3'; sync(); }
    } catch (e) { console.warn('deck: could not load audio', e); }
    st.source = title;
    $('#ttTitle').textContent = title;
    document.querySelectorAll('[data-track-title]').forEach(e => (e.textContent = title.split(' · ')[0]));
    if (buf) analyse(buf); else info.textContent = 'no bpm';
  }
  function sync() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
    if (st.want && audio.paused && audio.src) audio.play().catch(() => {});
    $('#rig').classList.toggle('on', st.want);
    $('#ttStart').setAttribute('aria-pressed', st.want);
    if (DECK.onState) DECK.onState(st.want);
  }

  /* ---------- BPM: measured from the audio itself ---------- */
  function analyse(buf) {
    const info = $('#mxInfo');
    try {
      const sr = buf.sampleRate, a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a;
      const hop = 512, n = Math.min(Math.floor(a.length / hop), Math.floor((150 * sr) / hop)), fps = sr / hop;
      // energy envelope, weighted towards the kick drum
      const env = new Float32Array(n), k = Math.exp((-2 * Math.PI * 180) / sr);
      let lp = 0;
      for (let i = 0, p = 0; i < n; i++) {
        let e = 0;
        for (let j = 0; j < hop; j++, p++) { const x = (a[p] + b[p]) * 0.5; lp = lp * k + x * (1 - k); e += lp * lp * 4 + x * x; }
        env[i] = Math.log(1 + e * 40);
      }
      // onsets: rises in energy above the local average
      const on = new Float32Array(n);
      for (let i = 1; i < n; i++) on[i] = Math.max(0, env[i] - env[i - 1]);
      let mean = 0; for (let i = 0; i < n; i++) mean += on[i]; mean /= n;
      for (let i = 0; i < n; i++) on[i] = Math.max(0, on[i] - mean);
      // autocorrelation of the onsets, once, for every lag we will need
      const maxLag = Math.min(n - 2, Math.ceil(((fps * 60) / 75) * 8) + 2), acf = new Float32Array(maxLag + 1);
      for (let lag = 1; lag <= maxLag; lag++) { let s = 0; for (let i = 0; i + lag < n; i++) s += on[i] * on[i + lag]; acf[lag] = s / (n - lag); }
      // a tempo is right when 1, 2, 3 ... 8 beats later the track still lines up with itself
      const score = bpm => { const L = (fps * 60) / bpm; let s = 0; for (let m = 1; m <= 8; m++) s += acf[Math.min(maxLag, Math.round(m * L))] || 0; return s; };
      let bpm = 0, best = -1;
      for (let b = 75; b <= 180; b += 0.25) { const s = score(b); if (s > best) { best = s; bpm = b; } }
      for (let b = bpm - 0.25, top = bpm + 0.25; b <= top; b += 0.01) { const s = score(b); if (s > best) { best = s; bpm = b; } }
      const P = (fps * 60) / bpm;
      // where the beat falls
      let ph = 0, phBest = -1;
      for (let f = 0; f < P; f += 0.5) { let s = 0; for (let x = f; x < n; x += P) s += on[Math.round(x)] || 0; if (s > phBest) { phBest = s; ph = f; } }
      if (!(P > 0)) throw new Error('no clear pulse found');
      st.period = P / fps; st.phase = ph / fps; st.analysed = true;
      info.textContent = 'measured';
    } catch (e) {
      console.warn('deck: analysis failed', e);
      info.textContent = 'no bpm';
    }
  }

  /* ---------- Controls ---------- */
  const knobs = { hi: 0.5, mid: 0.5, low: 0.5, fx: 0.6 };
  let fxOn = false;
  const eqDb = v => (v < 0.5 ? -26 * (1 - v * 2) : 6 * (v * 2 - 1)); // full kill at the bottom, +6 dB at the top
  function applyKnobs() {
    document.querySelectorAll('.knob').forEach(kn => {
      const v = knobs[kn.dataset.k];
      kn.style.setProperty('--r', -135 + v * 270 + 'deg'); kn.setAttribute('aria-valuenow', Math.round(v * 100));
    });
    if (!ctx) return;
    const t = ctx.currentTime;
    eq.hi.gain.setTargetAtTime(eqDb(knobs.hi), t, 0.02); eq.mid.gain.setTargetAtTime(eqDb(knobs.mid), t, 0.02); eq.low.gain.setTargetAtTime(eqDb(knobs.low), t, 0.02);
    fl.wet.gain.setTargetAtTime(fxOn ? 0.35 + knobs.fx * 0.6 : 0, t, 0.03);
    fl.fb.gain.setTargetAtTime(fxOn ? 0.3 + knobs.fx * 0.5 : 0, t, 0.03);
  }
  document.querySelectorAll('.knob').forEach(kn => {
    const key = kn.dataset.k, def = knobs[key];
    let y0 = 0, v0 = 0;
    const move = e => { knobs[key] = Math.min(1, Math.max(0, v0 + (y0 - e.clientY) / 120)); applyKnobs(); };
    kn.addEventListener('pointerdown', e => {
      e.preventDefault(); y0 = e.clientY; v0 = knobs[key]; kn.setPointerCapture(e.pointerId);
      kn.addEventListener('pointermove', move);
      kn.addEventListener('pointerup', () => kn.removeEventListener('pointermove', move), { once: true });
    });
    kn.addEventListener('dblclick', () => { knobs[key] = def; applyKnobs(); });
    kn.addEventListener('keydown', e => {
      const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.05 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.05 : 0;
      if (d) { e.preventDefault(); knobs[key] = Math.min(1, Math.max(0, knobs[key] + d)); applyKnobs(); }
    });
  });
  $('#mxFx').addEventListener('click', e => { fxOn = !fxOn; e.currentTarget.classList.toggle('on', fxOn); e.currentTarget.setAttribute('aria-pressed', fxOn); applyKnobs(); });
  $('#mxVol').addEventListener('input', e => { if (master) master.gain.setTargetAtTime(e.target.value / 100, ctx.currentTime, 0.02); });

  const pitchEl = $('#ttPitch');
  function setPitch(v) { st.pitch = v; pitchEl.value = v; $('#ttPitchOut').textContent = (v > 0 ? '+' : '') + (+v).toFixed(1) + '%'; $('#rig').classList.toggle('zero', Math.abs(v) < 0.05); }
  pitchEl.addEventListener('input', () => setPitch(Math.abs(pitchEl.value) < 0.25 ? 0 : +pitchEl.value)); // centre detent
  pitchEl.addEventListener('dblclick', () => setPitch(0));
  $('#ttStart').addEventListener('click', () => (ctx ? DECK.toggle() : start()));
  [['#tt33', 1], ['#tt45', 1.35]].forEach(([id, sp]) => $(id).addEventListener('click', () => {
    st.speed = sp; $('#tt33').classList.toggle('on', sp === 1); $('#tt45').classList.toggle('on', sp !== 1);
  }));
  setPitch(0); applyKnobs();

  /* ---------- Per-frame: platter physics, beat clock, meters ---------- */
  const record = $('#ttRecord'), dots = $('#ttDots'), bpmEl = $('#mxBpm'), leds = [...document.querySelectorAll('#mxMeter i')];
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - lastT) / 1000, 0.5); lastT = now;
    // the platter spins up and brakes like a direct-drive motor; the audio follows the platter
    const target = st.want ? st.speed * (1 + st.pitch / 100) : 0;
    st.rate += (target - st.rate) * Math.min(1, dt * (st.want ? 5.5 : 3.2));
    if (Math.abs(target - st.rate) < 0.0005) st.rate = target;
    if (audio.src) {
      if (st.rate > 0.07) audio.playbackRate = st.rate;
      else if (!st.want && !audio.paused) audio.pause();
    }
    angle = (angle + st.rate * RPM_DEG * dt) % 360;
    dotAngle = (dotAngle + (st.rate - st.speed) * RPM_DEG * dt) % 360; // under the strobe the dots only drift when off-speed
    record.style.transform = `rotate(${angle.toFixed(2)}deg)`; dots.style.transform = `rotate(${dotAngle.toFixed(2)}deg)`;

    // beat clock: locked to the measured grid once known, free-running before that
    if (st.analysed && audio.duration) {
      if (audio.currentTime < lastCT - 1) wraps++; // looped
      lastCT = audio.currentTime;
      beatPos = (audio.currentTime - st.phase + wraps * audio.duration) / st.period;
    } else beatPos += dt * st.rate * (NOMINAL_BPM / 60);

    if (analyser) {
      analyser.getByteFrequencyData(freq); analyser.getByteTimeDomainData(wave);
      let peak = 0; for (let i = 0; i < wave.length; i += 8) peak = Math.max(peak, Math.abs(wave[i] - 128));
      level = Math.max(peak / 128, level * 0.9);
    }
    const lit = Math.round(Math.min(level * 1.35, 1) * leds.length);
    leds.forEach((el, i) => el.classList.toggle('on', i < lit));
    const bpm = DECK.bpm;
    bpmEl.textContent = bpm > 1 ? bpm.toFixed(1) : '---.-';
    document.querySelectorAll('[data-track-bpm]').forEach(e => (e.textContent = bpm > 1 ? bpm.toFixed(1) + ' BPM' : st.want ? 'measuring BPM' : 'stopped'));
  }
  requestAnimationFrame(frame);
})();
