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
  audio.preservesPitch = audio.webkitPreservesPitch = false; // so the BRAKE effect drops in pitch like vinyl

  const st = { want: false, period: 0, phase: 0, analysed: false };
  let ctx = null, analyser = null, inAn = null, master = null, pre = null, input = null, out = null, P = null, SY = null;
  const eq = {}, fl = {}, X = {}; // X: the mixer's effect nodes
  let trackBuf = null;
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
    // mixer channel: three-band EQ, then the effect section (see "Mixer effects" below)
    pre = ctx.createGain();
    const shelf = (type, f) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; return n; };
    eq.low = shelf('lowshelf', 220); eq.mid = shelf('peaking', 1000); eq.mid.Q.value = 0.7; eq.hi = shelf('highshelf', 3600);
    src.connect(pre); pre.connect(eq.low); eq.low.connect(eq.mid); eq.mid.connect(eq.hi);
    buildFx(eq.hi);
    input.connect(inAn);
    buildPedal(); buildSynth(); buildMs(); applyMixer();
    out.connect(master); master.connect(limiter); limiter.connect(analyser); analyser.connect(ctx.destination);
    apply();
  }
  async function start() { // called once from the launch gesture
    if (ctx) { st.want = true; return sync(); }
    build(); st.want = true; sync();
    const info = $('#mxInfo'); info.textContent = 'loading';
    let buf = null, title = D.track.title;
    try {
      if (await hasTrack()) { audio.src = D.track.src; sync(); buf = trackBuf = await ctx.decodeAudioData(await (await fetch(D.track.src)).arrayBuffer()); }
      else { buf = trackBuf = await renderGroove(); audio.src = toWav(buf); title = 'Demo groove, not Omri · add audio/track.mp3'; sync(); }
    } catch (e) { console.warn('deck: could not load audio', e); }
    $('#ttTitle').textContent = title;
    document.querySelectorAll('[data-track-title]').forEach(e => (e.textContent = title.split(' · ')[0]));
    if (buf) { analyse(buf); analyseHarmony(buf); } else info.textContent = 'no bpm';
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

  /* ---------- Harmony: the song's key, and the chord in every bar, measured from the audio ---------- */
  // A spectrum is taken every ~0.19 s and folded into the 12 pitch classes (a chromagram). The whole-song chroma is
  // matched against major/minor key profiles; then each bar's chroma picks the best-fitting chord from that key.
  const NOTE_N = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const H = { ready: false, key: 9, minor: true, chords: [], top: [] };
  const chordName = c => NOTE_N[c.root] + (c.minor ? 'm' : '');
  async function analyseHarmony(buf) {
    try {
      const dec = Math.max(1, Math.round(buf.sampleRate / 11025)), sr = buf.sampleRate / dec, N = 4096, hop = 2048;
      const a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a, len = Math.floor(a.length / dec);
      const x = new Float32Array(len);
      for (let i = 0, j = 0; i < len; i++) { let s = 0; for (let k = 0; k < dec; k++, j++) s += a[j] + b[j]; x[i] = s / (2 * dec); }
      // radix-2 FFT tables
      const bits = Math.log2(N), revs = new Uint16Array(N), cos = new Float32Array(N / 2), sin = new Float32Array(N / 2), win = new Float32Array(N);
      for (let i = 0; i < N; i++) { let r = 0; for (let k = 0; k < bits; k++) r |= ((i >> k) & 1) << (bits - 1 - k); revs[i] = r; win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N); }
      for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / N); sin[i] = Math.sin((2 * Math.PI * i) / N); }
      const binPc = new Int8Array(N / 2).fill(-1), binLow = new Uint8Array(N / 2);
      for (let k = 1; k < N / 2; k++) { const f = (k * sr) / N; if (f >= 50 && f <= 1800) { binPc[k] = ((Math.round(12 * Math.log2(f / 261.63)) % 12) + 12) % 12; binLow[k] = f < 190 ? 1 : 0; } }
      const re = new Float32Array(N), im = new Float32Array(N), frames = Math.max(0, Math.floor((len - N) / hop)), chroma = [], total = new Float32Array(12);
      for (let fr = 0; fr < frames; fr++) {
        const o = fr * hop;
        for (let i = 0; i < N; i++) { re[revs[i]] = x[o + i] * win[i]; im[i] = 0; }
        for (let size = 2; size <= N; size <<= 1) {
          const half = size >> 1, stepT = N / size;
          for (let s = 0; s < N; s += size) for (let k = 0, t = 0; k < half; k++, t += stepT) {
            const i1 = s + k, i2 = i1 + half, tr = re[i2] * cos[t] + im[i2] * sin[t], ti = im[i2] * cos[t] - re[i2] * sin[t];
            re[i2] = re[i1] - tr; im[i2] = im[i1] - ti; re[i1] += tr; im[i1] += ti;
          }
        }
        const c = new Float32Array(24); // 0..11 all registers, 12..23 bass register only
        for (let k = 1; k < N / 2; k++) { const pc = binPc[k]; if (pc < 0) continue; const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]); c[pc] += m; if (binLow[k]) c[12 + pc] += m; }
        chroma.push(c); for (let i = 0; i < 12; i++) total[i] += c[i];
        if (fr % 120 === 119) await new Promise(r => setTimeout(r)); // stay off the animation's back
      }
      // key: best correlation with the Krumhansl key profiles
      const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
      const corr = (v, prof, rot) => { let mv = 0, mp = 0; for (let i = 0; i < 12; i++) { mv += v[i]; mp += prof[i]; } mv /= 12; mp /= 12; let n = 0, d1 = 0, d2 = 0; for (let i = 0; i < 12; i++) { const A = v[(i + rot) % 12] - mv, B = prof[i] - mp; n += A * B; d1 += A * A; d2 += B * B; } return n / Math.sqrt(d1 * d2 || 1); };
      let best = -2;
      for (let k = 0; k < 12; k++) for (const minor of [false, true]) { const s = corr(total, minor ? MIN : MAJ, k); if (s > best) { best = s; H.key = k; H.minor = minor; } }
      // chords allowed in that key, then the best one for every bar
      const cand = (H.minor ? [[0, 1], [3, 0], [5, 1], [7, 1], [8, 0], [10, 0]] : [[0, 0], [2, 1], [4, 1], [5, 0], [7, 0], [9, 1]]).map(([d, m]) => ({ root: (H.key + d) % 12, minor: !!m }));
      const bar = (st.analysed ? st.period : 60 / NOMINAL_BPM) * 4, fps = sr / hop, bars = Math.max(1, Math.ceil((len / sr - st.phase) / bar));
      H.chords = [];
      for (let bi = 0; bi < bars; bi++) {
        const f0 = Math.max(0, Math.round((st.phase + bi * bar) * fps)), f1 = Math.min(frames, Math.round((st.phase + (bi + 1) * bar) * fps)), c = new Float32Array(24);
        for (let f = f0; f < f1; f++) for (let i = 0; i < 24; i++) c[i] += chroma[f][i];
        let sum = 0, lsum = 0; for (let i = 0; i < 12; i++) { sum += c[i]; lsum += c[12 + i]; }
        let pickd = H.chords[bi - 1] || cand[0], top = -1;
        if (sum > 0) for (const ch of cand) {
          const s = (c[ch.root] + 0.8 * c[(ch.root + (ch.minor ? 3 : 4)) % 12] + 0.8 * c[(ch.root + 7) % 12]) / sum + 1.2 * (lsum ? c[12 + ch.root] / lsum : 0) + (H.chords[bi - 1] === ch ? 0.04 : 0);
          if (s > top) { top = s; pickd = ch; }
        }
        H.chords.push(pickd);
      }
      const count = new Map(); H.chords.forEach(ch => count.set(ch, (count.get(ch) || 0) + 1));
      H.top = [...count.entries()].sort((p1, p2) => p2[1] - p1[1]).slice(0, 4).map(e => e[0]);
      H.ready = true; paintMs();
    } catch (e) { console.warn('deck: harmony analysis failed', e); }
  }
  // the chord the song is on in the bar that holds sixteenth-note n
  function chordAt(n) {
    if (!H.ready || !H.chords.length) return { root: 9, minor: true };
    const barsInTrack = audio.duration ? Math.max(1, Math.floor((audio.duration - st.phase) / (st.period * 4))) : H.chords.length;
    const bi = ((Math.floor(n / 16) % barsInTrack) + barsInTrack) % barsInTrack;
    return H.chords[Math.min(bi, H.chords.length - 1)];
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

  /* ---------- Mixer channel: EQ knobs ---------- */
  const MXK = { hi: 0.5, mid: 0.5, low: 0.5, fx: 0.6 };
  const eqDb = v => (v < 0.5 ? -26 * (1 - v * 2) : 6 * (v * 2 - 1)); // full kill at the bottom, +6 dB at the top
  function applyMixer() {
    if (!ctx) return;
    const t = ctx.currentTime;
    eq.hi.gain.setTargetAtTime(eqDb(MXK.hi), t, 0.02); eq.mid.gain.setTargetAtTime(eqDb(MXK.mid), t, 0.02); eq.low.gain.setTargetAtTime(eqDb(MXK.low), t, 0.02);
    fxApply();
  }

  /* ---------- Mixer effects: a selector picks one, ON fires it, DEPTH and four option buttons shape it ---------- */
  // In-line (in this order): DJ filter -> phaser -> auto-wah -> bit-crusher -> gater -> pump -> CUT.
  // From just before CUT, sends feed the flanger, beat roll, echo, reverb and freeze loops, which rejoin after it.
  // CUT is how roll, echo out, freeze and spinback make the track drop out underneath them.
  function buildFx(from) {
    const g = v => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const bq = (type, f, q) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q || 0.7; return n; };
    const lfo = f => { const o = ctx.createOscillator(); o.frequency.value = f; o.start(); return o; };
    X.lp = bq('lowpass', 20000); X.hp = bq('highpass', 10);
    from.connect(X.lp); X.lp.connect(X.hp);
    // phaser: four all-pass stages swept by an LFO, mixed back with the dry signal so moving notches appear
    X.phOut = g(1); X.phWet = g(0); X.phLfo = lfo(0.25); X.phDepth = g(0);
    let node = X.hp; X.hp.connect(X.phOut);
    for (let i = 0; i < 4; i++) { const ap = bq('allpass', 900 + i * 350, 0.6); node.connect(ap); X.phLfo.connect(X.phDepth); X.phDepth.connect(ap.detune); node = ap; }
    node.connect(X.phWet); X.phWet.connect(X.phOut);
    // auto-wah: a resonant band-pass that opens and closes in time, cross-faded against the dry signal
    X.wahOut = g(1); X.wahDry = g(1); X.wahWet = g(0); X.wah = bq('bandpass', 900, 4); X.wahLfo = lfo(1); X.wahDepth = g(0);
    X.phOut.connect(X.wahDry); X.wahDry.connect(X.wahOut); X.phOut.connect(X.wah); X.wah.connect(X.wahWet); X.wahWet.connect(X.wahOut);
    X.wahLfo.connect(X.wahDepth); X.wahDepth.connect(X.wah.detune);
    X.crush = ctx.createWaveShaper(); X.gate = g(1); X.pump = g(1); X.cut = g(1);
    X.wahOut.connect(X.crush); X.crush.connect(X.gate); X.gate.connect(X.pump); X.pump.connect(X.cut); X.cut.connect(input);
    const tap = X.pump;
    // flanger: a very short delay swept by a slow LFO and fed back into itself
    fl.delay = ctx.createDelay(0.05); fl.delay.delayTime.value = 0.004; fl.wet = g(0); fl.fb = g(0); fl.lfo = lfo(0.28); fl.depth = g(0.0028);
    fl.lfo.connect(fl.depth); fl.depth.connect(fl.delay.delayTime);
    tap.connect(fl.delay); fl.delay.connect(fl.fb); fl.fb.connect(fl.delay); fl.delay.connect(fl.wet); fl.wet.connect(input);
    // beat roll: a delay that is always listening; closing its input and feeding it back loops the last slice
    X.rollIn = g(1); X.roll = ctx.createDelay(2.5); X.rollFb = g(0); X.rollOut = g(0);
    tap.connect(X.rollIn); X.rollIn.connect(X.roll); X.roll.connect(X.rollFb); X.rollFb.connect(X.roll); X.roll.connect(X.rollOut); X.rollOut.connect(input);
    // echo out
    X.echoIn = g(0); X.echo = ctx.createDelay(2.5); X.echoFb = g(0);
    tap.connect(X.echoIn); X.echoIn.connect(X.echo); X.echo.connect(X.echoFb); X.echoFb.connect(X.echo); X.echo.connect(input);
    // reverb, with a short feedback loop in front of it that can hold a moment forever (freeze)
    const ir = ctx.createBuffer(2, ctx.sampleRate * 3.2, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.6); }
    X.verb = ctx.createConvolver(); X.verb.buffer = ir; X.verbIn = g(0); X.verbWet = g(0.5);
    X.fzIn = g(1); X.fz = ctx.createDelay(1); X.fz.delayTime.value = 0.31; X.fzFb = g(0); X.fzOut = g(0);
    tap.connect(X.verbIn); X.verbIn.connect(X.verb); X.verb.connect(X.verbWet); X.verbWet.connect(input);
    tap.connect(X.fzIn); X.fzIn.connect(X.fz); X.fz.connect(X.fzFb); X.fzFb.connect(X.fz); X.fz.connect(X.fzOut); X.fzOut.connect(X.verb);
    // noise riser and spinback play their own sources into these
    X.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); { const d = X.noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    X.riseBp = bq('bandpass', 300, 1.2); X.riseG = g(0); X.riseBp.connect(X.riseG); X.riseG.connect(input);
    X.spinG = g(1); X.spinG.connect(input);
    X.crushKey = '';
  }
  const beatLen = () => (st.analysed ? st.period : 60 / NOMINAL_BPM);
  const P2 = (prm, v, tc = 0.03) => prm.setTargetAtTime(v, ctx.currentTime, tc);
  let fxOn = false, fxSel = 0, brakeTo = 1, brakeSecs = 0.5, rate = 1, fxTimer = 0;
  // Each effect: name, four option labels (or none), default option, and how to switch it on / off.
  // d = the DEPTH knob (0..1), o = the chosen option (0..3). on() is also called again when the knob or option moves.
  const FXS = [
    { n: 'Flanger', opts: ['SLOW', 'MED', 'FAST', 'JET'], o: 1,
      on(d, o) { P2(fl.lfo.frequency, [0.1, 0.28, 1, 3.2][o]); P2(fl.wet.gain, 0.35 + d * 0.6); P2(fl.fb.gain, 0.3 + d * 0.5); },
      off() { P2(fl.wet.gain, 0); P2(fl.fb.gain, 0); } },
    { n: 'Filter', hint: 'knob: left low-pass, right high-pass',
      on(d) { // one knob: left of centre closes the top, right of centre removes the bottom
        const lpOn = d < 0.47, hpOn = d > 0.53;
        P2(X.lp.frequency, lpOn ? 20000 * Math.pow(0.005, (0.47 - d) / 0.47) : 20000); P2(X.lp.Q, lpOn ? 4 : 0.7);
        P2(X.hp.frequency, hpOn ? 20 * Math.pow(350, (d - 0.53) / 0.47) : 10); P2(X.hp.Q, hpOn ? 4 : 0.7);
      },
      off() { P2(X.lp.frequency, 20000); P2(X.hp.frequency, 10); P2(X.lp.Q, 0.7); P2(X.hp.Q, 0.7); } },
    { n: 'Phaser', opts: ['1', '2', '4', '8'], o: 2, hint: 'beats per sweep',
      on(d, o) { P2(X.phLfo.frequency, 1 / (beatLen() * [1, 2, 4, 8][o])); P2(X.phDepth.gain, 1400 + d * 2000); P2(X.phWet.gain, 0.5 + d * 0.5); },
      off() { P2(X.phWet.gain, 0); } },
    { n: 'Auto-wah', opts: ['1/4', '1/2', '1', '2'], o: 2, hint: 'beats per wah',
      on(d, o) { P2(X.wahLfo.frequency, 1 / (beatLen() * [0.25, 0.5, 1, 2][o])); P2(X.wahDepth.gain, 600 + d * 1700); P2(X.wahWet.gain, 1.6); P2(X.wahDry.gain, 1 - d * 0.9); },
      off() { P2(X.wahWet.gain, 0); P2(X.wahDry.gain, 1); } },
    { n: 'Riser', opts: ['2', '4', '8', '16'], o: 2, hint: 'beats to the top', hold: true,
      on(d, o, fresh) {
        if (!fresh) return P2(X.riseG.gain, 0.1 + d * 0.5, 0.2);
        const t = ctx.currentTime, len = beatLen() * [2, 4, 8, 16][o];
        X.riseSrc = ctx.createBufferSource(); X.riseSrc.buffer = X.noise; X.riseSrc.loop = true; X.riseSrc.connect(X.riseBp); X.riseSrc.start();
        X.riseBp.frequency.cancelScheduledValues(t); X.riseBp.frequency.setValueAtTime(250, t); X.riseBp.frequency.exponentialRampToValueAtTime(11000, t + len);
        X.riseG.gain.cancelScheduledValues(t); X.riseG.gain.setValueAtTime(0.0001, t); X.riseG.gain.exponentialRampToValueAtTime(0.1 + d * 0.5, t + len);
      },
      off() { const t = ctx.currentTime; X.riseG.gain.cancelScheduledValues(t); X.riseG.gain.setTargetAtTime(0, t, 0.01); if (X.riseSrc) { X.riseSrc.stop(t + 0.1); X.riseSrc = null; } } },
    { n: 'Roll', opts: ['1/16', '1/8', '1/4', '1/2'], o: 1, hint: 'slice length', hold: true,
      on(d, o) { X.roll.delayTime.setValueAtTime(Math.min(2.4, beatLen() * [0.25, 0.5, 1, 2][o]), ctx.currentTime); P2(X.rollIn.gain, 0, 0.003); P2(X.rollFb.gain, 1, 0.003); P2(X.rollOut.gain, 1, 0.003); P2(X.cut.gain, 0, 0.003); },
      off() { P2(X.rollFb.gain, 0, 0.005); P2(X.rollOut.gain, 0, 0.005); P2(X.rollIn.gain, 1, 0.02); P2(X.cut.gain, 1, 0.005); } },
    { n: 'Gater', opts: ['1/16', '1/8', '1/4', 'PAT'], o: 3, hint: 'chop rate', on() {}, off() { X.gate.gain.cancelScheduledValues(ctx.currentTime); P2(X.gate.gain, 1, 0.01); } },
    { n: 'Brake', opts: ['1/2', '1', '2', '4'], o: 1, hint: 'beats to stop', hold: true,
      on(d, o) { brakeTo = 0; brakeSecs = beatLen() * [0.5, 1, 2, 4][o]; },
      off() { brakeTo = 1; if (st.want && audio.paused) audio.play().catch(() => {}); } },
    { n: 'Spinback', opts: ['1', '2', '4', '8'], o: 1, hint: 'beats rewound', hold: true,
      on(d, o, fresh) { // the last few beats play backwards and speed up, then the track slams back in
        if (!fresh || !trackBuf) return;
        const sr = trackBuf.sampleRate, n = Math.round(beatLen() * [1, 2, 4, 8][o] * sr), end = Math.round(audio.currentTime * sr), buf = ctx.createBuffer(trackBuf.numberOfChannels, n, sr);
        for (let c = 0; c < buf.numberOfChannels; c++) { const s = trackBuf.getChannelData(c), dd = buf.getChannelData(c); for (let i = 0; i < n; i++) dd[i] = s[end - 1 - i] || 0; }
        const t = ctx.currentTime, dur = n / sr / 1.9, src = ctx.createBufferSource(); src.buffer = buf; src.connect(X.spinG);
        src.playbackRate.setValueAtTime(0.8, t); src.playbackRate.linearRampToValueAtTime(3, t + dur); src.start(t);
        X.spin = src; P2(X.cut.gain, 0, 0.004);
        fxTimer = setTimeout(() => { if (FXS[fxSel].n === 'Spinback' && fxOn) setFx(false); }, dur * 1000);
      },
      off() { clearTimeout(fxTimer); if (X.spin) { try { X.spin.stop(); } catch (e) {} X.spin = null; } P2(X.cut.gain, 1, 0.004); } },
    { n: 'Reverb', opts: ['ROOM', 'HALL', 'HUGE', 'FRZ'], o: 1, hint: 'FRZ holds the moment',
      on(d, o) {
        const frz = o === 3;
        P2(X.verbIn.gain, frz ? 0 : [0.25, 0.55, 1][o] * (0.3 + d * 0.7)); P2(X.fzOut.gain, frz ? 1 : o === 2 ? 0.6 : 0); P2(X.fzFb.gain, frz ? 1 : o === 2 ? 0.55 : 0, 0.005);
        P2(X.fzIn.gain, frz ? 0 : 1, 0.005); P2(X.cut.gain, frz ? 0 : 1, 0.05);
      },
      off() { P2(X.verbIn.gain, 0); P2(X.fzFb.gain, 0); P2(X.fzOut.gain, 0); P2(X.fzIn.gain, 1); P2(X.cut.gain, 1, 0.05); } },
    { n: 'Echo out', opts: ['1/4', '1/2', '3/4', '1'], o: 2, hint: 'echo spacing', hold: true,
      on(d, o, fresh) {
        const dt = Math.min(2.4, beatLen() * [0.25, 0.5, 0.75, 1][o]), t = ctx.currentTime;
        P2(X.echoFb.gain, 0.45 + d * 0.4);
        if (!fresh) return;
        X.echo.delayTime.setValueAtTime(dt, t); X.echoIn.gain.cancelScheduledValues(t); X.echoIn.gain.setValueAtTime(1, t); X.echoIn.gain.setTargetAtTime(0, t + dt, 0.01); // let one echo-length of the track in, then shut the door
        P2(X.cut.gain, 0, 0.01);
      },
      off() { P2(X.cut.gain, 1, 0.01); P2(X.echoFb.gain, 0.3, 0.3); P2(X.echoIn.gain, 0); } },
    { n: 'Crush', hint: 'knob: bit depth',
      on(d) { const bits = 9 - d * 7, key = bits.toFixed(1); if (key !== X.crushKey) { X.crushKey = key; X.crush.curve = curve(0, bits); } },
      off() { X.crushKey = ''; X.crush.curve = null; } },
    { n: 'Pump', opts: ['1/2', '1', '2', 'OFF'], o: 1, hint: 'duck every N beats, or off-beat', on() {}, off() { X.pump.gain.cancelScheduledValues(ctx.currentTime); P2(X.pump.gain, 1, 0.02); } }
  ];
  const GATE_PAT = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1];
  let fxNext = -1e9;
  setInterval(() => { // gater and pump are written onto the beat grid a little ahead of time
    if (!ctx || !fxOn) return;
    const fx = FXS[fxSel]; if (fx.n !== 'Gater' && fx.n !== 'Pump') return;
    const [q, stepDur] = seqPos(), d = MXK.fx;
    if (fxNext < q - 1 || fxNext > q + 8) fxNext = Math.ceil(q);
    while (fxNext < q + 0.12 / stepDur) {
      const t = ctx.currentTime + Math.max(0, (fxNext - q) * stepDur), i = ((fxNext % 16) + 16) % 16, low = 1 - (0.5 + d * 0.5);
      if (fx.n === 'Gater') {
        if (fx.o === 0) { X.gate.gain.setTargetAtTime(1, t, 0.003); X.gate.gain.setTargetAtTime(low, t + stepDur * 0.5, 0.003); }
        else X.gate.gain.setTargetAtTime((fx.o === 1 ? i % 2 === 0 : fx.o === 2 ? i % 4 < 2 : GATE_PAT[i]) ? 1 : low, t, 0.004);
      } else {
        const every = [2, 4, 8, 4][fx.o], hit = fx.o === 3 ? i % 4 === 2 : i % every === 0;
        if (hit) { X.pump.gain.setTargetAtTime(1 - (0.35 + d * 0.6), t, 0.008); X.pump.gain.setTargetAtTime(1, t + 0.04, stepDur * every * 0.22); }
      }
      fxNext++;
    }
  }, 25);
  function fxApply(fresh) { if (ctx) { const fx = FXS[fxSel]; if (fxOn) fx.on(MXK.fx, fx.o || 0, !!fresh); } paintFx(); }
  function setFx(on) {
    if (on === fxOn) return;
    fxOn = on; fxNext = -1e9;
    if (ctx) { if (on) FXS[fxSel].on(MXK.fx, FXS[fxSel].o || 0, true); else FXS[fxSel].off(); }
    paintFx();
  }
  function paintFx() {
    const fx = FXS[fxSel], b = $('#mxFx');
    $('#mxName').textContent = fx.n;
    b.classList.toggle('on', fxOn); b.setAttribute('aria-pressed', fxOn); b.textContent = fx.hold ? (fxOn ? 'Release' : 'Fire') : fxOn ? 'On' : 'Off';
    [...$('#mxOpts').children].forEach((o, i) => { o.textContent = fx.opts ? fx.opts[i] : '·'; o.disabled = !fx.opts; o.classList.toggle('on', !!fx.opts && i === fx.o); });
    $('#mxOpts').title = fx.hint || '';
  }
  function fxStep(dir) { setFx(false); fxSel = (fxSel + dir + FXS.length) % FXS.length; paintFx(); }
  $('#mxPrev').addEventListener('click', () => fxStep(-1));
  $('#mxNext').addEventListener('click', () => fxStep(1));
  [...$('#mxOpts').children].forEach((o, i) => o.addEventListener('click', () => { FXS[fxSel].o = i; fxApply(); }));
  $('#mxFx').addEventListener('click', () => setFx(!fxOn));
  bindKnobs('.knob.mk', 'm', MXK, applyMixer);
  paintFx();

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

  /* ---------- Red monosynth: two oscillators + sub + noise -> low-pass -> ADSR, with LFO, glide, arpeggiator and step sequencer ---------- */
  const MSK = {}; document.querySelectorAll('#ms input[data-f]').forEach(i => (MSK[i.dataset.f] = i.value / 100));
  const MS = { held: [], hold: false, arp: 0, oct: 0, seq: [4, 4, 16, 4, 7, 4, 14, 16, 4, 4, 11, 4, 9, 7, 4, 16], load: false, play: false, next: -1e9, n: 0, gate: false, cur: -1, bend: 0 };
  let MY = null;
  function buildMs() {
    const g = v => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const osc = type => { const o = ctx.createOscillator(); o.type = type; o.start(); return o; };
    MY = { saw: osc('sawtooth'), pulse: osc('square'), sub: osc('square'), lfo: osc('triangle'), sawG: g(0), pulseG: g(0), subG: g(0), noiseG: g(0),
      f1: ctx.createBiquadFilter(), f2: ctx.createBiquadFilter(), vca: g(0), vol: g(0.5), lfoP: g(0), lfoF: g(0) };
    const noise = ctx.createBufferSource(), nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    noise.buffer = nb; noise.loop = true; noise.start();
    MY.saw.connect(MY.sawG); MY.pulse.connect(MY.pulseG); MY.sub.connect(MY.subG); noise.connect(MY.noiseG);
    [MY.sawG, MY.pulseG, MY.subG, MY.noiseG].forEach(n => n.connect(MY.f1));
    MY.f1.connect(MY.f2); MY.f2.connect(MY.vca); MY.vca.connect(MY.vol); MY.vol.connect(pre);
    MY.lfo.connect(MY.lfoP); MY.lfo.connect(MY.lfoF);
    [MY.saw, MY.pulse, MY.sub].forEach(o => MY.lfoP.connect(o.detune)); MY.lfoF.connect(MY.f1.detune); MY.lfoF.connect(MY.f2.detune);
    applyMs();
  }
  const sq2 = v => v * v;
  const msHz = i => 65.41 * Math.pow(2, (5 + i + MS.oct * 12 + MS.bend * 2) / 12); // key 0 is the low F
  const msCut = i => 60 * Math.pow(2, MSK.freq * 7.3) * Math.pow(msHz(Math.max(i, 0)) / 110, MSK.kybd);
  function applyMs() {
    if (!MY) return;
    const t = ctx.currentTime, set = (prm, v) => prm.setTargetAtTime(v, t, 0.02);
    set(MY.lfo.frequency, 0.1 * Math.pow(2, MSK.lfo * 7)); set(MY.lfoP.gain, sq2(MSK.vmod) * 600); set(MY.lfoF.gain, MSK.fmod * 2400);
    set(MY.sawG.gain, MSK.saw * 0.5); set(MY.pulseG.gain, MSK.pulse * 0.5); set(MY.subG.gain, MSK.sub * 0.5); set(MY.noiseG.gain, MSK.noise * 0.4);
    set(MY.f1.Q, 0.7 + MSK.res * 16); set(MY.f2.Q, 0.7 + MSK.res * 3); set(MY.vol.gain, MSK.vol * 0.8);
    if (!MS.gate) { set(MY.f1.frequency, Math.min(18000, msCut(MS.cur))); set(MY.f2.frequency, Math.min(18000, msCut(MS.cur))); }
    else if (MS.cur >= 0) [[MY.saw, 1], [MY.pulse, 1], [MY.sub, 0.5]].forEach(([o, m]) => set(o.frequency, msHz(MS.cur) * m)); // bender / transpose while a note sounds
  }
  function msOn(i, t, legato) {
    const f = msHz(i), glide = sq2(MSK.port) * 0.4, A = 0.002 + sq2(MSK.a) * 1.5, Dk = 0.02 + sq2(MSK.d) * 2;
    [[MY.saw, 1], [MY.pulse, 1], [MY.sub, 0.5]].forEach(([o, m]) => { o.frequency.cancelScheduledValues(t); glide > 0.004 ? o.frequency.setTargetAtTime(f * m, t, glide / 3) : o.frequency.setValueAtTime(f * m, t); });
    MS.cur = i;
    if (legato && MS.gate) return; // sliding between held keys does not re-trigger the envelope
    const base = Math.min(18000, msCut(i)), peak = Math.min(18000, base * Math.pow(2, MSK.env * 5));
    MY.vca.gain.cancelScheduledValues(t); MY.vca.gain.setTargetAtTime(1, t, A / 3 + 0.001); MY.vca.gain.setTargetAtTime(MSK.s, t + A, Dk / 3);
    [MY.f1, MY.f2].forEach(fl2 => { fl2.frequency.cancelScheduledValues(t); fl2.frequency.setTargetAtTime(peak, t, A / 3 + 0.001); fl2.frequency.setTargetAtTime(base + (peak - base) * MSK.s, t + A, Dk / 3); });
    MS.gate = true;
  }
  function msOff(t) {
    const R = 0.01 + sq2(MSK.r) * 2.5, base = Math.min(18000, msCut(MS.cur));
    MY.vca.gain.cancelScheduledValues(t); MY.vca.gain.setTargetAtTime(0, t, R / 3);
    [MY.f1, MY.f2].forEach(fl2 => { fl2.frequency.cancelScheduledValues(t); fl2.frequency.setTargetAtTime(base, t, R / 3); });
    MS.gate = false;
  }
  const msAuto = () => MS.smart || MS.play || (MS.arp && MS.held.length); // the clock is playing the notes, not the fingers
  // Smart plays: ready-made parts that follow the song's own chords, bar by bar. Each has a fader patch and a
  // generator that, for one sixteenth of a bar on a given chord, returns the notes to play (with optional pitch bends).
  const KI = (pc, oct) => Math.max(0, Math.min(31, ((pc - 5 + 120) % 12) + oct * 12)); // pitch class -> key index
  const tones = c => [c.root, (c.root + (c.minor ? 3 : 4)) % 12, (c.root + 7) % 12];
  const PLAYS = [
    { n: 'Arp chords', patch: { saw: 80, pulse: 30, sub: 0, noise: 0, freq: 50, res: 45, env: 60, fmod: 0, vmod: 0, port: 0, a: 0, d: 30, s: 10, r: 25, vol: 55 },
      gen(s, b, c) { const t = tones(c), up = [KI(t[0], 0), KI(t[1], 0), KI(t[2], 0), KI(t[0], 1), KI(t[1], 1), KI(t[2], 1)]; return [{ i: up[[0, 1, 2, 3, 4, 5, 4, 3, 2, 3, 4, 5, 4, 3, 2, 1][s]], len: 0.7 }]; } },
    { n: 'Chord stabs', patch: { saw: 70, pulse: 60, sub: 0, noise: 0, freq: 62, res: 30, env: 50, fmod: 0, vmod: 0, port: 0, a: 0, d: 22, s: 0, r: 18, vol: 55 },
      gen(s, b, c) { // a mono synth can't hold a chord, so each stab is a very fast strum through it
        if (![2, 6, 10, 13, 14].includes(s)) return []; const t = tones(c);
        return [0, 1, 2].map(k => ({ i: KI(t[k], 1), off: k * 0.22, len: k === 2 ? 0.5 : 0.22 }));
      } },
    { n: 'Sub bass', patch: { saw: 40, pulse: 0, sub: 95, noise: 0, freq: 30, res: 35, env: 45, fmod: 0, vmod: 0, port: 8, a: 0, d: 35, s: 40, r: 10, vol: 70 },
      gen(s, b, c) { return [0, 3, 6, 8, 11].includes(s) ? [{ i: KI(c.root, 0), len: 0.8 }] : s === 14 ? [{ i: KI(c.root, 1), len: 0.8, bend: [0, -12, 0.2, 0.7] }] : []; } },
    { n: 'Bend lead', patch: { saw: 60, pulse: 50, sub: 20, noise: 0, freq: 62, res: 40, env: 35, fmod: 0, vmod: 12, port: 25, a: 2, d: 50, s: 60, r: 30, lfo: 62, vol: 50 },
      gen(s, b, c) { // long notes that scoop up into pitch, with a whole-tone bend at the end of the phrase
        const t = tones(c), r = b % 3, line = { 0: [t[(2 + r) % 3], 2, 3, [-2, 0, 0, 0.5]], 4: [t[(1 + r) % 3], 2, 2], 6: [t[r % 3], 2, 1.6], 8: [t[(2 + r) % 3], 1, 3.6, [0, 2, 1.6, 1.2]], 12: [t[(1 + r) % 3], 1, 2], 14: [t[r % 3], 1, 1.8, [-1, 0, 0, 0.4]] }[s];
        return line ? [{ i: KI(line[0], line[1]), len: line[2], bend: line[3] }] : [];
      } },
    { n: 'Wobble', patch: { saw: 80, pulse: 0, sub: 70, noise: 0, freq: 36, res: 70, env: 8, fmod: 75, vmod: 0, port: 15, a: 0, d: 40, s: 85, r: 12, vol: 60 }, lfoBeats: 0.5,
      gen(s, b, c) { return s === 0 ? [{ i: KI(c.root, 0), len: 7.7 }] : s === 8 ? [{ i: KI(b % 2 ? tones(c)[2] : c.root, 0), len: 7.7, bend: b % 4 === 3 ? [0, 12, 5, 2.5] : null }] : []; } },
    { n: 'Gate lead', patch: { saw: 30, pulse: 80, sub: 0, noise: 0, freq: 46, res: 60, env: 70, fmod: 0, vmod: 0, port: 0, a: 0, d: 18, s: 0, r: 8, vol: 50 },
      gen(s, b, c) { const t = tones(c); return [{ i: s % 4 === 3 ? KI(t[0], 2) : KI(t[s % 8 < 4 ? 0 : 2], 1), len: 0.5, bend: s === 15 && b % 2 ? [0, 2, 0, 0.9] : null }]; } }
  ];
  function setPatch(patch) { Object.entries(patch).forEach(([k, v]) => { MSK[k] = v / 100; const inp = document.querySelector(`#ms input[data-f="${k}"]`); if (inp) inp.value = v; }); applyMs(); }
  function msBend(t, bend, stepDur) { // bend = [from, to, starts after N steps, lasts N steps], in semitones
    [MY.saw.detune, MY.pulse.detune, MY.sub.detune].forEach(d => {
      d.cancelScheduledValues(t);
      if (!bend) return d.setValueAtTime(0, t);
      d.setValueAtTime(bend[0] * 100, t); d.setValueAtTime(bend[0] * 100, t + bend[2] * stepDur); d.linearRampToValueAtTime(bend[1] * 100, t + (bend[2] + bend[3]) * stepDur);
    });
  }
  function msLight(i, at, len) { setTimeout(() => { const k = $('#msKeys').children[i]; if (!k) return; k.classList.add('on'); setTimeout(() => k.classList.remove('on'), len * 1000); }, Math.max(0, (at - ctx.currentTime) * 1000)); }
  setInterval(() => { // arpeggiator and sequencer step on the track's sixteenths
    if (!ctx || !MY || !msAuto()) return;
    const [q, stepDur] = seqPos();
    if (MS.next < q - 1 || MS.next > q + 8) MS.next = Math.ceil(q);
    while (MS.next < q + 0.12 / stepDur) {
      const t = ctx.currentTime + Math.max(0, (MS.next - q) * stepDur);
      if (MS.smart) { // a smart play: ask its generator what this sixteenth holds, on the chord the song is on right now
        const chord = chordAt(MS.next), s = ((MS.next % 16) + 16) % 16;
        if (s === 0 || chord !== MS.shownChord) { MS.shownChord = chord; setTimeout(() => { if (MS.smart) paintMs(); }, Math.max(0, (t - ctx.currentTime) * 1000)); }
        MS.smart.gen(s, Math.floor(MS.next / 16), chord).forEach(ev => {
          const at = t + (ev.off || 0) * stepDur, len = ev.len * stepDur;
          msOn(ev.i, at, false); msBend(at, ev.bend, stepDur); MY.vca.gain.setTargetAtTime(0, at + len, 0.004 + sq2(MSK.r) * 0.3); msLight(ev.i, at, len);
        });
        MS.next++; continue;
      }
      let note = null;
      if (MS.play) note = MS.seq.length ? MS.seq[MS.n % MS.seq.length] : null;
      else {
        const up = [...new Set(MS.held)].sort((a, b) => a - b), order = MS.arp === 1 ? up : MS.arp === 3 ? up.slice().reverse() : up.concat(up.slice(1, -1).reverse());
        note = order[MS.n % order.length];
      }
      if (note != null) { msOn(note, t, false); MY.vca.gain.setTargetAtTime(0, t + stepDur * 0.6, 0.004 + sq2(MSK.r) * 0.3); msLight(note, t, stepDur * 0.6); }
      MS.n++; MS.next++;
    }
  }, 25);

  { // keyboard: 32 keys from F; drag across keys to play a run
    const keys = $('#msKeys'); let html = '', w = 0;
    for (let i = 0; i < 32; i++) { const black = [1, 3, 6, 8, 10].includes((5 + i) % 12); html += black ? `<button class="b" data-i="${i}" style="left:${(w * 100 / 19).toFixed(2)}%" tabindex="-1"></button>` : `<button class="w" data-i="${i}" tabindex="-1"></button>`; if (!black) w++; }
    keys.innerHTML = html;
    let down = false;
    const press = i => {
      if (MS.load) { MS.seq.push(i); if (ctx) { msOn(i, ctx.currentTime, false); MY.vca.gain.setTargetAtTime(0, ctx.currentTime + 0.18, 0.02); MS.gate = false; } return paintMs(); }
      if (MS.hold && !down) MS.held = MS.held.filter(() => MS.arp); // with HOLD, a new key press replaces the held note (or joins the arpeggio)
      if (!MS.held.includes(i)) MS.held.push(i);
      if (ctx && !msAuto()) msOn(i, ctx.currentTime, MS.held.length > 1);
      paintMs();
    };
    const release = i => {
      if (MS.load || MS.hold) return;
      MS.held = MS.held.filter(x => x !== i);
      if (ctx && !MS.play) { if (MS.held.length && !MS.arp) msOn(MS.held[MS.held.length - 1], ctx.currentTime, true); else if (!MS.held.length) msOff(ctx.currentTime); }
      paintMs();
    };
    let last = -1;
    const at = e => { const el = document.elementFromPoint(e.clientX, e.clientY); return el && el.parentElement === keys ? +el.dataset.i : -1; };
    keys.addEventListener('pointerdown', e => { e.preventDefault(); if (!ctx) start(); const i = at(e); if (i < 0) return; keys.setPointerCapture(e.pointerId); press(i); down = true; last = i; });
    keys.addEventListener('pointermove', e => { if (!down) return; const i = at(e); if (i !== last && i >= 0) { const prev = last; last = i; press(i); release(prev); } });
    const up = () => { if (!down) return; down = false; release(last); last = -1; };
    keys.addEventListener('pointerup', up); keys.addEventListener('pointercancel', up);
  }
  function msStop() { MS.smart = null; MS.play = false; MS.held = []; MS.hold = false; MS.arp = 0; MS.load = false; if (MY) msOff(ctx.currentTime); paintMs(); }
  function paintMs(msg) {
    [...$('#msKeys').children].forEach((k, i) => k.classList.toggle('on', MS.held.includes(i) && !msAuto()));
    $('#msHold').classList.toggle('on', MS.hold); $('#msLoad').classList.toggle('on', MS.load); $('#msPlay').classList.toggle('on', MS.play);
    document.querySelectorAll('#ms .arp').forEach(b => b.classList.toggle('on', +b.dataset.a === MS.arp));
    document.querySelectorAll('#ms .oct').forEach(b => b.classList.toggle('on', +b.dataset.o === MS.oct));
    document.querySelectorAll('#msPlays button').forEach((b, i) => b.classList.toggle('on', MS.smart === PLAYS[i]));
    const bpm = st.analysed ? Math.round(60 / st.period) : 0;
    $('#msKey').textContent = H.ready ? `${NOTE_N[H.key]} ${H.minor ? 'minor' : 'major'} · ${bpm} BPM · ${MS.smart && MS.shownChord ? 'now on ' + chordName(MS.shownChord) : 'chords ' + H.top.map(chordName).join(' ')}` : ctx ? 'listening to the song…' : 'start the track to analyse it';
    $('#msRead').textContent = msg || (MS.smart ? `SMART PLAY · ${MS.smart.n} · following the song's chords` : MS.load ? `LOAD · ${MS.seq.length} steps · play keys, REST for a gap, LOAD to finish` : MS.play ? `SEQUENCE · ${MS.seq.length} steps` : MS.arp ? `ARPEGGIO ${['', 'up', 'up & down', 'down'][MS.arp]} · hold some keys` : 'play the keys · PLAY runs the sequence');
  }
  $('#msPlays').innerHTML = PLAYS.map(pl => `<button>${pl.n}</button>`).join('');
  [...$('#msPlays').children].forEach((b, i) => b.addEventListener('click', () => {
    if (!ctx) return start().then(() => b.click());
    const pl = PLAYS[i], stop = MS.smart === pl;
    MS.play = false; MS.load = false; MS.arp = 0; MS.held = []; MS.n = 0; MS.next = -1e9; MS.shownChord = null;
    msOff(ctx.currentTime); msBend(ctx.currentTime, null, 0);
    MS.smart = stop ? null : pl;
    if (!stop) { setPatch(pl.patch); if (pl.lfoBeats) MY.lfo.frequency.setTargetAtTime(1 / (beatLen() * pl.lfoBeats), ctx.currentTime, 0.02); } // wobble locks its LFO to the beat
    paintMs();
  }));
  $('#msHold').addEventListener('click', () => { MS.hold = !MS.hold; if (!MS.hold) { MS.held = []; if (MY && !MS.play) msOff(ctx.currentTime); } paintMs(); });
  document.querySelectorAll('#ms .arp').forEach(b => b.addEventListener('click', () => { MS.smart = null; MS.arp = MS.arp === +b.dataset.a ? 0 : +b.dataset.a; MS.n = 0; MS.next = -1e9; if (!MS.arp && MY && !MS.held.length) msOff(ctx.currentTime); paintMs(); }));
  document.querySelectorAll('#ms .oct').forEach(b => b.addEventListener('click', () => { MS.oct = +b.dataset.o; applyMs(); paintMs(); }));
  $('#msLoad').addEventListener('click', () => { MS.load = !MS.load; if (MS.load) { MS.seq = []; MS.play = false; } paintMs(); });
  $('#msRest').addEventListener('click', () => { if (MS.load) { MS.seq.push(null); paintMs(); } });
  $('#msPlay').addEventListener('click', () => {
    if (!ctx) return start().then(() => $('#msPlay').click());
    MS.smart = null; MS.play = !MS.play; MS.load = false; MS.n = 0; MS.next = -1e9; if (!MS.play) msOff(ctx.currentTime); paintMs();
  });
  const FNAMES = { lfo: 'LFO rate', vmod: 'pitch mod', port: 'glide', pulse: 'pulse', saw: 'saw', sub: 'sub osc', noise: 'noise', freq: 'cutoff', res: 'resonance', env: 'filter env', fmod: 'filter mod', kybd: 'key follow', a: 'attack', d: 'decay', s: 'sustain', r: 'release', vol: 'level' };
  document.querySelectorAll('#ms input[data-f]').forEach(inp => inp.addEventListener('input', () => { MSK[inp.dataset.f] = inp.value / 100; applyMs(); paintMs(`${FNAMES[inp.dataset.f].toUpperCase()} ${inp.value}`); }));
  { // bender springs back to centre
    const b = $('#msBend'); b.addEventListener('input', () => { MS.bend = b.value / 100; applyMs(); });
    ['pointerup', 'pointercancel', 'blur'].forEach(ev => b.addEventListener(ev, () => { b.value = 0; MS.bend = 0; applyMs(); }));
  }
  document.querySelectorAll('.ms-btns button').forEach(b => { b.dataset.l = b.textContent; b.setAttribute('aria-label', b.textContent); }); // legends are printed on the body under each button
  paintMs();

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
  const SEL = { pos: 12, legacy: true, active: null }; // the pedal starts bypassed: press A, B or C to bring it in
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

  /* ---------- Rack: the mixer is fixed; everything else can be added from a list and removed ---------- */
  const GEAR = {
    pd: { name: 'OS4 MkII delay pedal', desc: '30 delay models, looper, tap tempo', color: '#2fa25a', els: ['.pd', '#pdRead'],
      off() { SEL.active = null; if (ctx) { LP.rec = null; lpStopSrc(); LP.state = LP.layers.length ? 'stop' : 'empty'; } apply(); },
      on() {} },
    td: { name: 'OS-3-MO bass line', desc: 'Acid bass synth with 16-step sequencer', color: '#c4c8ce', els: ['#td'], off() { if (SQ.run) $('#tdRun').click(); }, on() {} },
    ms: { name: 'OS-101 monosynth', desc: 'Red keyboard synth: faders, arpeggiator, sequencer', color: '#e02a20', els: ['#ms'], off() { msStop(); }, on() {} }
  };
  let rack = ['pd', 'td', 'ms'];
  try { const saved = JSON.parse(localStorage.getItem('omri-rack')); if (Array.isArray(saved)) rack = saved.filter(k => GEAR[k]); } catch (e) {}
  const menu = $('#rackMenu'), addBtn = $('#rackAdd');
  function paintRack() {
    Object.entries(GEAR).forEach(([k, gear]) => gear.els.forEach(sel => ($(sel).hidden = !rack.includes(k))));
    const spare = Object.keys(GEAR).filter(k => !rack.includes(k));
    addBtn.disabled = !spare.length; addBtn.textContent = spare.length ? '+ Gear' : 'All gear out';
    menu.innerHTML = spare.map(k => `<button data-k="${k}"><i style="background:${GEAR[k].color}"></i><span><b>${GEAR[k].name}</b><em>${GEAR[k].desc}</em></span></button>`).join('');
    if (!spare.length) { menu.hidden = true; addBtn.setAttribute('aria-expanded', false); }
    try { localStorage.setItem('omri-rack', JSON.stringify(rack)); } catch (e) {}
  }
  Object.entries(GEAR).forEach(([k, gear]) => {
    const x = document.createElement('button'); x.className = 'rack-x'; x.textContent = '×'; x.title = 'Remove ' + gear.name; x.setAttribute('aria-label', 'Remove ' + gear.name);
    x.addEventListener('click', () => { rack = rack.filter(r => r !== k); gear.off(); paintRack(); });
    $(gear.els[0]).appendChild(x);
  });
  addBtn.addEventListener('click', () => { menu.hidden = !menu.hidden; addBtn.setAttribute('aria-expanded', !menu.hidden); });
  menu.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; rack.push(b.dataset.k); GEAR[b.dataset.k].on(); menu.hidden = true; addBtn.setAttribute('aria-expanded', false); paintRack(); });
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !e.target.closest('.tp')) { menu.hidden = true; addBtn.setAttribute('aria-expanded', false); } });
  rack.length < 3 && Object.keys(GEAR).filter(k => !rack.includes(k)).forEach(k => GEAR[k].off());
  paintRack();

  /* ---------- Per-frame: beat clock, ducking and swell, tempo light ---------- */
  const bpmEl = $('#mxBpm'), tapEl = $('#fsTAP'), leds = [...document.querySelectorAll('#mxMeter i')];
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - lastT) / 1000, 0.5); lastT = now;
    // BRAKE: the track winds down to a stop like a turntable losing power, and spins back up on release
    if (rate !== brakeTo && audio.src) {
      rate = brakeTo < rate ? Math.max(0, rate - dt / brakeSecs) : Math.min(1, rate + dt / (brakeSecs * 0.4));
      if (rate < 0.07) { if (!audio.paused) audio.pause(); } else { audio.playbackRate = rate; if (st.want && audio.paused) audio.play().catch(() => {}); }
    }
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
