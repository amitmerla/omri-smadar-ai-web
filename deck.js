// The sound rig: a mixer channel (EQ, flanger), a stereo delay-modeller pedal with a looper, and an acid bass line synth.
// Signal path: track + synth -> mixer EQ -> flanger -> pedal -> master.
// The track runs through Web Audio, so every control here really changes what you hear, and the BPM is measured.
// Source: audio/track.mp3 if it exists (see data.js). Until then a groove generated here in the browser stands in.
// It is not Omri's music, and the transport strip says so.
(function () {
  const D = window.OMRI, $ = s => document.querySelector(s);
  const NOMINAL_BPM = 122; // only used until the track has been analysed

  const audio = new Audio();
  audio.crossOrigin = 'anonymous'; audio.loop = true; audio.preload = 'auto';

  const st = { want: false, period: 0, phase: 0, analysed: false };
  let ctx = null, analyser = null, inAn = null, master = null, pre = null, input = null, out = null, P = null, SY = null;
  const eq = {}, fl = {};
  let outLevel = 0;
  let beatPos = 0, wraps = 0, lastCT = 0, lastT = performance.now(), inLevel = 0;
  const freq = new Uint8Array(1024), wave = new Uint8Array(2048), inWave = new Uint8Array(512);

  const DECK = window.DECK = {
    freq, wave, onState: null,
    get playing() { return st.want; },
    get bpm() { return st.analysed ? 60 / st.period : 0; },
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
    input = ctx.createGain(); out = ctx.createGain(); master = ctx.createGain(); master.gain.value = 0.85;
    const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -3; limiter.ratio.value = 20; limiter.attack.value = 0.002; // runaway repeats stay safe
    analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.72;
    inAn = ctx.createAnalyser(); inAn.fftSize = 512;
    // mixer channel: three-band EQ, then a flanger (a very short delay swept by a slow LFO and fed back into itself)
    pre = ctx.createGain();
    const shelf = (type, f) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; return n; };
    eq.low = shelf('lowshelf', 220); eq.mid = shelf('peaking', 1000); eq.mid.Q.value = 0.7; eq.hi = shelf('highshelf', 3600);
    fl.delay = ctx.createDelay(0.05); fl.delay.delayTime.value = 0.004;
    fl.wet = ctx.createGain(); fl.wet.gain.value = 0; fl.fb = ctx.createGain(); fl.fb.gain.value = 0;
    fl.lfo = ctx.createOscillator(); fl.lfo.frequency.value = 0.28; fl.depth = ctx.createGain(); fl.depth.gain.value = 0.0028;
    fl.lfo.connect(fl.depth); fl.depth.connect(fl.delay.delayTime); fl.lfo.start();
    src.connect(pre); pre.connect(eq.low); eq.low.connect(eq.mid); eq.mid.connect(eq.hi);
    eq.hi.connect(input); eq.hi.connect(fl.delay); fl.delay.connect(fl.fb); fl.fb.connect(fl.delay); fl.delay.connect(fl.wet); fl.wet.connect(input);
    input.connect(inAn);
    buildPedal(); buildSynth(); applyMixer();
    out.connect(master); master.connect(limiter); limiter.connect(analyser); analyser.connect(ctx.destination);
    apply();
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
    $('#ttTitle').textContent = title;
    document.querySelectorAll('[data-track-title]').forEach(e => (e.textContent = title.split(' · ')[0]));
    if (buf) analyse(buf); else info.textContent = 'no bpm';
    if (st.analysed && T.auto) { T.beat = st.period; apply(); }
  }
  function sync() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
    if (audio.src) { if (st.want && audio.paused) audio.play().catch(() => {}); else if (!st.want && !audio.paused) audio.pause(); }
    $('#rig').classList.toggle('on', st.want);
    $('#tpPlay').setAttribute('aria-pressed', st.want);
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

  /* ---------- Knob helper shared by the mixer and the synth ---------- */
  function bindKnobs(sel, attr, vals, onChange) {
    const paintAll = () => document.querySelectorAll(sel).forEach(kn => { kn.style.setProperty('--r', -150 + vals[kn.dataset[attr]] * 300 + 'deg'); kn.setAttribute('aria-valuenow', Math.round(vals[kn.dataset[attr]] * 100)); });
    document.querySelectorAll(sel).forEach(kn => {
      const key = kn.dataset[attr], def = vals[key];
      let y0 = 0, v0 = 0;
      const setv = v => { vals[key] = Math.min(1, Math.max(0, v)); paintAll(); onChange(key); };
      const move = e => setv(v0 + (y0 - e.clientY) / 130);
      kn.addEventListener('pointerdown', e => {
        e.preventDefault(); y0 = e.clientY; v0 = vals[key]; kn.setPointerCapture(e.pointerId);
        kn.addEventListener('pointermove', move);
        kn.addEventListener('pointerup', () => kn.removeEventListener('pointermove', move), { once: true });
      });
      kn.addEventListener('dblclick', () => setv(def));
      kn.addEventListener('keydown', e => {
        const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.05 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.05 : 0;
        if (d) { e.preventDefault(); setv(vals[key] + d); }
      });
    });
    paintAll();
  }

  /* ---------- Mixer channel ---------- */
  const MXK = { hi: 0.5, mid: 0.5, low: 0.5, fx: 0.6 };
  let fxOn = false;
  const eqDb = v => (v < 0.5 ? -26 * (1 - v * 2) : 6 * (v * 2 - 1)); // full kill at the bottom, +6 dB at the top
  function applyMixer() {
    if (!ctx) return;
    const t = ctx.currentTime;
    eq.hi.gain.setTargetAtTime(eqDb(MXK.hi), t, 0.02); eq.mid.gain.setTargetAtTime(eqDb(MXK.mid), t, 0.02); eq.low.gain.setTargetAtTime(eqDb(MXK.low), t, 0.02);
    fl.wet.gain.setTargetAtTime(fxOn ? 0.35 + MXK.fx * 0.6 : 0, t, 0.03);
    fl.fb.gain.setTargetAtTime(fxOn ? 0.3 + MXK.fx * 0.5 : 0, t, 0.03);
  }
  bindKnobs('.knob.mk', 'm', MXK, applyMixer);
  $('#mxFx').addEventListener('click', e => { fxOn = !fxOn; e.currentTarget.classList.toggle('on', fxOn); e.currentTarget.setAttribute('aria-pressed', fxOn); applyMixer(); });

  /* ---------- Acid bass line: one oscillator, a resonant low-pass with its own envelope, a 16-step sequencer ---------- */
  // Each step is a pitch (semitones from C2), or a rest, with ACCENT (louder, brighter, snappier) and SLIDE (glide into
  // the next note without re-triggering). The sequencer runs on the track's measured beat grid, so it stays in time.
  const SK = { tune: 0.5, cutoff: 0.38, reso: 0.75, env: 0.6, decay: 0.35, accent: 0.7, sub: 0, slide: 0.3, attack: 0, adecay: 0.3, fm: 0, muff: 0, drive: 0.35, vol: 0.6 };
  const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const parse = str => str.split(' ').map(tok => {
    const m = tok.match(/^([A-G]#?)(\d)(a?)(s?)$/);
    return m ? { p: NOTE.indexOf(m[1]) + (m[2] - 2) * 12, a: !!m[3], s: !!m[4], r: false } : { p: 9, a: false, s: false, r: true };
  });
  const PATTERNS = [ // in A minor, to sit on the demo groove
    'A1 A1 A2 . A1 C2s A1a G1 A1 A1 E2a . A1 G1s A1 A2a',
    'A1a . A1 A2s A1 . G2a A1 . A1 C2 A1s A2a . E2 G1',
    'A1 A2 A1 A2a C2 A2 A1 E2a A1 A2 G1 G2a A1 A2 C3as A2',
    'A1a . . A1 . A1s C2 . A1a . . G1 . G1s A1 .'
  ].map(parse);
  const SQ = { run: false, pat: 0, sel: 0, wave: 'sawtooth', next: -1, q0: 0, t0: 0, shown: [], gateOpen: false };
  const pat = () => PATTERNS[SQ.pat];

  function buildSynth() {
    const g = v => { const n = ctx.createGain(); n.gain.value = v; return n; };
    SY = { osc: ctx.createOscillator(), sub: ctx.createOscillator(), oscG: g(0.5), subG: g(0), f1: ctx.createBiquadFilter(), f2: ctx.createBiquadFilter(), fm: g(0),
      vca: g(0), drive: ctx.createWaveShaper(), muff: ctx.createBiquadFilter(), vol: g(0.5), key: '' };
    SY.sub.type = 'square'; SY.f1.type = SY.f2.type = SY.muff.type = 'lowpass';
    SY.osc.connect(SY.oscG); SY.sub.connect(SY.subG); SY.oscG.connect(SY.f1); SY.subG.connect(SY.f1);
    SY.f1.connect(SY.f2); SY.f2.connect(SY.vca); SY.vca.connect(SY.drive); SY.drive.connect(SY.muff); SY.muff.connect(SY.vol); SY.vol.connect(pre);
    SY.osc.connect(SY.fm); SY.fm.connect(SY.f1.detune); SY.fm.connect(SY.f2.detune); // filter FM: the oscillator wobbles the cutoff at audio rate
    SY.osc.start(); SY.sub.start(); applySynth();
  }
  const cutHz = () => 70 * Math.pow(2, SK.cutoff * 6.6);
  function applySynth() {
    if (!SY) return;
    const t = ctx.currentTime, set = (prm, v) => prm.setTargetAtTime(v, t, 0.02);
    SY.osc.type = SQ.wave;
    set(SY.f1.Q, 0.7 + SK.reso * 17); set(SY.f2.Q, 0.7 + SK.reso * 3);
    if (!SQ.gateOpen) { set(SY.f1.frequency, cutHz()); set(SY.f2.frequency, cutHz()); }
    set(SY.subG.gain, SK.sub * 0.6); set(SY.fm.gain, SK.fm * 2400);
    set(SY.muff.frequency, 16000 * Math.pow(0.07, SK.muff)); set(SY.vol.gain, SK.vol * 0.9);
    const key = SK.drive.toFixed(2);
    if (key !== SY.key) { SY.key = key; SY.drive.curve = curve(SK.drive * 1.6, 0); }
  }
  const hz = p => 65.41 * Math.pow(2, (p + (SK.tune - 0.5) * 14) / 12);
  function playStep(i, t, dur) {
    const s = pat()[i], prev = pat()[(i + 15) % 16], slid = prev.s && !prev.r && SQ.gateOpen;
    if (s.r) { if (SQ.gateOpen) { SY.vca.gain.setTargetAtTime(0, t, 0.01); SQ.gateOpen = false; } return; }
    const f = hz(s.p), glide = 0.02 + SK.slide * 0.28;
    [[SY.osc, f], [SY.sub, f / 2]].forEach(([o, v]) => (slid ? o.frequency.setTargetAtTime(v, t, glide / 3) : o.frequency.setValueAtTime(v, t)));
    if (!slid) { // new note: the filter envelope snaps open and falls back; accents open further and fall faster
      const base = cutHz(), peak = Math.min(17000, base * Math.pow(2, SK.env * 4 + (s.a ? SK.accent * 1.6 : 0)));
      const fall = s.a ? 0.05 + SK.adecay * 0.45 : 0.08 + SK.decay * 1.5;
      [SY.f1, SY.f2].forEach(fl2 => { fl2.frequency.cancelScheduledValues(t); fl2.frequency.setValueAtTime(peak, t); fl2.frequency.setTargetAtTime(base, t, fall / 3); });
    }
    SY.vca.gain.cancelScheduledValues(t);
    SY.vca.gain.setTargetAtTime(s.a ? 0.55 + SK.accent * 0.45 : 0.55, t, 0.002 + SK.attack * 0.05);
    SQ.gateOpen = true;
    const nxt = pat()[(i + 1) % 16];
    if (!s.s || nxt.r) { SY.vca.gain.setTargetAtTime(0, t + dur * (s.s ? 1 : 0.55), 0.012); SQ.gateOpen = false; }
  }
  // sequencer clock in sixteenths: the track's beat grid while it plays, otherwise its own clock at the same tempo
  function seqPos() {
    const stepDur = (st.analysed ? st.period : 60 / NOMINAL_BPM) / 4;
    if (st.want && st.analysed && audio.duration && !audio.paused) { SQ.q0 = beatPos16(); SQ.t0 = ctx.currentTime; return [SQ.q0, stepDur]; }
    return [SQ.q0 + (ctx.currentTime - SQ.t0) / stepDur, stepDur];
  }
  const beatPos16 = () => ((audio.currentTime - st.phase + wraps * audio.duration) / st.period) * 4;
  setInterval(() => {
    if (!SQ.run || !ctx) return;
    const [q, stepDur] = seqPos();
    if (SQ.next < q - 1 || SQ.next > q + 8) SQ.next = Math.ceil(q); // (re)join the grid
    while (SQ.next < q + 0.12 / stepDur) { // schedule a little ahead so timing is sample-accurate
      const t = ctx.currentTime + Math.max(0, (SQ.next - q) * stepDur), i = ((SQ.next % 16) + 16) % 16;
      playStep(i, t, stepDur); SQ.shown.push([t, i]); SQ.next++;
    }
  }, 25);

  const NAMES = { tune: 'tuning', cutoff: 'cutoff', reso: 'resonance', env: 'env mod', decay: 'decay', accent: 'accent', sub: 'sub osc', slide: 'slide time', attack: 'soft attack', adecay: 'accent decay', fm: 'filter FM', muff: 'muffler', drive: 'overdrive', vol: 'volume' };
  const pname = s => NOTE[((s.p % 12) + 12) % 12] + (Math.floor(s.p / 12) + 2);
  let nowStep = -1;
  function paintSynth(msg) {
    const steps = $('#tdSteps').children, cur = pat()[SQ.sel];
    pat().forEach((s, i) => {
      const b = steps[i]; b.textContent = s.r ? '·' : pname(s);
      b.className = (s.r ? 'rest ' : '') + (s.a && !s.r ? 'acc ' : '') + (s.s && !s.r ? 'sld ' : '') + (i === SQ.sel ? 'sel ' : '') + (i === nowStep ? 'now' : '');
    });
    document.querySelectorAll('#tdKeys button').forEach(k => k.classList.toggle('on', !cur.r && +k.dataset.n === (cur.p === 12 ? 12 : ((cur.p % 12) + 12) % 12)));
    $('#tdDown').classList.toggle('on', !cur.r && cur.p < 0); $('#tdUp').classList.toggle('on', !cur.r && cur.p > 12);
    $('#tdAcc').classList.toggle('on', cur.a); $('#tdSlide').classList.toggle('on', cur.s); $('#tdRest').classList.toggle('on', cur.r);
    document.querySelectorAll('#td .pt').forEach(b => b.classList.toggle('on', +b.dataset.p === SQ.pat));
    $('#tdRun').setAttribute('aria-pressed', SQ.run);
    $('#tdSaw').classList.toggle('on', SQ.wave === 'sawtooth'); $('#tdSqr').classList.toggle('on', SQ.wave === 'square');
    $('#tdRead').textContent = msg || `PATTERN ${SQ.pat + 1} · STEP ${SQ.sel + 1} · ${cur.r ? 'rest' : pname(cur)}${cur.a ? ' · accent' : ''}${cur.s ? ' · slide' : ''}${SQ.run ? '' : ' · press RUN'}`;
  }
  $('#tdSteps').innerHTML = Array.from({ length: 16 }, (_, i) => `<button aria-label="Step ${i + 1}"></button>`).join('');
  [...$('#tdSteps').children].forEach((b, i) => b.addEventListener('click', () => { SQ.sel = i; paintSynth(); }));
  function audition(s) { // hear a note while the sequencer is stopped
    if (!ctx || SQ.run || s.r) return;
    const t = ctx.currentTime; SQ.gateOpen = false; playStep(SQ.sel, t, 0.25); SY.vca.gain.setTargetAtTime(0, t + 0.22, 0.02); SQ.gateOpen = false;
  }
  $('#tdKeys').addEventListener('click', e => { // a key writes the note into the selected step and moves on, like step-writing on the real thing
    const k = e.target.closest('button'); if (!k) return;
    const s = pat()[SQ.sel], n = +k.dataset.n, oct = s.r || s.p === 12 ? 0 : Math.floor(s.p / 12); // keep the step's octave
    s.r = false; s.p = n === 12 ? 12 : n + oct * 12;
    audition(s); SQ.sel = (SQ.sel + 1) % 16; paintSynth();
  });
  const edit = fn => () => { const s = pat()[SQ.sel]; fn(s); audition(s); paintSynth(); };
  $('#tdDown').addEventListener('click', edit(s => { if (!s.r) s.p = Math.max(-12, s.p - 12); }));
  $('#tdUp').addEventListener('click', edit(s => { if (!s.r) s.p = Math.min(24, s.p + 12); }));
  $('#tdAcc').addEventListener('click', edit(s => { s.a = !s.a; }));
  $('#tdSlide').addEventListener('click', edit(s => { s.s = !s.s; }));
  $('#tdRest').addEventListener('click', edit(s => { s.r = !s.r; }));
  document.querySelectorAll('#td .pt').forEach(b => b.addEventListener('click', () => { SQ.pat = +b.dataset.p; paintSynth(); }));
  $('#tdRnd').addEventListener('click', () => { // random acid line in A minor pentatonic
    const scale = [-3, 0, 2, 4, 7, 9, 12, 14, 16, 19];
    PATTERNS[SQ.pat] = Array.from({ length: 16 }, (_, i) => ({ p: Math.random() < 0.45 ? -3 : scale[Math.floor(Math.random() * scale.length)], a: Math.random() < 0.28, s: Math.random() < 0.25, r: i % 4 !== 0 && Math.random() < 0.18 }));
    paintSynth();
  });
  $('#tdClr').addEventListener('click', () => { PATTERNS[SQ.pat] = Array.from({ length: 16 }, () => ({ p: -3, a: false, s: false, r: true })); SQ.sel = 0; paintSynth(); });
  $('#tdRun').addEventListener('click', () => {
    if (!ctx) return start().then(() => $('#tdRun').click());
    SQ.run = !SQ.run; SQ.next = -1e9;
    if (SQ.run) { const [q] = seqPos(); SQ.q0 = q; SQ.t0 = ctx.currentTime; }
    else { SY.vca.gain.cancelScheduledValues(ctx.currentTime); SY.vca.gain.setTargetAtTime(0, ctx.currentTime, 0.02); SQ.gateOpen = false; SQ.shown = []; nowStep = -1; }
    paintSynth();
  });
  $('#tdSaw').addEventListener('click', () => { SQ.wave = 'sawtooth'; applySynth(); paintSynth(); });
  $('#tdSqr').addEventListener('click', () => { SQ.wave = 'square'; applySynth(); paintSynth(); });
  bindKnobs('.knob.sk', 's', SK, key => { applySynth(); paintSynth(`${NAMES[key].toUpperCase()} ${Math.round(SK[key] * 100)}`); });
  paintSynth();

  /* ---------- The pedal: one stereo delay engine, voiced 30 ways ---------- */
  // Two delay lines (A and B). Each line's repeats pass through a high-pass, a low-pass and a saturator/bit-crusher,
  // then feed back into itself and/or across into the other line. LFOs wobble the delay times and sweep the filters.
  // A small audio worklet in front of the lines does what plain delay nodes can't: reverse, pitch-shift and glitch.
  const GRAIN = `class G extends AudioWorkletProcessor {
    static get parameterDescriptors() { return ['mode', 'len', 'ratio'].map((name, i) => ({ name, defaultValue: [0, 0.4, 1][i], automationRate: 'k-rate' })); }
    constructor() { super(); this.N = (sampleRate * 6) | 0; this.b = [new Float32Array(this.N), new Float32Array(this.N)]; this.w = 0; this.p = 0; this.flag = [1, 1]; }
    process(inp, outp, par) {
      const i0 = inp[0], o = outp[0]; if (!o || o.length < 2) return true;
      const mode = par.mode[0] | 0, ratio = par.ratio[0], N = this.N, n = o[0].length, b = this.b;
      // pitch uses short fixed grains; reverse and glitch use slices as long as the delay time
      const seg = mode === 2 ? Math.round(sampleRate * 0.09) : Math.max(64, Math.min((N >> 1) - 2, Math.round(par.len[0] * sampleRate)));
      const half = seg >> 1;
      for (let s = 0; s < n; s++) {
        const l = i0[0] ? i0[0][s] : 0, r = i0[1] ? i0[1][s] : l;
        b[0][this.w] = l; b[1][this.w] = r;
        if (mode === 0) { o[0][s] = l; o[1][s] = r; }
        else {
          let a0 = 0, a1 = 0;
          for (let h = 0; h < 2; h++) { // two overlapping read heads, cross-faded so slices join without clicks
            const ph = (this.p + h * half) % seg;
            if (mode === 3 && ph === 0) this.flag[h] = Math.random() < 0.6 ? 1 : 0; // glitch: some slices play backwards, some pass
            const win = Math.sin((Math.PI * ph) / seg) ** 2;
            const off = mode === 2 ? (ratio > 1 ? (seg - ph) * (ratio - 1) : ph * (1 - ratio)) : mode === 3 && !this.flag[h] ? 0 : 2 * ph;
            const pos = this.w - off, i = Math.floor(pos), f = pos - i, x = ((i % N) + N) % N, y = (x + 1) % N;
            a0 += win * (b[0][x] * (1 - f) + b[0][y] * f); a1 += win * (b[1][x] * (1 - f) + b[1][y] * f);
          }
          o[0][s] = a0; o[1][s] = a1;
        }
        this.w = (this.w + 1) % N; this.p = (this.p + 1) % seg;
      }
      return true;
    }
  }
  registerProcessor('pedal-grain', G);`;

  function buildPedal() {
    const g = v => { const n = ctx.createGain(); n.gain.value = v; return n; };
    P = { dry: g(1), send: g(0), feed: g(1), duck: g(1), wet: g(0), verbSend: g(0), loop: g(1), lines: [], grain: null, curve: '' };
    input.connect(P.dry); P.dry.connect(out); input.connect(P.send); P.send.connect(P.feed);
    P.lfo = ctx.createOscillator(); P.sweep = ctx.createOscillator(); P.lfo.start(); P.sweep.start();
    for (let i = 0; i < 2; i++) {
      const L = { in: g(i ? 0 : 1), delay: ctx.createDelay(5), hp: ctx.createBiquadFilter(), lp: ctx.createBiquadFilter(), shaper: ctx.createWaveShaper(), self: g(0), cross: g(0), pan: ctx.createStereoPanner(), mod: g(0), swp: g(0) };
      L.hp.type = 'highpass'; L.lp.type = 'lowpass';
      P.feed.connect(L.in); L.in.connect(L.delay); L.delay.connect(L.hp); L.hp.connect(L.lp); L.lp.connect(L.shaper);
      L.shaper.connect(L.self); L.self.connect(L.delay);
      L.shaper.connect(L.pan); L.pan.connect(P.duck); L.shaper.connect(P.verbSend);
      P.lfo.connect(L.mod); L.mod.connect(L.delay.delayTime); P.sweep.connect(L.swp); L.swp.connect(L.lp.detune);
      P.lines.push(L);
    }
    P.lines.forEach((L, i) => { L.shaper.connect(L.cross); L.cross.connect(P.lines[1 - i].delay); });
    // reverb tail for the "delay into reverb" models: decaying stereo noise as the impulse response
    const ir = ctx.createBuffer(2, ctx.sampleRate * 2.4, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2); }
    P.verb = ctx.createConvolver(); P.verb.buffer = ir; P.verbSend.connect(P.verb); P.verb.connect(P.duck);
    P.duck.connect(P.wet); P.wet.connect(out); P.loop.connect(out);
    ctx.audioWorklet && ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([GRAIN], { type: 'text/javascript' }))).then(() => {
      P.grain = new AudioWorkletNode(ctx, 'pedal-grain', { outputChannelCount: [2] });
      P.send.disconnect(); P.send.connect(P.grain); P.grain.connect(P.feed); apply();
    }).catch(e => console.warn('pedal: reverse/pitch models unavailable', e));
    // the looper listens to the pedal input
    P.tap = ctx.createScriptProcessor(2048, 2, 2); const mute = g(0);
    input.connect(P.tap); P.tap.connect(mute); mute.connect(ctx.destination);
    P.tap.onaudioprocess = e => { if (LP.rec) LP.rec.chunks.push([e.inputBuffer.getChannelData(0).slice(), e.inputBuffer.getChannelData(1).slice()]); };
  }

  // What every model starts from; each model overrides a few of these from its TWEAK (a) and TWEEZ (b) knobs.
  const BASE = { tB: 1, sendB: 0, fbB: 1, cross: 0, panA: 0, panB: 0, lp: 16000, hp: 20, q: 0.7, drive: 0, bits: 0, modRate: 0.5, modDepth: 0, sweepRate: 0.2, sweep: 0, duck: 0, swell: 0, verb: 0, grain: 0, ratio: 1, timeScale: 1, fbScale: 1 };
  const M = (n, tw, tz, v) => ({ n, tw, tz, v });
  const pick = (a, list) => list[Math.min(list.length - 1, Math.floor(a * list.length))];
  const semi = s => Math.pow(2, s / 12);
  // Selector positions clockwise from LOOPER, as on the panel: [new model, legacy model]
  const POS = [
    null,
    [M('Heliosphere', 'reverb', 'shimmer mod', (a, b) => ({ verb: 0.15 + a * 0.75, lp: 7000, modRate: 0.5, modDepth: b * 0.003 })),
     M('Tube Echo', 'wow & flutter', 'drive', (a, b) => ({ lp: 4500, hp: 100, drive: 0.2 + b * 0.75, modRate: 1.1, modDepth: a * 0.004 }))],
    [M('Transistor', 'wow & flutter', 'drive', (a, b) => ({ lp: 3200, hp: 140, drive: 0.4 + b * 0.6, modRate: 0.9, modDepth: a * 0.004 })),
     M('Tape Echo', 'bass', 'treble', (a, b) => ({ lp: 1500 + b * 6500, hp: 320 - a * 280, drive: 0.22, modRate: 0.7, modDepth: 0.0007 }))],
    [M('Cosmos', 'wow & flutter', 'spring reverb', (a, b) => ({ sendB: 1, tB: 0.5, lp: 4000, hp: 90, drive: 0.25, verb: b * 0.7, modRate: 0.8, modDepth: a * 0.003 })),
     M('Multi-Head', 'head spacing', 'head 2 repeats', (a, b) => ({ sendB: 1, tB: pick(a, [0.25, 1 / 3, 0.5, 2 / 3, 0.75]), fbB: b, lp: 5000, drive: 0.2 }))],
    [M('Multi Pass', 'tap spacing', 'band', (a, b) => ({ sendB: 1, tB: pick(a, [1 / 3, 0.5, 2 / 3, 0.75]), hp: 200 + b * 900, lp: 1500 + b * 5000, q: 2, panA: -0.6, panB: 0.6 })),
     M('Sweep', 'sweep speed', 'sweep depth', (a, b) => ({ lp: 1300, q: 6, sweepRate: 0.05 + a * 4, sweep: b * 2600 }))],
    [M('Adriatic', 'mod speed', 'mod depth', (a, b) => ({ lp: 3000, drive: 0.2, modRate: 0.2 + a * 4, modDepth: b * 0.005 })),
     M('Analog', 'bass', 'treble', (a, b) => ({ lp: 1200 + b * 3200, hp: 40 + (1 - a) * 300, drive: 0.25 }))],
    [M('Elephant Man', 'chorus / vibrato', 'depth', (a, b) => ({ lp: 2800, drive: 0.35, modRate: a < 0.5 ? 0.4 + a * 2 : 3 + a * 5, modDepth: b * 0.005 })),
     M('Analog Mod', 'mod speed', 'mod depth', (a, b) => ({ lp: 2600, drive: 0.2, modRate: 0.2 + a * 5, modDepth: b * 0.006 }))],
    [M('Glitch', 'tone', 'crush', (a, b) => ({ grain: 3, lp: 2000 + a * 12000, bits: b > 0.05 ? 12 - b * 8 : 0 })),
     M('Lo Res Delay', 'tone', 'bit depth', (a, b) => ({ lp: 1500 + a * 8000, bits: 12 - b * 9 }))],
    [M('Vintage Digital', 'mod speed', 'mod depth', (a, b) => ({ bits: 10, lp: 8000, modRate: 0.2 + a * 4, modDepth: b * 0.003 })),
     M('Digital', 'bass', 'treble', (a, b) => ({ lp: 2000 + b * 14000, hp: 20 + (1 - a) * 380 }))],
    [M('Crisscross', 'right time', 'tone', (a, b) => ({ sendB: 1, cross: 1, tB: 0.25 + a * 0.75, panA: -1, panB: 1, lp: 2000 + b * 12000 })),
     M('Digital w/ Mod', 'mod speed', 'mod depth', (a, b) => ({ modRate: 0.1 + a * 5, modDepth: b * 0.004 }))],
    [M('Euclidean', 'pattern', 'tone', (a, b) => ({ sendB: 1, cross: 0.5, tB: pick(a, [3 / 8, 5 / 8, 3 / 4, 5 / 4]), panA: -0.5, panB: 0.5, lp: 2500 + b * 11000 })),
     M('Echo Platter', 'wow & flutter', 'drive', (a, b) => ({ lp: 3500, hp: 150, drive: 0.3 + b * 0.5, modRate: 0.8, modDepth: a * 0.003 }))],
    [M('Dual Delay', 'right time', 'right repeats', (a, b) => ({ sendB: 1, tB: 0.1 + a * 0.9, fbB: b, panA: -1, panB: 1 })),
     M('Stereo', 'right time', 'right repeats', (a, b) => ({ sendB: 1, tB: 0.25 + a, fbB: b, panA: -1, panB: 1 }))],
    [M('Pitch Echo', 'interval', 'tone', (a, b) => ({ grain: 2, ratio: semi(pick(a, [-12, -7, -5, 5, 7, 12])), lp: 2500 + b * 11000 })),
     M('Ping Pong', 'right time', 'stereo spread', (a, b) => ({ cross: 1, tB: 0.25 + a * 0.75, panA: -b, panB: b }))],
    [M('ADT', 'wobble depth', 'wobble speed', (a, b) => ({ timeScale: 0.03, fbScale: 0.15, modDepth: 0.0005 + a * 0.004, modRate: 0.3 + b * 4, panA: -0.7, sendB: 1, tB: 1.4, panB: 0.7 })),
     M('Reverse', 'mod depth', 'mod speed', (a, b) => ({ grain: 1, modDepth: a * 0.003, modRate: 0.2 + b * 3 }))],
    [M('Ducked', 'ducking', 'tone', (a, b) => ({ duck: 0.4 + a * 0.6, lp: 2500 + b * 12000 })),
     M('Dynamic', 'ducking', 'tone', (a, b) => ({ duck: a, lp: 2500 + b * 12000 }))],
    [M('Harmony', 'interval', 'tone', (a, b) => ({ grain: 2, ratio: semi(pick(a, [-12, 3, 4, 5, 7, 12])), fbScale: 0.6, lp: 3000 + b * 10000 })),
     M('Auto-Vol', 'swell time', 'mod depth', (a, b) => ({ swell: 0.05 + a, modRate: 0.6, modDepth: b * 0.003 }))]
  ];
  const SUBDIV = [['1/16', 0.25], ['1/8T', 1 / 3], ['1/8', 0.5], ['1/8.', 0.75], ['1/4', 1], ['1/4.', 1.5], ['1/2', 2]];

  // Panel state. K = the five knobs (0..1). T = tempo: synced to a beat (tapped, or the track's) or free.
  const K = { time: 0.5, repeats: 0.45, tweak: 0.33, tweez: 1, mix: 0.35 };
  const T = { sync: true, sub: 3, beat: 60 / NOMINAL_BPM, auto: true };
  const SEL = { pos: 12, legacy: true, active: 'A' };
  const PRESETS = {
    A: { pos: 12, legacy: true, sync: true, sub: 3, time: 0.5, repeats: 0.45, tweak: 0.33, tweez: 1, mix: 0.35 },   // Ping Pong, dotted eighths
    B: { pos: 2, legacy: true, sync: true, sub: 4, time: 0.67, repeats: 0.55, tweak: 0.5, tweez: 0.4, mix: 0.4 },   // Tape Echo, quarters
    C: { pos: 13, legacy: true, sync: true, sub: 6, time: 1, repeats: 0.2, tweak: 0.3, tweez: 0.3, mix: 0.5 }       // Reverse, half notes
  };
  try { Object.assign(PRESETS, JSON.parse(localStorage.getItem('omri-pedal')) || {}); } catch (e) {}
  let cfg = BASE;
  const looper = () => SEL.pos === 0;
  const model = () => POS[SEL.pos][SEL.legacy ? 1 : 0];
  const delayTime = () => (T.sync ? SUBDIV[T.sub][1] * T.beat : 0.02 * Math.pow(100, K.time));

  function curve(drive, bits) { // saturation, then optional bit-crush staircase
    const n = 2048, c = new Float32Array(n), k = 1 + drive * 6, lv = bits ? Math.pow(2, bits - 1) : 0;
    for (let i = 0; i < n; i++) { let x = (i / (n - 1)) * 2 - 1; if (drive) x = Math.tanh(x * k) / Math.tanh(k); c[i] = lv ? Math.round(x * lv) / lv : x; }
    return c;
  }
  function apply() {
    paint();
    if (!P) return;
    const t = ctx.currentTime, set = (param, v, tc = 0.03) => param.setTargetAtTime(v, t, tc);
    const on = SEL.active && !looper();
    cfg = on ? { ...BASE, ...model().v(K.tweak, K.tweez) } : BASE;
    const time = Math.min(4.8, Math.max(0.002, delayTime() * cfg.timeScale)), fb = K.repeats * 1.02 * cfg.fbScale, [A, B] = P.lines;
    set(A.delay.delayTime, time, 0.07); set(B.delay.delayTime, Math.min(4.8, time * cfg.tB), 0.07); // times glide, so turning TIME bends the repeats
    set(A.self.gain, fb * (1 - cfg.cross)); set(B.self.gain, fb * (1 - cfg.cross) * cfg.fbB);
    set(A.cross.gain, fb * cfg.cross); set(B.cross.gain, fb * cfg.cross);
    set(B.in.gain, cfg.sendB); set(A.pan.pan, cfg.panA); set(B.pan.pan, cfg.panB);
    P.lines.forEach(L => { set(L.lp.frequency, cfg.lp); set(L.hp.frequency, cfg.hp); set(L.lp.Q, cfg.q); set(L.mod.gain, cfg.modDepth); set(L.swp.gain, cfg.sweep); });
    set(P.lfo.frequency, cfg.modRate); set(P.sweep.frequency, cfg.sweepRate); set(P.verbSend.gain, cfg.verb);
    const key = cfg.drive.toFixed(2) + '/' + Math.round(cfg.bits);
    if (key !== P.curve) { P.curve = key; const c = curve(cfg.drive, Math.round(cfg.bits)); P.lines.forEach(L => (L.shaper.curve = c)); }
    if (P.grain) { const gp = P.grain.parameters; gp.get('mode').value = cfg.grain; gp.get('len').value = time; gp.get('ratio').value = cfg.ratio; }
    if (!cfg.swell) set(P.send.gain, on ? 1 : 0);
    // MIX: dry stays full up to noon, then fades while the echoes stay full
    set(P.wet.gain, on ? Math.min(1, K.mix * 2) : 0, 0.05); set(P.dry.gain, on ? Math.min(1, (1 - K.mix) * 2) : 1, 0.05);
  }

  /* ---------- Looper (selector at LOOPER): A record / overdub, B play / stop, C play once, TAP half speed, double TAP reverse ---------- */
  const LP = { state: 'empty', len: 0, layers: [], srcs: [], t0: 0, half: false, rev: false, rec: null, once: 0 };
  const lpRate = () => (LP.half ? 0.5 : 1);
  const lpPos = () => (((ctx.currentTime - LP.t0) * lpRate()) % LP.len + LP.len) % LP.len;
  function lpStopSrc() { LP.srcs.forEach(s => { try { s.stop(); } catch (e) {} }); LP.srcs = []; clearTimeout(LP.once); }
  function lpSource(layer, loop, offset) {
    const s = ctx.createBufferSource(); s.buffer = LP.rev ? layer.rev : layer.fwd; s.loop = loop; s.playbackRate.value = lpRate();
    s.connect(P.loop); s.start(0, offset || 0); LP.srcs.push(s);
  }
  function lpPlay(loop = true) {
    lpStopSrc(); LP.t0 = ctx.currentTime; LP.layers.forEach(l => lpSource(l, loop)); LP.state = 'play';
    if (!loop) LP.once = setTimeout(() => { LP.state = 'stop'; lpStopSrc(); paint(); }, (LP.len / lpRate()) * 1000);
  }
  function lpLayer(chunks, len, at) { // lay the recording into a loop-length buffer, starting where the loop was when recording began
    const sr = ctx.sampleRate, n = Math.round(len * sr), fwd = ctx.createBuffer(2, n, sr), rev = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = fwd.getChannelData(c), r = rev.getChannelData(c); let w = Math.round(at * sr), count = 0;
      for (const ch of chunks) for (let i = 0; i < ch[c].length && count < n; i++, count++) { d[w % n] += ch[c][i]; w++; }
      const fade = Math.min(400, n >> 1); for (let i = 0; i < fade && at === 0; i++) { d[i] *= i / fade; d[n - 1 - i] *= i / fade; } // no click at the loop point
      for (let i = 0; i < n; i++) r[i] = d[n - 1 - i];
    }
    return { fwd, rev };
  }
  function lpEndRec() {
    const rec = LP.rec; LP.rec = null; if (!rec || !rec.chunks.length) { LP.state = LP.layers.length ? 'play' : 'empty'; return; }
    if (!LP.layers.length) { LP.len = Math.min(30, ctx.currentTime - rec.t); LP.layers = [lpLayer(rec.chunks, LP.len, 0)]; lpPlay(); }
    else { const layer = lpLayer(rec.chunks, LP.len, rec.at); LP.layers.push(layer); lpSource(layer, true, LP.rev ? LP.len - lpPos() : lpPos()); LP.state = 'play'; }
  }
  function lpSwitch(k, dbl) {
    if (!ctx) return;
    if (k === 'A') {
      if (LP.state === 'rec' || LP.state === 'dub') lpEndRec();
      else if (LP.state === 'play') { LP.rec = { chunks: [], t: ctx.currentTime, at: lpPos() }; LP.state = 'dub'; }
      else { lpStopSrc(); LP.layers = []; LP.rec = { chunks: [], t: ctx.currentTime, at: 0 }; LP.state = 'rec'; }
    } else if (k === 'B') {
      if (LP.rec) lpEndRec(); else if (LP.state === 'play') { lpStopSrc(); LP.state = 'stop'; } else if (LP.layers.length) lpPlay();
    } else if (k === 'C') { if (LP.rec) lpEndRec(); if (LP.layers.length) lpPlay(false); }
    else if (k === 'TAP') { if (dbl) { LP.rev = !LP.rev; LP.half = !LP.half; } else LP.half = !LP.half; if (LP.state === 'play') lpPlay(); }
    paint();
  }

  /* ---------- Panel: knobs, selector, footswitches ---------- */
  const read = $('#pdRead'), selKnob = $('#pdSel');
  // model names around the selector, legacy in green
  $('#pdLabels').innerHTML = POS.map((p, i) => {
    const a = ((195 + i * 22.5) * Math.PI) / 180, x = 50 + Math.sin(a) * 15, y = 48 - Math.cos(a) * 42, side = Math.sin(a) < 0 ? 'l' : 'r';
    const txt = !p ? 'LOOPER' : side === 'l' ? `<u>${p[1].n}</u> ${p[0].n}` : `${p[0].n} <u>${p[1].n}</u>`;
    return `<span class="${side}" data-i="${i}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%">${txt}</span>`;
  }).join('');
  function paint() {
    document.querySelectorAll('#rig .knob[data-k]').forEach(kn => { kn.style.setProperty('--r', -150 + K[kn.dataset.k] * 300 + 'deg'); kn.setAttribute('aria-valuenow', Math.round(K[kn.dataset.k] * 100)); });
    selKnob.style.setProperty('--r', 195 + SEL.pos * 22.5 + 'deg');
    document.querySelectorAll('#pdLabels span').forEach(s => s.classList.toggle('on', +s.dataset.i === SEL.pos));
    $('#pdAlt').setAttribute('aria-pressed', SEL.legacy); $('#rig').classList.toggle('legacy', SEL.legacy);
    const led = (k, c) => { $('#fs' + k).dataset.led = c || ''; };
    if (looper()) {
      led('A', LP.state === 'rec' || LP.state === 'dub' ? 'red' : ''); led('B', LP.state === 'play' ? 'green' : ''); led('C', ''); led('TAP', LP.half ? 'red' : '');
      read.textContent = `LOOPER · ${{ empty: 'empty: press A to record', rec: 'recording: press A or B to close the loop', dub: 'overdubbing', play: `playing ${LP.layers.length} layer${LP.layers.length > 1 ? 's' : ''}`, stop: 'stopped' }[LP.state]}${LP.half ? ' · ½ speed' : ''}${LP.rev ? ' · reverse' : ''}`;
    } else {
      ['A', 'B', 'C'].forEach(k => led(k, SEL.active === k ? 'green' : ''));
      const m = model(), ms = Math.round(delayTime() * (SEL.active ? { ...BASE, ...m.v(K.tweak, K.tweez) }.timeScale : 1) * 1000);
      read.textContent = SEL.active
        ? `${m.n.toUpperCase()} · ${T.sync ? SUBDIV[T.sub][0] + ' · ' : ''}${ms} ms · TWEAK ${m.tw} · TWEEZ ${m.tz}`
        : 'BYPASSED · press A, B or C';
    }
  }
  const touch = apply; // knobs edit the live sound; hold a footswitch to store it

  document.querySelectorAll('#rig .knob[data-k]').forEach(kn => {
    const key = kn.dataset.k;
    let y0 = 0, v0 = 0;
    const setv = v => {
      K[key] = Math.min(1, Math.max(0, v));
      if (key === 'time') { if (T.sync) T.sub = Math.round(K.time * (SUBDIV.length - 1)); }
      touch();
    };
    const move = e => setv(v0 + (y0 - e.clientY) / 130);
    kn.addEventListener('pointerdown', e => {
      e.preventDefault(); y0 = e.clientY; v0 = K[key]; kn.setPointerCapture(e.pointerId);
      kn.addEventListener('pointermove', move);
      kn.addEventListener('pointerup', () => kn.removeEventListener('pointermove', move), { once: true });
    });
    if (key === 'time') kn.addEventListener('dblclick', () => { T.sync = !T.sync; if (T.sync) T.sub = Math.round(K.time * (SUBDIV.length - 1)); touch(); }); // synced subdivisions <-> free milliseconds
    kn.addEventListener('keydown', e => {
      const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.05 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.05 : 0;
      if (d) { e.preventDefault(); setv(K[key] + d); }
    });
  });
  function setPos(i) { SEL.pos = ((i % 16) + 16) % 16; if (!looper() && !SEL.active) SEL.active = 'A'; apply(); }
  { // selector: click steps to the next model, drag turns it
    let y0 = 0, p0 = 0, moved = false;
    const move = e => { const d = Math.round((y0 - e.clientY) / 16); if (d) moved = true; if (p0 + d !== SEL.pos) setPos(p0 + d); };
    selKnob.addEventListener('pointerdown', e => {
      e.preventDefault(); y0 = e.clientY; p0 = SEL.pos; moved = false; selKnob.setPointerCapture(e.pointerId);
      selKnob.addEventListener('pointermove', move);
      selKnob.addEventListener('pointerup', () => { selKnob.removeEventListener('pointermove', move); if (!moved) setPos(SEL.pos + 1); }, { once: true });
    });
    selKnob.addEventListener('keydown', e => { const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0; if (d) { e.preventDefault(); setPos(SEL.pos + d); } });
    $('#pdLabels').addEventListener('click', e => { const s = e.target.closest('span'); if (s) setPos(+s.dataset.i); });
  }
  $('#pdAlt').addEventListener('click', () => { SEL.legacy = !SEL.legacy; apply(); });

  // footswitches: press = recall the preset (or bypass if it is already on); hold = store the current panel there
  function recall(k) { const p = PRESETS[k]; SEL.pos = p.pos; SEL.legacy = p.legacy; T.sync = p.sync; T.sub = p.sub; ['time', 'repeats', 'tweak', 'tweez', 'mix'].forEach(n => (K[n] = p[n])); SEL.active = k; apply(); }
  function store(k) {
    PRESETS[k] = { pos: SEL.pos, legacy: SEL.legacy, sync: T.sync, sub: T.sub, ...K }; SEL.active = k;
    try { localStorage.setItem('omri-pedal', JSON.stringify(PRESETS)); } catch (e) {}
    const b = $('#fs' + k); b.classList.add('saved'); setTimeout(() => b.classList.remove('saved'), 700); apply();
  }
  ['A', 'B', 'C'].forEach(k => {
    const b = $('#fs' + k); let timer = 0, held = false;
    b.addEventListener('pointerdown', () => { held = false; if (!looper()) timer = setTimeout(() => { held = true; store(k); }, 700); });
    ['pointerup', 'pointerleave'].forEach(ev => b.addEventListener(ev, () => clearTimeout(timer)));
    b.addEventListener('click', () => {
      if (held) return;
      if (looper()) return lpSwitch(k);
      if (SEL.active === k) { SEL.active = null; apply(); } else recall(k);
    });
  });
  { // TAP: tap a tempo; hold to lock back onto the track's measured tempo
    const b = $('#fsTAP'); let taps = [], timer = 0, held = false, last = 0;
    b.addEventListener('pointerdown', () => {
      held = false;
      if (!looper()) timer = setTimeout(() => { held = true; T.auto = true; T.sync = true; T.beat = st.analysed ? st.period : 60 / NOMINAL_BPM; apply(); }, 700);
    });
    ['pointerup', 'pointerleave'].forEach(ev => b.addEventListener(ev, () => clearTimeout(timer)));
    b.addEventListener('click', () => {
      if (held) return;
      const now = performance.now(), dbl = now - last < 350; last = now;
      if (looper()) return lpSwitch('TAP', dbl);
      taps = taps.filter(x => now - x < 2500); taps.push(now);
      if (taps.length > 1) { T.beat = Math.min(2.4, (now - taps[0]) / (taps.length - 1) / 1000); T.sync = true; T.auto = false; apply(); }
    });
  }
  $('#tpPlay').addEventListener('click', () => (ctx ? DECK.toggle() : start()));
  $('#mxVol').addEventListener('input', e => { if (master) master.gain.setTargetAtTime(e.target.value / 100, ctx.currentTime, 0.02); });
  paint();

  /* ---------- Per-frame: beat clock, ducking and swell, tempo light ---------- */
  const bpmEl = $('#mxBpm'), tapEl = $('#fsTAP'), leds = [...document.querySelectorAll('#mxMeter i')];
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - lastT) / 1000, 0.5); lastT = now;
    // beat clock: locked to the measured grid once known, free-running before that
    if (st.analysed && audio.duration) {
      if (audio.currentTime < lastCT - 1) wraps++; // looped
      lastCT = audio.currentTime;
      beatPos = (audio.currentTime - st.phase + wraps * audio.duration) / st.period;
    } else if (st.want) beatPos += dt * (NOMINAL_BPM / 60);

    if (analyser) {
      analyser.getByteFrequencyData(freq); analyser.getByteTimeDomainData(wave);
      let op = 0; for (let i = 0; i < wave.length; i += 8) op = Math.max(op, Math.abs(wave[i] - 128));
      outLevel = Math.max(op / 128, outLevel * 0.9);
      const lit = Math.round(Math.min(outLevel * 1.35, 1) * leds.length);
      leds.forEach((el, i) => el.classList.toggle('on', i < lit));
      // light the sequencer step that is sounding right now
      let cur = nowStep; while (SQ.shown.length && SQ.shown[0][0] <= ctx.currentTime) cur = SQ.shown.shift()[1];
      if (cur !== nowStep) { nowStep = cur; [...$('#tdSteps').children].forEach((b, i) => b.classList.toggle('now', i === nowStep)); }
      inAn.getByteTimeDomainData(inWave);
      let peak = 0; for (let i = 0; i < inWave.length; i += 4) peak = Math.max(peak, Math.abs(inWave[i] - 128));
      inLevel = Math.max(peak / 128, inLevel * 0.9);
      const t = ctx.currentTime;
      // Ducked / Dynamic: echoes drop while the track is loud and bloom in the gaps
      P.duck.gain.setTargetAtTime(1 - cfg.duck * Math.min(1, inLevel * 1.8), t, 0.06);
      // Auto-Vol: the input to the echoes swells in after each hit
      if (cfg.swell) P.send.gain.setTargetAtTime(inLevel > 0.2 ? 1 : 0, t, inLevel > 0.2 ? cfg.swell * 0.5 : 0.03);
      if (!looper()) tapEl.dataset.led = SEL.active && (t % delayTime()) / delayTime() < 0.16 ? 'red' : '';
    }
    const bpm = DECK.bpm;
    bpmEl.textContent = bpm > 1 ? bpm.toFixed(1) : '---.-';
    document.querySelectorAll('[data-track-bpm]').forEach(e => (e.textContent = bpm > 1 ? bpm.toFixed(1) + ' BPM' : st.want ? 'measuring BPM' : 'stopped'));
  }
  requestAnimationFrame(frame);
})();
