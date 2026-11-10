// Page behaviour: launch gate, background track, scroll choreography, orbit carousel, clip player.
(function () {
  const D = window.OMRI, S = window.SPACE || {};
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isMobile = document.documentElement.classList.contains('m');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------- Render content from data ---------- */
  document.querySelectorAll('[data-split]').forEach(line => {
    line.innerHTML = [...line.textContent].map((c, i) => `<span class="ch" style="--i:${i}">${c}</span>`).join('');
  });

  const titleCase = s => s.replace(/\b\p{Lu}{3,}\b/gu, w => w[0] + w.slice(1).toLowerCase()).replace(/\bdj\b/gi, 'DJ').replace(/ x /gi, ' × ').replace(/^\p{Ll}/u, c => c.toUpperCase());
  function renderTour(events, isLive) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const upcoming = events.filter(e => new Date(e.date + 'T23:59:59') >= today).sort((a, b) => a.date.localeCompare(b.date));
    $('#tourList').innerHTML = upcoming.map((e, i) => {
      const d = new Date(e.date + 'T12:00:00');
      const sold = e.status === 'soldout';
      return `<li class="tour-row reveal${isLive ? ' in' : ''}" style="--d:${i * 70}ms">
        <div class="tour-date"><b>${String(d.getDate()).padStart(2, '0')}</b><span>${MONTHS[d.getMonth()]} ${d.getFullYear()}</span></div>
        <div class="tour-what"><h3>${esc(titleCase(e.title))}${i === 0 ? '<span class="tour-next">Next</span>' : ''}</h3><p>${esc(titleCase(e.venue))}${e.city ? ' · ' + esc(titleCase(e.city)) : ''}</p></div>
        <a class="tour-cta ${sold ? 'soldout' : ''}" href="${esc(e.url)}" target="_blank" rel="noopener">${sold ? 'Sold out' : 'Tickets'}</a>
      </li>`;
    }).join('') || '<li class="tour-row"><div></div><div class="tour-what"><h3>New dates soon</h3></div></li>';
    $('#tourLive').hidden = !isLive;
  }
  renderTour(D.events, false);

  const euro = '<span>Euro Tour 2026 · completed</span>' + D.euroTour.map(t => `<span><b>${esc(t.city)}</b> ${esc(t.venue)}</span>`).join('');
  $('#euroMarquee').innerHTML = euro + euro;

  $('#journeyTrack').innerHTML = D.journey.map((j, i) =>
    `<article class="chapter" data-n="${String(i + 1).padStart(2, '0')}"><small>${esc(j.tag)}</small><div><h3>${esc(j.title)}</h3><p>${esc(j.text)}</p></div></article>`).join('');

  $('#vinyls').innerHTML = D.albums.map((a, i) =>
    `<a class="album reveal" style="--d:${i * 120}ms;--h:${a.hue}" href="${esc(a.url)}" target="_blank" rel="noopener">
      <div class="album-art"><div class="disc"></div></div>
      <h3>${esc(a.title)}</h3><p>${esc(a.note)}</p><em>Get it on Bandcamp →</em></a>`).join('');

  const c = D.contact;
  $('#contactGrid').innerHTML =
    `<div class="card reveal"><small>${c.booking.label}</small><b>${c.booking.phone}</b><p>Shows, festivals, DJ sets</p><a class="btn solid" href="${c.booking.whatsapp}" target="_blank" rel="noopener">WhatsApp</a></div>
     <div class="card reveal" style="--d:100ms"><small>${c.management.label}</small><b>${c.management.name}</b><p>${c.management.phone}</p><a class="btn ghost" href="tel:${c.management.phone.replace(/[^+\d]/g, '')}">Call</a></div>`;
  $('#socials').innerHTML = Object.entries(D.links).map(([k, v]) => `<a href="${v}" target="_blank" rel="noopener">${k} ↗</a>`).join('');

  /* ---------- Music: the deck (deck.js) plays and processes the track ---------- */
  const DK = window.DECK, soundBtn = $('#sound');
  const playMusic = () => DK.play(), pauseMusic = () => DK.stop();
  soundBtn.addEventListener('click', () => DK.toggle());
  DK.onState = on => { soundBtn.classList.toggle('on', on); soundBtn.setAttribute('aria-pressed', on); };
  new IntersectionObserver(es => document.body.classList.toggle('deck-away', !es[0].isIntersecting)).observe($('#rig'));

  /* ---------- Hold to launch ---------- */
  const gate = $('#gate'), launch = $('#launch');
  const HOLD_MS = 1300;
  let holdStart = 0, holdRaf = 0, launched = false, ac = null, rumble = null;

  function startRumble() {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), o2 = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
      o.type = 'sawtooth'; o2.type = 'sine'; f.type = 'lowpass';
      const t = ac.currentTime, T = HOLD_MS / 1000;
      o.frequency.setValueAtTime(38, t); o.frequency.exponentialRampToValueAtTime(150, t + T);
      o2.frequency.setValueAtTime(55, t); o2.frequency.exponentialRampToValueAtTime(440, t + T);
      f.frequency.setValueAtTime(120, t); f.frequency.exponentialRampToValueAtTime(2400, t + T);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + T);
      o.connect(f); o2.connect(f); f.connect(g); g.connect(ac.destination); o.start(); o2.start();
      rumble = { o, o2, g };
    } catch (e) { /* audio is a bonus */ }
  }
  function stopRumble(fade = 0.12) {
    if (!rumble) return;
    const { o, o2, g } = rumble; rumble = null;
    const t = ac.currentTime;
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t); g.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    o.stop(t + fade + 0.02); o2.stop(t + fade + 0.02);
  }
  function holdTick() {
    const p = Math.min((performance.now() - holdStart) / HOLD_MS, 1);
    gate.style.setProperty('--p', p);
    S.warp = p * 0.35;
    if (p >= 1) return doLaunch();
    holdRaf = requestAnimationFrame(holdTick);
  }
  function holdDown(e) {
    if (launched || holdStart) return;
    if (e.cancelable) e.preventDefault();
    holdStart = performance.now(); launch.classList.add('holding'); startRumble(); holdTick();
  }
  function holdUp() {
    if (launched || !holdStart) return;
    holdStart = 0; cancelAnimationFrame(holdRaf); launch.classList.remove('holding'); stopRumble();
    gate.style.setProperty('--p', 0); S.warp = 0;
  }
  function doLaunch() {
    launched = true; stopRumble(0.6);
    DK.start();
    gate.classList.add('gone');
    document.body.classList.remove('locked'); document.body.classList.add('launched');
    // hyperspace decay
    const t0 = performance.now();
    (function decay(t) {
      const k = Math.min((t - t0) / 2200, 1);
      S.warp = Math.pow(1 - k, 3);
      if (k < 1) requestAnimationFrame(decay);
    })(t0);
    document.querySelectorAll('.hero .reveal').forEach((r, i) => setTimeout(() => r.classList.add('in'), 900 + i * 160));
    startVideo();
  }
  launch.addEventListener('pointerdown', holdDown);
  addEventListener('pointerup', holdUp); addEventListener('pointercancel', holdUp);
  launch.addEventListener('contextmenu', e => e.preventDefault());
  launch.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) holdDown(e); });
  launch.addEventListener('keyup', holdUp);

  /* ---------- Beat pulse, from the deck's measured beat grid ---------- */
  const BPM = 122; // nominal tempo, only for timings that are set in seconds
  (function beat() {
    S.beat = DK.playing ? Math.pow(1 - (DK.beat() % 1), 3) : S.beat * 0.9;
    requestAnimationFrame(beat);
  })();

  /* ---------- Scroll choreography ---------- */
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add('in'); io.unobserve(e.target);
    const b = e.target.querySelector('[data-count]'); if (b) countUp(b);
  }), { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
  document.querySelectorAll('.reveal').forEach(r => { if (!r.closest('.hero')) io.observe(r); });

  function countUp(b) {
    const to = +b.dataset.count, suf = b.dataset.suffix || '', t0 = performance.now();
    (function step(t) {
      const k = Math.min((t - t0) / 1600, 1), e = 1 - Math.pow(1 - k, 4);
      b.textContent = Math.round(to * e) + suf;
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ---------- His footage: inside the hero letters, and in the scroll portal ---------- */
  const vid = $('#liveVideo'), tcv = $('#titleVideo'), tcx = tcv.getContext('2d'), wrap = $('.title-wrap');
  // The title is a light show with switchable scenarios. Unlocked it cycles through them all;
  // the deck under the title steps through them and locks one in place.
  const BEAT = 60 / BPM, PAD = 40; // PAD: canvas bleed so glow isn't cut off (matches #titleVideo in styles.css)
  const ORGAN = ['#ff2d3d', '#ffd60a', '#2bff6a', '#2d7bff'], BANDS = [0, 1, 2, 3, 3, 2, 1, 0, 1, 2];
  const SYNC = [0, 3, 6, 10, 13];
  const pool = []; // extra decoders of the same film at different timecodes, shared out between the letters
  const G = { dark: false, tears: [] }; // per-frame state shared by all letters
  let TB = { x: 0, y: 0, w: 1, h: 1 }; // bounds of the lettering inside the canvas
  let letters = [], tdpr = 1, heroSeen = true, titleReady = false;
  let cur = 0, locked = false, switchAt = 0, startedAt = 0, stag = 0.05, lastStep = -1, lastT = 0;
  try { const saved = JSON.parse(localStorage.getItem('omri-scene')); if (saved && saved.locked) { locked = true; cur = saved.cur | 0; } } catch (e) {}

  const fill = (L, color, a = 1) => { L.sx.globalAlpha = a; L.sx.fillStyle = color; L.sx.fillRect(0, 0, L.w, L.h); L.sx.globalAlpha = 1; };
  const band = (L, x0, x1, stops, y1 = 0) => { // gradient given in whole-word coordinates
    const g = L.sx.createLinearGradient(x0 - L.x, 0, x1 - L.x, y1); stops.forEach(([o, c]) => g.addColorStop(o, c));
    L.sx.fillStyle = g; L.sx.fillRect(0, 0, L.w, L.h);
  };
  const shared = (L, src, F) => L.sx.drawImage(src, F.ox - L.x, F.oy - L.y, F.W, F.H); // one picture spanning the word
  const cover = (L, src, sw, sh, z = 1, shift = 0) => { // a picture fitted to this letter alone
    const r = sw / sh; let w = L.w * z, h = w / r; if (h < L.h * z) { h = L.h * z; w = h * r; }
    L.sx.drawImage(src, (L.w - w) / 2 * (1 + shift), (L.h - h) / 2, w, h);
  };
  const film = (L, F, off = 0) => L.sx.drawImage(vid, F.gx - L.x + off, F.gy - L.y, F.dw, F.dh);

  // offscreen sources for the generated scenarios
  const plasma = document.createElement('canvas'); plasma.width = 72; plasma.height = 26;
  const plx = plasma.getContext('2d'), plImg = plx.createImageData(72, 26);
  const sky = document.createElement('canvas'), skx = sky.getContext('2d');
  const stars = Array.from({ length: 280 }, () => ({ a: Math.random() * 6.283, r: Math.random(), sp: 0.15 + Math.random() * 0.5 }));
  // half-resolution canvases the drawn scenarios paint into; the letters then look through them
  const FX = {};
  ['laser', 'matrix', 'spec', 'disco', 'scope', 'kal'].forEach(k => { const c = document.createElement('canvas'); FX[k] = { c, x: c.getContext('2d') }; });
  const fire = document.createElement('canvas'); fire.width = 64; fire.height = 40;
  const fix = fire.getContext('2d'), fImg = fix.createImageData(64, 40), heat = new Uint8Array(64 * 42);
  const FIRE_PAL = Array.from({ length: 256 }, (_, v) => [Math.min(255, v * 3), Math.max(0, Math.min(255, (v - 85) * 3)), Math.max(0, Math.min(255, (v - 170) * 3.2))]);
  const GLYPHS = 'אבגדהוזחטיכלמנסעפצקרשת0123456789OMRISMADAR';
  const SPOTS = Array.from({ length: 80 }, (_, j) => ({ lon: Math.random() * 6.283, lat: (Math.random() - 0.5) * 2.4, hue: j * 47 }));
  const peaks = new Float32Array(44);
  let thumbs = null;
  const getThumbs = () => thumbs || (thumbs = D.clips.map(c => { const im = new Image(); im.src = `https://i.ytimg.com/vi/${c.id}/mqdefault.jpg`; return im; }));

  // Each draw() paints one letter's scratch canvas and may return [glowColour, glowAmount].
  const SC = [
    { name: 'Footage', secs: 9, draw(L, i, F) {
      L.sx.filter = 'brightness(1.35) saturate(1.15)'; film(L, F); L.sx.filter = 'none'; fill(L, '#fff', 0.2);
    } },
    { name: 'Color organ', secs: 8, draw(L, i, F, tick) {
      if (tick) {
        const chase = F.left < BEAT * 4; // finish with a left-to-right chase
        const hit = chase ? F.step % F.N === i
          : L.band === 0 ? F.s16 % 4 === 0 : L.band === 1 ? F.s16 % 4 === 2 : L.band === 2 ? SYNC.includes(F.s16) : Math.random() < 0.42;
        if (hit) L.lit = 1;
      }
      fill(L, '#170d2a'); L.sx.globalAlpha = 0.1; film(L, F); fill(L, ORGAN[L.band], L.lit);
      return [ORGAN[L.band], L.lit];
    } },
    { name: 'Own videos', secs: 15, stagger: BEAT, draw(L, i, F) {
      const src = pool.length && pool[i % pool.length].readyState >= 2 ? pool[i % pool.length] : vid;
      // letters sharing a decoder look at different parts of its frame
      const shift = pool.length ? ((Math.floor(i / pool.length) % 3) - 1) * 0.5 : 0;
      L.sx.filter = 'brightness(1.35) saturate(1.15)'; cover(L, src, src.videoWidth, src.videoHeight, 1.15, shift); L.sx.filter = 'none';
      fill(L, '#fff', 0.2);
    } },
    { name: 'VU meters', secs: 8, draw(L, i, F, tick) {
      if (tick && F.s16 % 2 === 0) L.tgt = Math.min(1, (F.s16 % 4 === 0 ? 0.55 : 0.22) + Math.random() * 0.5);
      L.lvl += (L.tgt - L.lvl) * (L.tgt > L.lvl ? 0.5 : 0.12); L.tgt *= 0.93; L.peak = Math.max(L.peak - 0.006, L.lvl);
      fill(L, '#07090c');
      const n = 14, seg = L.h / n, gap = Math.max(1, seg * 0.2), sx = L.sx;
      for (let r = 0; r < n; r++) {
        sx.globalAlpha = r < L.lvl * n ? 1 : 0.13;
        sx.fillStyle = r / n > 0.82 ? '#ff3b30' : r / n > 0.6 ? '#ffd60a' : '#30d158';
        sx.fillRect(0, L.h - (r + 1) * seg + gap / 2, L.w, seg - gap);
      }
      sx.globalAlpha = 0.95; sx.fillStyle = '#fff';
      sx.fillRect(0, L.h - (Math.min(n - 1, Math.floor(L.peak * n)) + 1) * seg + gap / 2, L.w, Math.max(2, (seg - gap) * 0.35));
      sx.globalAlpha = 1;
      return [L.lvl > 0.82 ? '#ff3b30' : '#30d158', L.lvl * 0.5];
    } },
    { name: 'Night scanner', secs: 8, draw(L, i, F) {
      const ph = (F.bp / 4) % 1, tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      const X = F.ox + F.W * (-0.04 + 1.08 * tri), R = F.W * 0.17;
      fill(L, '#1c0306');
      band(L, X - R, X + R, [[0, 'rgba(255,20,30,0)'], [0.35, 'rgba(255,20,30,.6)'], [0.5, '#fff3ee'], [0.65, 'rgba(255,20,30,.6)'], [1, 'rgba(255,20,30,0)']]);
      return ['#ff1a2a', Math.max(0, 1 - Math.abs(L.x + L.w / 2 - X) / R)];
    } },
    { name: 'Neon sign', secs: 9, enter(L, i, F) { L.strike = F.now + i * 0.18; L.drop = 0; }, draw(L, i, F) {
      const col = L.row === 0 ? '#ff3ea5' : '#35e6ff', since = F.now - L.strike;
      let lvl = 0;
      if (since >= 0 && since < 0.5) lvl = Math.random() < 0.5 ? 1 : 0.1; // tube striking
      else if (since >= 0.5) {
        if (Math.random() < 0.0012) L.drop = F.now + 0.45; // now and then a tube drops out and re-strikes
        lvl = F.now < L.drop ? (Math.random() < 0.5 ? 0.9 : 0.05) : 0.93 + 0.07 * Math.sin(F.now * 50 + i);
      }
      fill(L, '#24102c'); fill(L, col, lvl);
      L.sx.globalAlpha = lvl; band(L, 0, 0, [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,.6)'], [1, 'rgba(255,255,255,0)']], L.h); L.sx.globalAlpha = 1;
      return [col, lvl * 0.9];
    } },
    { name: 'Strobe glitch', secs: 8, draw(L, i, F) {
      const sx = L.sx, tx = L.tx, dx = (2 + 12 * Math.pow(1 - F.beatPh, 3)) * tdpr;
      fill(L, '#000');
      for (const [col, off] of [['#ff0000', -dx], ['#00ffff', dx]]) { // red and cyan copies pulled apart
        tx.globalCompositeOperation = 'source-over'; tx.filter = 'brightness(1.5) contrast(1.2)';
        tx.drawImage(vid, F.gx - L.x + off, F.gy - L.y, F.dw, F.dh); tx.filter = 'none';
        tx.globalCompositeOperation = 'multiply'; tx.fillStyle = col; tx.fillRect(0, 0, L.w, L.h);
        sx.globalCompositeOperation = 'lighter'; sx.drawImage(L.tmp, 0, 0);
      }
      sx.globalCompositeOperation = 'source-over';
      G.tears.forEach(tr => { // horizontal tearing, lined up across the whole word
        const y = Math.max(0, tr.y - L.y), h = Math.min(L.h, tr.y + tr.h - L.y) - y;
        if (h > 1) sx.drawImage(L.scratch, 0, y, L.w, h, tr.shift, y, L.w, h);
      });
      if (G.dark) fill(L, '#000', 0.85);
      if (F.live && F.beatPh < 0.08) fill(L, '#fff', 0.8);
      return ['#fff', F.live && F.beatPh < 0.12 ? 0.8 : 0];
    } },
    { name: 'Clip wall', secs: 10, enter(L, i) { L.clip = (i * 7 + Math.floor(Math.random() * N)) % N; }, draw(L, i, F) {
      if (F.newStep && F.s16 % 4 === 0 && F.step % F.N === i) { L.clip = Math.floor(Math.random() * N); L.flash = 0.9; } // one letter flips per beat
      const im = getThumbs()[L.clip];
      if (im.complete && im.naturalWidth) cover(L, im, im.naturalWidth, im.naturalHeight); else fill(L, '#1a1326');
      fill(L, '#fff', 0.08);
    } },
    { name: 'Plasma lava', secs: 9, frame(F) {
      const d = plImg.data, t = F.now * 0.6;
      for (let y = 0, k = 0; y < 26; y++) for (let x = 0; x < 72; x++, k += 4) {
        const v = Math.sin(x * 0.11 + t) + Math.sin(y * 0.19 - t * 1.3) + Math.sin((x + y) * 0.08 + t * 0.7)
          + Math.sin(Math.hypot(x - 36 + 18 * Math.sin(t * 0.5), y - 13) * 0.22 - t);
        const n = (v + 4) / 8 * 1.6;
        d[k] = 140 + 115 * Math.cos(6.283 * (n + 0.02)); d[k + 1] = 70 + 70 * Math.cos(6.283 * (n + 0.42)); d[k + 2] = 150 + 105 * Math.cos(6.283 * (n + 0.72)); d[k + 3] = 255;
      }
      plx.putImageData(plImg, 0, 0);
    }, draw(L, i, F) { shared(L, plasma, F); return ['#c14dff', 0.3]; } },
    { name: 'Starfield', secs: 9, frame(F) {
      const w = sky.width, h = sky.height, R = Math.hypot(w, h) / 2;
      skx.fillStyle = 'rgba(5,3,16,.3)'; skx.fillRect(0, 0, w, h); // fading the last frame leaves the streaks
      skx.strokeStyle = '#dfe6ff'; skx.lineCap = 'round';
      stars.forEach(st => {
        const r0 = st.r; st.r += st.sp * F.dt * (0.4 + st.r * 3.5);
        if (st.r > 1) { st.r = 0.02 + Math.random() * 0.1; st.a = Math.random() * 6.283; return; }
        skx.lineWidth = (0.7 + st.r * 3) * tdpr; skx.beginPath();
        skx.moveTo(w / 2 + Math.cos(st.a) * r0 * R, h / 2 + Math.sin(st.a) * r0 * R);
        skx.lineTo(w / 2 + Math.cos(st.a) * st.r * R, h / 2 + Math.sin(st.a) * st.r * R); skx.stroke();
      });
    }, draw(L, i, F) { shared(L, sky, F); return ['#9ab8ff', 0.22]; } },
    { name: 'Liquid chrome', secs: 9, draw(L, i, F) {
      band(L, 0, 0, [[0, '#ffffff'], [0.38, '#8f97a3'], [0.5, '#15171b'], [0.53, '#5d646e'], [0.8, '#c9ced6'], [1, '#f4f6f8']], L.h);
      // studio highlight sweeping with the pointer
      const X = F.ox + F.W * (0.5 + 0.42 * (S.mx || 0)) + Math.sin(F.now * 0.7) * F.W * 0.22, R = F.W * 0.08;
      L.sx.globalCompositeOperation = 'screen';
      band(L, X - R, X + R, [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,.95)'], [1, 'rgba(255,255,255,0)']], L.h * 0.35);
      L.sx.globalCompositeOperation = 'source-over';
      return ['#dfe8ff', 0.2];
    } },
    { name: 'Laser show', secs: 9, frame(F) {
      const { c, x } = FX.laser, w = c.width, h = c.height;
      x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.fillStyle = 'rgba(3,8,6,.38)'; x.fillRect(0, 0, w, h); // haze
      x.globalCompositeOperation = 'lighter'; x.lineCap = 'round'; x.globalAlpha = 0.8;
      x.lineWidth = (1 + (F.live ? (1 - F.beatPh) * 2.2 : 0)) * tdpr * 0.6;
      [[0.1, '#2bff6a', 1], [0.9, '#ff3ea5', -1], [0.5, '#35e6ff', 1]].forEach(([ox, col, dir], e) => { // three emitters under the word
        x.strokeStyle = col;
        for (let k = 0; k < 6; k++) {
          const a = -Math.PI / 2 + dir * Math.sin(F.now * (0.7 + e * 0.23) + k * 0.55) * 1.15 + (k - 2.5) * 0.07;
          x.beginPath(); x.moveTo(ox * w, h * 1.05); x.lineTo(ox * w + Math.cos(a) * w * 1.3, h * 1.05 + Math.sin(a) * w * 1.3); x.stroke();
        }
      });
    }, draw(L, i, F) { shared(L, FX.laser.c, F); return ['#2bff6a', 0.3]; } },
    { name: 'Matrix rain', secs: 9, frame(F) {
      const { c, x } = FX.matrix, w = c.width, h = c.height, cell = Math.max(8, Math.round(h / 15)), cols = Math.ceil(w / cell);
      if (!G.rain || G.rain.length !== cols) G.rain = Array.from({ length: cols }, () => -Math.random() * 20);
      G.rainT = (G.rainT || 0) + F.dt; if (G.rainT < 0.055) return; G.rainT = 0;
      x.fillStyle = 'rgba(0,10,3,.14)'; x.fillRect(0, 0, w, h); // fading the last frame leaves the tails
      x.font = `${cell}px ui-monospace, Menlo, monospace`; x.textBaseline = 'top';
      for (let k = 0; k < cols; k++) {
        const y = G.rain[k] * cell;
        x.fillStyle = '#22ff6e'; x.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)], k * cell, y - cell);
        x.fillStyle = '#e6ffee'; x.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)], k * cell, y);
        G.rain[k] = y > h && Math.random() > 0.9 ? 0 : G.rain[k] + 1;
      }
    }, draw(L, i, F) { shared(L, FX.matrix.c, F); return ['#22ff6e', 0.3]; } },
    { name: 'Fire', secs: 9, frame(F) {
      const W = 64, H = 40, boost = F.live ? 70 * Math.pow(1 - F.beatPh, 2) : 0;
      for (let x = 0; x < W; x++) heat[(H + 1) * W + x] = heat[H * W + x] = Math.min(255, 150 + Math.random() * 105 + boost);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const b = (y + 1) * W, v = (heat[b + ((x + W - 1) % W)] + heat[b + x] + heat[b + ((x + 1) % W)] + heat[b + W + x]) / 4.05 - Math.random() * 5;
        heat[y * W + x] = v > 0 ? v : 0;
      }
      for (let k = 0, o = 0; k < W * H; k++, o += 4) { const c = FIRE_PAL[heat[k]]; fImg.data[o] = c[0]; fImg.data[o + 1] = c[1]; fImg.data[o + 2] = c[2]; fImg.data[o + 3] = 255; }
      fix.putImageData(fImg, 0, 0);
    }, draw(L, i) { // each letter burns from its own base
      L.sx.drawImage(fire, (i * 5) % 24, 0, 40, 40, 0, 0, L.w, L.h);
      return ['#ff7a18', 0.45];
    } },
    { name: 'Spectrum', secs: 9, frame(F) {
      const { c, x } = FX.spec, w = c.width, h = c.height, n = peaks.length, bw = w / n;
      x.fillStyle = '#06080b'; x.fillRect(0, 0, w, h);
      const g = x.createLinearGradient(0, h, 0, 0); g.addColorStop(0, '#30d158'); g.addColorStop(0.6, '#ffd60a'); g.addColorStop(0.9, '#ff3b30');
      for (let k = 0; k < n; k++) { // the real spectrum of the record, bass on the left
        const v = Math.pow(DK.freq[Math.floor(2 * Math.pow(210, k / (n - 1)))] / 255, 1.3);
        peaks[k] = Math.max(peaks[k] - F.dt * 0.5, v);
        x.fillStyle = g; x.fillRect(k * bw + bw * 0.12, h - v * h, bw * 0.76, v * h);
        x.fillStyle = '#fff'; x.fillRect(k * bw + bw * 0.12, h - peaks[k] * h - 2, bw * 0.76, 2);
      }
    }, draw(L, i, F) { shared(L, FX.spec.c, F); return ['#30d158', 0.3]; } },
    { name: 'Disco ball', secs: 9, frame(F) {
      const { c, x } = FX.disco, w = c.width, h = c.height, t = F.now * 0.45;
      x.globalCompositeOperation = 'source-over'; x.fillStyle = 'rgba(9,6,22,.45)'; x.fillRect(0, 0, w, h);
      x.globalCompositeOperation = 'lighter';
      SPOTS.forEach(sp => { // mirror facets sweeping the room
        const depth = Math.cos(sp.lon + t); if (depth < -0.15) return;
        const px = w / 2 + Math.sin(sp.lon + t) * w * 0.62 * Math.cos(sp.lat * 0.5), py = h / 2 + sp.lat * h * 0.4, r = (3 + depth * 5) * tdpr;
        const g = x.createRadialGradient(px, py, 0, px, py, r * 2.2);
        g.addColorStop(0, `hsla(${(sp.hue + F.now * 30) % 360},100%,82%,.95)`); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(px - r * 2.2, py - r * 2.2, r * 4.4, r * 4.4);
      });
    }, draw(L, i, F) { shared(L, FX.disco.c, F); return ['#ffffff', 0.25]; } },
    { name: 'Oscilloscope', secs: 9, frame(F) {
      const { c, x } = FX.scope, w = c.width, h = c.height;
      x.shadowBlur = 0; x.fillStyle = '#03120a'; x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(77,255,136,.14)'; x.lineWidth = 1; x.beginPath();
      for (let gx = 0; gx <= w; gx += w / 16) { x.moveTo(gx, 0); x.lineTo(gx, h); }
      for (let gy = 0; gy <= h; gy += h / 6) { x.moveTo(0, gy); x.lineTo(w, gy); }
      x.stroke();
      x.strokeStyle = '#6dffa0'; x.lineWidth = 1.6 * tdpr; x.shadowColor = '#4dff88'; x.shadowBlur = 10; x.lineJoin = 'round';
      [0.27, 0.74].forEach((row, r) => { // one live trace through each line of the name
        x.beginPath();
        for (let px = 0; px <= w; px += 2) {
          const v = (DK.wave[(Math.floor((px / w) * 900) + r * 1000) % 2048] - 128) / 128;
          px ? x.lineTo(px, row * h + v * h * 0.3) : x.moveTo(px, row * h + v * h * 0.3);
        }
        x.stroke();
      });
    }, draw(L, i, F) { shared(L, FX.scope.c, F); return ['#4dff88', 0.35]; } },
    { name: 'Hologram', secs: 9, draw(L, i, F) {
      const sx = L.sx, jitter = Math.random() < 0.05 ? (Math.random() - 0.5) * L.w * 0.25 : 0;
      fill(L, '#021a22');
      sx.globalAlpha = 0.9; sx.filter = 'grayscale(1) brightness(1.6) contrast(1.2)'; film(L, F, jitter); sx.filter = 'none'; sx.globalAlpha = 1;
      sx.globalCompositeOperation = 'multiply'; fill(L, '#35e6ff');
      sx.globalCompositeOperation = 'lighter'; fill(L, '#0a4c5c', 0.6);
      sx.globalCompositeOperation = 'source-over';
      const gap = 4 * tdpr, off = (F.now * 40 * tdpr) % gap;
      sx.fillStyle = 'rgba(0,0,0,.42)'; for (let y = -off; y < L.h; y += gap) sx.fillRect(0, y, L.w, gap * 0.45); // scanlines
      sx.fillStyle = 'rgba(190,250,255,.55)'; sx.fillRect(0, ((F.now * 0.35) % 1) * F.H + F.oy - L.y, L.w, 3 * tdpr); // projector sweep
      if (Math.random() < 0.03) fill(L, '#000', 0.55); // dropout
      return ['#35e6ff', 0.4 + 0.15 * Math.sin(F.now * 31 + i)];
    } },
    { name: 'Kaleidoscope', secs: 9, frame(F) {
      const { c, x } = FX.kal, w = c.width, h = c.height, R = Math.hypot(w, h) / 2, n = 10, a = (Math.PI * 2) / n;
      const vw = vid.videoWidth, vh = vid.videoHeight, s = (R * 1.5) / vh;
      for (let k = 0; k < n; k++) { // the film mirrored into rotating wedges
        x.save(); x.translate(w / 2, h / 2); x.rotate((k % 2 ? k + 1 : k) * a + F.now * 0.15); if (k % 2) x.scale(1, -1);
        x.beginPath(); x.moveTo(0, 0); x.lineTo(R, 0); x.lineTo(R * Math.cos(a), R * Math.sin(a)); x.closePath(); x.clip();
        x.drawImage(vid, -vw * s * (0.35 + 0.12 * Math.sin(F.now * 0.3)), -vh * s * 0.35, vw * s, vh * s);
        x.restore();
      }
    }, draw(L, i, F) { L.sx.filter = 'brightness(1.45) saturate(1.3)'; shared(L, FX.kal.c, F); L.sx.filter = 'none'; return ['#c14dff', 0.25]; } }
  ];
  const OWN = 2, WALL = 7;
  if (cur >= SC.length) cur = 0;

  function sizeTitle() {
    const r = wrap.getBoundingClientRect(); if (!r.width) return;
    tdpr = Math.min(devicePixelRatio || 1, 2);
    tcv.width = Math.round((r.width + PAD * 2) * tdpr); tcv.height = Math.round((r.height + PAD * 2) * tdpr);
    const cs = getComputedStyle($('.hero-title')), font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const bleed = Math.ceil(parseFloat(cs.fontSize) * 0.08), old = letters, lines = [...wrap.querySelectorAll('.line')];
    letters = [...wrap.querySelectorAll('.ch')].map((ch, i) => {
      // one mask per letter, drawn where the DOM letter sits (offset* ignores the reveal transforms)
      const w = ch.offsetWidth + bleed * 2, h = ch.offsetHeight;
      const mk = () => { const c = document.createElement('canvas'); c.width = Math.round(w * tdpr); c.height = Math.round(h * tdpr); return c; };
      const mask = mk(), scratch = mk(), tmp = mk();
      const m = mask.getContext('2d'); m.scale(tdpr, tdpr); m.font = font; m.textBaseline = 'alphabetic'; m.fillStyle = '#fff';
      const mt = m.measureText('M'), asc = mt.fontBoundingBoxAscent, desc = mt.fontBoundingBoxDescent;
      m.fillText(ch.textContent, bleed, (h - (asc + desc)) / 2 + asc);
      return Object.assign(old[i] || { scn: cur, flash: 0, lit: 0, step: -1, lvl: 0, tgt: 0, peak: 0, strike: 0, drop: 0, clip: i % N }, {
        mask, scratch, tmp, sx: scratch.getContext('2d'), tx: tmp.getContext('2d'), w: scratch.width, h: scratch.height,
        band: BANDS[i % BANDS.length], row: lines.indexOf(ch.parentElement),
        x: Math.round((ch.offsetLeft - bleed + PAD) * tdpr), y: Math.round((ch.offsetTop + PAD) * tdpr)
      });
    });
    const x1 = Math.max(...letters.map(L => L.x + L.w)), y1 = Math.max(...letters.map(L => L.y + L.h));
    TB.x = Math.min(...letters.map(L => L.x)); TB.y = Math.min(...letters.map(L => L.y)); TB.w = x1 - TB.x; TB.h = y1 - TB.y;
    sky.width = TB.w >> 1; sky.height = TB.h >> 1;
    Object.values(FX).forEach(f => { f.c.width = TB.w >> 1; f.c.height = TB.h >> 1; });
    titleReady = true;
  }

  const deck = $('#deck');
  function go(idx, lock) {
    cur = (idx + SC.length) % SC.length; if (lock != null) locked = lock;
    switchAt = startedAt = performance.now() / 1000;
    stag = locked ? Math.min(SC[cur].stagger || 0.05, 0.07) : SC[cur].stagger || 0.05;
    showDeck();
  }
  function showDeck() {
    $('#deckNum').textContent = String(cur + 1).padStart(2, '0') + ' / ' + SC.length;
    $('#deckName').textContent = SC[cur].name;
    const lk = $('#deckLock'); lk.textContent = locked ? 'Locked' : 'Auto'; lk.setAttribute('aria-pressed', locked);
    deck.classList.toggle('locked', locked);
    wrap.classList.toggle('clickable', cur === WALL);
    try { localStorage.setItem('omri-scene', JSON.stringify({ cur, locked })); } catch (e) {}
  }
  $('#deckPrev').addEventListener('click', () => go(cur - 1, true));
  $('#deckNext').addEventListener('click', () => go(cur + 1, true));
  $('#deckLock').addEventListener('click', () => { locked = !locked; startedAt = performance.now() / 1000; showDeck(); });
  wrap.addEventListener('click', e => { // Clip wall: a letter opens the clip it is showing
    const ch = e.target.closest('.ch'); if (!ch || cur !== WALL) return;
    const L = letters[[...wrap.querySelectorAll('.ch')].indexOf(ch)]; if (L) openClip(L.clip);
  });
  showDeck();

  function paintTitle(ms) {
    requestAnimationFrame(paintTitle);
    if (!titleReady || !heroSeen || vid.readyState < 2 || document.hidden) return;
    const now = ms / 1000, W = TB.w, H = TB.h, vr = vid.videoWidth / vid.videoHeight;
    if (!startedAt) startedAt = switchAt = now;
    if (!locked && now - startedAt > SC[cur].secs) go(cur + 1);
    deck.style.setProperty('--k', locked ? 0 : Math.min((now - startedAt) / SC[cur].secs, 1).toFixed(3));

    let dw = W * 1.08, dh = dw / vr; if (dh < H * 1.08) { dh = H * 1.08; dw = dh * vr; }
    const bp = DK.beat(), step = Math.floor(bp * 4); // lights follow the record: pitch it and they speed up, stop it and they freeze
    const F = {
      now, dt: Math.min(now - lastT, 0.05), W, H, ox: TB.x, oy: TB.y, dw, dh, N: letters.length, step, s16: step % 16, newStep: step !== lastStep,
      bp, beatPh: bp % 1, live: DK.playing, left: locked ? Infinity : SC[cur].secs - (now - startedAt),
      gx: TB.x + (W - dw) / 2 - (S.mx || 0) * W * 0.03, gy: TB.y + (H - dh) / 2 + (S.my || 0) * H * 0.03
    };
    lastT = now; lastStep = step;
    if (F.newStep) {
      G.dark = F.s16 % 2 === 1 && Math.random() < 0.4;
      G.tears = Math.random() < 0.55 ? [0, 1].map(() => ({ y: TB.y + Math.random() * H, h: (0.04 + Math.random() * 0.1) * H, shift: (Math.random() - 0.5) * 0.12 * W })) : [];
    }

    letters.forEach((L, i) => { // the switch ripples across the word, each letter flashing as it changes
      if (L.scn !== cur && now >= switchAt + i * stag) { L.scn = cur; L.flash = 1; if (SC[cur].enter) SC[cur].enter(L, i, F); }
    });
    const active = new Set(letters.map(L => L.scn));
    active.forEach(k => SC[k].frame && SC[k].frame(F));
    // only decode the extra films while a letter is showing one
    const needPool = active.has(OWN) || cur === OWN;
    pool.forEach(v => { if (!needPool) { if (!v.paused) v.pause(); } else if (v.paused && v.readyState >= 2) v.play().catch(() => {}); });

    tcx.clearRect(0, 0, tcv.width, tcv.height);
    letters.forEach((L, i) => {
      const sx = L.sx, tick = L.step !== step; L.step = step;
      sx.globalCompositeOperation = 'source-over'; sx.globalAlpha = 1; sx.filter = 'none'; sx.clearRect(0, 0, L.w, L.h);
      const g = SC[L.scn].draw(L, i, F, tick) || ['#fff', 0];
      if (L.flash > 0.01) fill(L, '#fff', L.flash);
      sx.globalCompositeOperation = 'destination-in'; sx.drawImage(L.mask, 0, 0);
      const glow = Math.max(g[1], L.flash);
      tcx.shadowColor = L.flash > g[1] ? '#fff' : g[0];
      tcx.shadowBlur = glow > 0.02 ? 44 * tdpr * glow : 0;
      tcx.drawImage(L.scratch, L.x, L.y);
      L.lit *= 0.86; L.flash *= 0.9;
    });
    document.body.classList.add('video-on');
  }

  function loadPool() {
    const n = isMobile ? 3 : 5;
    for (let k = 0; k < n; k++) {
      const v = document.createElement('video');
      v.muted = true; v.loop = true; v.playsInline = true; v.crossOrigin = 'anonymous'; v.preload = 'auto';
      v.className = 'pool-video'; v.setAttribute('aria-hidden', 'true');
      v.addEventListener('loadedmetadata', () => { v.currentTime = ((k + 1) * v.duration) / (n + 1); }, { once: true });
      v.src = vid.currentSrc || vid.src;
      document.body.appendChild(v); pool.push(v);
    }
  }
  function startVideo() {
    vid.preload = 'auto';
    vid.play().catch(() => {});
    setTimeout(() => { sizeTitle(); requestAnimationFrame(paintTitle); }, 2300); // after the letter reveal has settled
    setTimeout(loadPool, 5000); // the extra films are only needed from phase C
  }
  addEventListener('resize', () => { if (titleReady) sizeTitle(); });
  new IntersectionObserver(es => {
    heroSeen = es[0].isIntersecting;
    if (!heroSeen) pool.forEach(v => v.pause());
  }).observe(wrap);

  const portal = $('#portal'), pFrame = $('#portalFrame'), pCap = $('#portalCaption');
  const clamp01 = v => Math.min(Math.max(v, 0), 1);
  function paintPortal() {
    const r = portal.getBoundingClientRect();
    if (r.bottom < -50 || r.top > innerHeight + 50) return;
    const pp = clamp01(-r.top / (r.height - innerHeight));
    const k = clamp01(pp / 0.62), e = k * k * (3 - 2 * k);
    const gut = innerWidth < 900 ? 12 : Math.min(innerWidth * 0.04, 60);
    const W = innerWidth - gut * 2, H = innerHeight - (innerWidth < 900 ? 150 : 130);
    pFrame.style.width = 170 + (W - 170) * e + 'px';
    pFrame.style.height = 170 + (H - 170) * e + 'px';
    pFrame.style.borderRadius = 85 + (30 - 85) * e + 'px';
    pFrame.style.setProperty('--g', e.toFixed(3));
    pCap.style.setProperty('--c', clamp01((pp - 0.58) / 0.2).toFixed(3));
  }

  const journey = $('#journey'), track = $('#journeyTrack'), bar = $('#journeyBar'), chapters = [...track.children];
  function onScroll() {
    const max = document.documentElement.scrollHeight - innerHeight;
    S.scroll = max > 0 ? scrollY / max : 0;
    let p;
    if (isMobile) { // swipe rail: progress follows the rail's own scroll
      p = track.scrollLeft / Math.max(track.scrollWidth - track.clientWidth, 1);
    } else {
      const r = journey.getBoundingClientRect();
      p = Math.min(Math.max(-r.top / (r.height - innerHeight), 0), 1);
      track.style.transform = `translate3d(${-p * Math.max(track.scrollWidth - innerWidth, 0)}px,0,0)`;
    }
    bar.style.transform = `scaleX(${p})`;
    paintPortal();
    const on = Math.min(Math.round(p * (chapters.length - 1)), chapters.length - 1);
    chapters.forEach((ch, i) => ch.classList.toggle('on', i === on));
  }
  addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll); onScroll();
  if (isMobile) track.addEventListener('scroll', onScroll, { passive: true });

  addEventListener('pointermove', e => {
    S.mx = (e.clientX / innerWidth - 0.5) * 2; S.my = -(e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });

  // vinyl tilt
  document.querySelectorAll('.album').forEach(a => {
    a.addEventListener('pointermove', e => {
      const r = a.getBoundingClientRect();
      a.style.setProperty('--ry', ((e.clientX - r.left) / r.width - 0.5) * 26 + 'deg');
      a.style.setProperty('--rx', -((e.clientY - r.top) / r.height - 0.5) * 26 + 'deg');
    });
    a.addEventListener('pointerleave', () => { a.style.setProperty('--ry', '0deg'); a.style.setProperty('--rx', '0deg'); });
  });

  /* ---------- Orbit carousel ---------- */
  const stage = $('#orbitStage'), ring = $('#orbitRing');
  const N = D.clips.length, STEP = 360 / N;
  let radius = 0, rot = 0, vel = 0, target = null, dragging = false, moved = 0, lastX = 0, front = -1, visible = false, idleUntil = 0;

  const cards = D.clips.map((clip, i) => {
    const card = el('button', 'clip');
    card.setAttribute('aria-label', 'Play ' + clip.title);
    card.tabIndex = -1;
    const img = new Image();
    img.onload = () => {
      // YouTube serves a 120px placeholder when the HD thumb doesn't exist
      if (img.naturalWidth <= 120 && !img.src.includes('mqdefault')) { img.src = `https://i.ytimg.com/vi/${clip.id}/mqdefault.jpg`; return; }
      card.style.backgroundImage = `url(${img.src})`;
    };
    img.src = `https://i.ytimg.com/vi/${clip.id}/${isMobile ? 'mqdefault' : 'hq720'}.jpg`;
    card.addEventListener('click', () => { if (moved > 6) return; i === front ? openClip(i) : goTo(i); });
    ring.appendChild(card);
    return card;
  });

  function layout() {
    const w = parseFloat(getComputedStyle(stage).getPropertyValue('--w')) || 300;
    radius = Math.round((w * 1.12) / (2 * Math.tan(Math.PI / N)));
    cards.forEach((card, i) => { card.style.transform = `rotateY(${i * STEP}deg) translateZ(${radius}px)`; });
  }
  const norm = a => ((a + 180) % 360 + 360) % 360 - 180;
  function goTo(i) { target = rot + norm(-i * STEP - rot); idleUntil = performance.now() + 6000; }
  function setFront(i) {
    if (i === front) return;
    if (front >= 0) cards[front].classList.remove('front');
    front = i; cards[i].classList.add('front');
    const clip = D.clips[i];
    $('#orbitTitle').textContent = clip.title;
    $('#orbitSub').textContent = [clip.views && clip.views + ' views', clip.age, `${i + 1} / ${N}`].filter(Boolean).join(' · ');
  }
  function paint() {
    ring.style.transform = `translateZ(${-radius}px) rotateX(-5deg) rotateY(${rot}deg)`;
    for (let i = 0; i < N; i++) {
      const a = Math.abs(norm(i * STEP + rot));
      cards[i].style.setProperty('--o', a < 90 ? (1 - (a / 90) * 0.55).toFixed(2) : Math.max(0.16, 0.45 - ((a - 90) / 90) * 0.3).toFixed(2));
    }
    setFront(((Math.round(-rot / STEP) % N) + N) % N);
  }
  function tick(t) {
    if (visible) {
      if (dragging) { /* rot set by pointer */ }
      else if (target != null) {
        rot += (target - rot) * 0.075;
        if (Math.abs(target - rot) < 0.02) { rot = target; target = null; }
      } else if (Math.abs(vel) > 0.01) {
        rot += vel; vel *= 0.95;
        if (Math.abs(vel) < 0.12) { vel = 0; target = Math.round(rot / STEP) * STEP; }
      } else if (t > idleUntil && !document.body.classList.contains('playing')) {
        target = (Math.round(rot / STEP) - 1) * STEP; idleUntil = t + 4200; // idle: advance one moon at a time
      }
      paint();
    }
    requestAnimationFrame(tick);
  }
  layout(); paint(); addEventListener('resize', () => { layout(); paint(); });
  new IntersectionObserver(es => (visible = es[0].isIntersecting), { rootMargin: '200px' }).observe(stage);
  requestAnimationFrame(tick);

  stage.addEventListener('pointerdown', e => { dragging = true; moved = 0; lastX = e.clientX; vel = 0; target = null; stage.classList.add('drag'); });
  addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX; lastX = e.clientX; moved += Math.abs(dx);
    const k = (isMobile || innerWidth < 900) ? 0.16 : 0.07;
    rot += dx * k; vel = dx * k;
  });
  const endDrag = () => { if (!dragging) return; dragging = false; stage.classList.remove('drag'); idleUntil = performance.now() + 6000; if (Math.abs(vel) < 0.12) { vel = 0; target = Math.round(rot / STEP) * STEP; } };
  addEventListener('pointerup', endDrag); addEventListener('pointercancel', endDrag);
  stage.addEventListener('wheel', e => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // only horizontal swipes spin; vertical keeps scrolling the page
    e.preventDefault(); target = null; vel = -e.deltaX * 0.02; idleUntil = performance.now() + 6000;
  }, { passive: false });
  $('#orbitPrev').addEventListener('click', () => goTo((front - 1 + N) % N));
  $('#orbitNext').addEventListener('click', () => goTo((front + 1) % N));
  $('#orbitPlay').addEventListener('click', () => openClip(front));
  addEventListener('keydown', e => {
    if (!visible || e.target.matches('input,textarea') || !modal.hidden) return;
    if (e.key === 'ArrowLeft') goTo((front - 1 + N) % N);
    if (e.key === 'ArrowRight') goTo((front + 1) % N);
  });

  /* ---------- Clip player ---------- */
  const modal = $('#modal'), frame = $('#modalFrame');
  let resumeMusic = false;
  function openClip(i) {
    const clip = D.clips[i]; if (!clip) return;
    resumeMusic = DK.playing; pauseMusic();
    $('#modalGlow').style.backgroundImage = `url(https://i.ytimg.com/vi/${clip.id}/mqdefault.jpg)`;
    $('#modalTitle').textContent = clip.title;
    frame.innerHTML = `<iframe src="https://www.youtube.com/embed/${clip.id}?autoplay=1&rel=0&playsinline=1" title="${esc(clip.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    modal.hidden = false; document.body.classList.add('playing');
    $('#modalClose').focus();
  }
  function closeClip() {
    if (modal.hidden) return;
    modal.hidden = true; frame.innerHTML = ''; document.body.classList.remove('playing');
    if (resumeMusic) playMusic();
  }
  $('#modalClose').addEventListener('click', closeClip);
  modal.addEventListener('click', e => { if (e.target === modal) closeClip(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') closeClip(); });

  // Hooks the AI agent can call to drive the page.
  window.SITE = {
    setEvents(list) { renderTour(list, true); },
    playClip(i) { $('#clips').scrollIntoView({ behavior: 'smooth' }); goTo(i); setTimeout(() => openClip(i), 900); },
    goto(id) { const s = document.getElementById(id); if (s) s.scrollIntoView({ behavior: 'smooth' }); }
  };
})();
