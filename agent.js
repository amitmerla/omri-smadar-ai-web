// Side AI agent. Brain: Chrome built-in Gemini Nano (Prompt API), on-device, no keys.
// Knowledge: data.js baseline + live text pulled from the web in the browser, refreshed on a timer.
(function () {
  const D = window.OMRI;
  const $ = s => document.querySelector(s);
  const panel = $('#agent'), log = $('#agentLog'), input = $('#agentInput'), statusEl = $('#agentStatus'), foot = $('#agentFoot');

  /* ---------- Trace: everything the agent does, timed, for the "under the hood" log ---------- */
  const traceEl = $('#trace'), traceBody = $('#traceBody');
  const groups = [], openRows = new Set();
  let gid = 0, paintQueued = false;
  const secs = ms => (ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + 's');
  function group(kind, title) {
    const g = { id: ++gid, kind, title, t0: performance.now(), end: 0, steps: [], meta: '' };
    groups.push(g); if (groups.length > 40) groups.shift();
    paintTrace(); return g;
  }
  function step(g, label, detail) {
    const s = { label, detail: detail || '', t: performance.now(), end: 0, state: 'run', body: '' };
    g.steps.push(s); paintTrace();
    return {
      set(d) { s.detail = d; paintTrace(); return this; },
      body(b) { s.body = b; return this; },
      done(d, state) { if (d != null) s.detail = d; s.end = performance.now(); s.state = state || 'ok'; paintTrace(); return this; }
    };
  }
  const note = (g, label, detail, body, state) => step(g, label, detail).body(body || '').done(null, state);
  function endGroup(g, meta) { g.end = performance.now(); g.meta = meta || ''; paintTrace(); }
  function paintTrace() {
    if (paintQueued || !traceEl.classList.contains('open')) return;
    paintQueued = true;
    requestAnimationFrame(() => {
      paintQueued = false;
      const now = performance.now(), stick = traceBody.scrollHeight - traceBody.scrollTop - traceBody.clientHeight < 60;
      traceBody.innerHTML = groups.map(g => {
        const total = Math.max((g.end || now) - g.t0, 1);
        const rows = g.steps.map((s, i) => {
          const dur = (s.end || now) - s.t, key = g.id + '-' + i, isOpen = openRows.has(key);
          return `<li class="ts ${s.state}${s.body ? ' has-body' : ''}${isOpen ? ' open' : ''}" data-k="${key}">
            <i class="ts-ico"></i><span class="ts-label">${escH(s.label)}</span><span class="ts-detail">${escH(s.detail)}</span>
            <span class="ts-bar"><u style="left:${((s.t - g.t0) / total * 100).toFixed(1)}%;width:${Math.max(dur / total * 100, 1.2).toFixed(1)}%"></u></span>
            <time>${secs(dur)}</time>${isOpen && s.body ? `<pre>${escH(s.body)}</pre>` : ''}</li>`;
        }).join('');
        return `<section class="tg ${g.end ? 'done' : 'run'} k-${g.kind}">
          <header><span class="tg-kind">${g.kind}</span><b dir="auto">${escH(g.title)}</b><time>${secs(total)}</time></header>
          <ol>${rows}</ol>${g.meta ? `<footer>${escH(g.meta)}</footer>` : ''}</section>`;
      }).join('') + `<p class="t-caret">${groups.some(g => !g.end) ? 'working' : 'idle, waiting for a question'}<i></i></p>`;
      if (stick) traceBody.scrollTop = traceBody.scrollHeight;
      paintStats();
    });
  }
  setInterval(() => { if (groups.some(g => !g.end)) paintTrace(); }, 100); // keeps running timers and bars moving
  traceBody.addEventListener('click', e => {
    const li = e.target.closest('.ts.has-body'); if (!li) return;
    openRows.has(li.dataset.k) ? openRows.delete(li.dataset.k) : openRows.add(li.dataset.k); paintTrace();
  });
  let usage = null; // { used, quota } in tokens, when the model reports it
  function paintStats() {
    const model = nano === 'ready' ? (base ? 'Nano · warm' : 'Nano · cold') : nano === 'download' ? 'Nano · not downloaded' : nano === 'checking' ? 'checking' : 'basic mode';
    $('#traceStats').innerHTML =
      `<span><em>model</em>${model}</span>` +
      `<span><em>context</em>${usage ? `${usage.used} / ${usage.quota} tok<i class="t-meter"><u style="width:${Math.min(usage.used / usage.quota * 100, 100).toFixed(0)}%"></u></i>` : 'n/a'}</span>` +
      `<span><em>web data</em>${live.at ? ago(live.at) : 'none'}</span>`;
  }
  function openTrace() { traceEl.classList.add('open'); traceEl.setAttribute('aria-hidden', 'false'); paintTrace(); }
  function closeTrace() { traceEl.classList.remove('open'); traceEl.setAttribute('aria-hidden', 'true'); }
  $('#traceOpen').addEventListener('click', () => (traceEl.classList.contains('open') ? closeTrace() : openTrace()));
  $('#traceClose').addEventListener('click', closeTrace);
  $('#traceClear').addEventListener('click', () => { groups.length = 0; openRows.clear(); paintTrace(); });

  /* ---------- Live web data ---------- */
  // Public pages are read through CORS-friendly readers. No user data is ever sent, only the page URL.
  const SOURCES = [
    { name: 'omrismadar.com', url: 'https://omrismadar.com/', pick: t => slice(t, /##\s*Upcoming events/i, /##\s*Merch/i, 3400) },
    { name: 'Bandcamp', url: 'https://omrismadar.bandcamp.com/music', pick: t => {
      const titles = [...t.matchAll(/\[\s*([^\]\n]+?)\s*\]\(https:\/\/omrismadar\.bandcamp\.com\/(?:album|track)\/[^)]+\)/g)].map(m => m[1]);
      return titles.length ? 'Discography on Bandcamp, newest first: ' + [...new Set(titles)].slice(0, 40).join('; ') : '';
    } }
  ];
  const READERS = [u => 'https://r.jina.ai/' + u, u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u)];
  const REFRESH_MS = 10 * 60 * 1000, CACHE_KEY = 'omri-live-v2';
  let live = { at: 0, text: '', sources: [] };
  try { live = JSON.parse(localStorage.getItem(CACHE_KEY)) || live; } catch (e) {}

  function slice(t, from, to, max) {
    const a = t.search(from); if (a < 0) return t.slice(0, max);
    const rest = t.slice(a); const b = rest.search(to);
    return rest.slice(0, b > 0 ? Math.min(b, max) : max);
  }
  function clean(t) {
    return t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\]\((https?:[^)\s?]{20,})\?[^)\s]{60,}\)/g, ']($1)').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  }
  async function fetchSource(src, g) {
    for (const reader of READERS) {
      const url = reader(src.url), st = step(g, 'fetch', `${src.name} via ${new URL(url).host}`);
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!r.ok) { st.done(`${src.name}: HTTP ${r.status} from ${new URL(url).host}`, 'warn'); continue; }
        const raw = await r.text(), text = src.pick(clean(raw));
        if (text.length > 80) { st.body(text).done(`${src.name}: ${raw.length} chars read, ${text.length} kept`); return `[${src.name}]\n${text}`; }
        st.done(`${src.name}: nothing usable in the page`, 'warn');
      } catch (e) { st.done(`${src.name}: ${e.name || 'error'} via ${new URL(url).host}`, 'warn'); /* try the next reader */ }
    }
    return null;
  }
  // Turn the live "Upcoming events" block into rows so the tour section on the page stays current too.
  function parseEvents(text) {
    const out = [], lines = text.replace(/[\u200b-\u200f]/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = 0; i + 3 < lines.length; i++) {
      const d = lines[i].match(/^##\s*([A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})/);
      const link = lines[i + 3].match(/^\[([^\]]+)\]\((https?:[^)\s]+)\)/);
      if (!d || !link || !lines[i + 1].startsWith('##') || !lines[i + 2].startsWith('##')) continue;
      const date = new Date(d[1] + ' 12:00'); if (isNaN(date)) continue;
      const [venue, city] = lines[i + 2].replace(/^##\s*/, '').split('|').map(s => s.trim());
      out.push({
        date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        title: lines[i + 1].replace(/^##\s*/, '').replace(/\s*\|\s*/g, ' — '), venue, city: city || '',
        status: /sold/i.test(link[1]) ? 'soldout' : 'tickets', url: link[2]
      });
    }
    return out;
  }
  function publishEvents() {
    const block = (live.text.split('[Bandcamp]')[0] || '');
    const evs = parseEvents(block);
    if (evs.length && window.SITE && window.SITE.setEvents) { D.events = evs; window.SITE.setEvents(evs); }
    return evs.length;
  }
  let refreshing = null;
  function refreshLive(force) {
    if (refreshing) return refreshing;
    if (!force && Date.now() - live.at < REFRESH_MS) return Promise.resolve(false);
    setStatus();
    const g = group('sync', 'Refresh live web data');
    refreshing = Promise.all(SOURCES.map(s => fetchSource(s, g))).then(parts => {
      const ok = parts.filter(Boolean);
      if (ok.length) {
        live = { at: Date.now(), text: ok.join('\n\n'), sources: SOURCES.filter((s, i) => parts[i]).map(s => s.name) };
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(live)); } catch (e) {}
        const had = !!base; dropSession();
        const n = publishEvents();
        note(g, 'parse', `${n} upcoming shows pushed to the tour section`);
        if (had) note(g, 'session', 'model session dropped so the next answer uses the new data', '', 'warn');
      }
      endGroup(g, ok.length ? `${ok.length}/${SOURCES.length} sources ok` : 'all sources unreachable, keeping built-in facts');
      return ok.length > 0;
    }).finally(() => { refreshing = null; setStatus(); });
    return refreshing;
  }
  setInterval(() => { if (!document.hidden) refreshLive(); }, 60 * 1000);

  /* ---------- Knowledge ---------- */
  const fmt = d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  function baseline() {
    return [
      'BIO: ' + D.journey.map(j => `${j.title} (${j.tag}): ${j.text}`).join(' | '),
      'UPCOMING SHOWS:\n' + D.events.map(e => `- ${fmt(e.date)}: ${e.title}, ${e.venue}, ${e.city}. ${e.status === 'soldout' ? 'SOLD OUT' : 'Tickets: ' + e.url}`).join('\n'),
      'EURO TOUR MAY 2026 (finished): ' + D.euroTour.map(t => `${t.city} (${t.venue})`).join(', '),
      'ALBUMS: ' + D.albums.map(a => `${a.title}. ${a.note} ${a.url}`).join(' | '),
      'YOUTUBE CLIPS (title, views): ' + D.clips.map(c => `${c.title}${c.views ? ' [' + c.views + ']' : ''}`).join('; '),
      'LINKS: ' + Object.entries(D.links).map(([k, v]) => `${k} ${v}`).join(', '),
      `CONTACT: Booking ${D.contact.booking.phone} (WhatsApp). Management: ${D.contact.management.name}, ${D.contact.management.phone}.`
    ].join('\n\n');
  }
  function systemPrompt() {
    return `You are the AI guide on a fan-made website about Omri Smadar, the Israeli composer, producer and live electronic artist.
Today is ${new Date().toDateString()}.
Answer only from the FACTS and LIVE DATA below. If the answer is not there, say you don't know and point to omrismadar.com or his Instagram.
Prefer LIVE DATA over FACTS when they disagree about shows.
About his private life: share only what is in the public bio below. Never guess or invent anything about family, relationships, health, money or where he lives.
Style: warm, short, 1 to 4 sentences or a tight list. Use markdown links [text](url) for tickets. Reply in the language of the question.

FACTS
${baseline()}

LIVE DATA (fetched ${live.at ? new Date(live.at).toLocaleString() : 'never'})
${live.text || 'none yet'}`;
  }

  /* ---------- Gemini Nano ---------- */
  const LM = self.LanguageModel || (self.ai && self.ai.languageModel) || null;
  let base = null, creating = null, nano = LM ? 'checking' : 'none', download = null;

  async function checkNano() {
    if (!LM) return;
    const g = group('boot', 'Check for the on-device model'), st = step(g, 'probe', 'LanguageModel.availability()');
    try {
      const a = LM.availability ? await LM.availability() : (await LM.capabilities()).available;
      nano = (a === 'available' || a === 'readily') ? 'ready' : (a === 'unavailable' || a === 'no') ? 'none' : 'download';
      st.done(`Chrome says: ${a}`, nano === 'none' ? 'warn' : 'ok');
    } catch (e) { nano = 'none'; st.done(e.message || 'failed', 'err'); }
    endGroup(g, nano === 'ready' ? 'Gemini Nano ready' : nano === 'download' ? 'model downloads on the first question' : 'basic mode');
    setStatus();
  }
  function dropSession() { if (base) { try { base.destroy(); } catch (e) {} base = null; } }
  function readUsage(s) {
    const used = s.inputUsage ?? s.tokensSoFar, quota = s.inputQuota ?? s.maxTokens;
    if (used != null && quota) usage = { used, quota };
  }
  function getSession(g) {
    if (base) { note(g, 'session', 'reusing the warm session (system prompt already loaded)'); return Promise.resolve(base); }
    if (creating) { const w = step(g, 'session', 'waiting for the session that is already loading'); return creating.then(s => { w.done('session ready'); return s; }); }
    const sys = systemPrompt();
    const st = step(g, 'session', `loading model + system prompt (${sys.length} chars)`).body(sys);
    const opts = {
      initialPrompts: [{ role: 'system', content: sys }],
      monitor(m) { m.addEventListener('downloadprogress', e => { download = e.loaded; st.set(`downloading model ${Math.round(e.loaded * 100)}%`); setStatus(); }); }
    };
    creating = LM.create(opts).then(s => {
      base = s; nano = 'ready'; download = null; readUsage(s);
      st.done(`session ready, system prompt ${sys.length} chars${usage ? ` = ${usage.used} tokens` : ''}`);
      return s;
    }, e => { st.done(`failed: ${e.message || e.name}`, 'err'); throw e; })
      .finally(() => { creating = null; setStatus(); });
    return creating;
  }
  // Loading the model and system prompt is the slow part, so do it before the first question when we can.
  function warmUp() {
    if (nano !== 'ready' || base || creating) return;
    const g = group('warm', 'Warm up the model');
    getSession(g).then(() => endGroup(g, 'first answer will skip the cold start'), () => endGroup(g, 'warm-up failed'));
  }

  /* ---------- Offline fallback (no model): keyword lookup over the same facts ---------- */
  function basicAnswer(q) {
    const s = q.toLowerCase();
    const has = (...w) => w.some(x => s.includes(x));
    const now = new Date();
    const up = D.events.filter(e => new Date(e.date + 'T23:59:59') >= now);
    if (has('tour', 'show', 'date', 'ticket', 'live', 'concert', 'next', 'when', 'where', 'הופע', 'כרטיס', 'מתי')) {
      return 'Upcoming shows:\n' + up.map(e => `- **${fmt(e.date)}** ${e.title}, ${e.venue}, ${e.city} · ${e.status === 'soldout' ? 'sold out' : `[tickets](${e.url})`}`).join('\n');
    }
    if (has('album', 'vinyl', 'record', 'release', 'collage', 'interplanetary', 'אלבום')) {
      return D.albums.map(a => `- **${a.title}**: ${a.note} [Bandcamp](${a.url})`).join('\n');
    }
    if (has('track', 'song', 'clip', 'video', 'popular', 'best', 'watch', 'remix', 'שיר', 'קליפ')) {
      const top = [...D.clips].sort((a, b) => num(b.views) - num(a.views)).slice(0, 5);
      return 'Most watched on his channel:\n' + top.map(c => `- **${c.title}** (${c.views} views)`).join('\n') + '\nSay "play" plus a title and I will open it.';
    }
    if (has('book', 'contact', 'manage', 'whatsapp', 'phone', 'email', 'הזמנ', 'קשר')) {
      return `Booking: ${D.contact.booking.phone} ([WhatsApp](${D.contact.booking.whatsapp})). Management: ${D.contact.management.name}, ${D.contact.management.phone}.`;
    }
    if (has('instagram', 'social', 'link', 'bandcamp', 'beatport', 'youtube', 'facebook')) {
      return Object.entries(D.links).map(([k, v]) => `[${k}](${v})`).join(' · ');
    }
    if (has('who', 'bio', 'born', 'story', 'life', 'private', 'family', 'start', 'kibbutz', 'age', 'מי ', 'חיים')) {
      return D.journey.map(j => `- **${j.title}**: ${j.text}`).join('\n') + '\nThat is what he has shared publicly. I don\'t speculate beyond it.';
    }
    return 'I can tell you about his shows, albums, clips, story and booking. For anything else, try [omrismadar.com](https://omrismadar.com/).';
  }
  const num = v => parseFloat(v) * (/K/.test(v) ? 1e3 : /M/.test(v) ? 1e6 : 1) || 0;

  /* ---------- Precomputed answers ---------- */
  // We wrote the suggestion chips, so we already know these questions. Their answers are built straight
  // from the data (live tour dates included) and never go to the model.
  const CHIPS = ['When is the next show?', 'Most watched clips', 'Play Live at Masada', 'How did he start?', 'Tell me about the albums', 'How do I book him?'];
  const upcoming = () => D.events.filter(e => new Date(e.date + 'T23:59:59') >= new Date()).sort((x, y) => x.date.localeCompare(y.date));
  const showLine = e => `**${fmt(e.date)}** · ${e.title}, ${e.venue}${e.city ? ', ' + e.city : ''}`;
  const CANNED = {
    'when is the next show?'() {
      const up = upcoming(); if (!up.length) return 'No upcoming shows are listed right now. Check [omrismadar.com](https://omrismadar.com/).';
      const next = up[0], open = up.find(e => e.status !== 'soldout');
      let s = `The next show is ${showLine(next)}. ` + (next.status === 'soldout' ? 'It is **sold out**.' : `[Get tickets](${next.url}).`);
      if (next.status === 'soldout' && open) s += `\nThe next one with tickets is ${showLine(open)}. [Get tickets](${open.url}).`;
      return s + (up.length > 1 ? `\n${up.length} shows are listed in total; they are all in the Tour section.` : '');
    },
    'most watched clips'() {
      const top = [...D.clips].sort((x, y) => num(y.views) - num(x.views)).slice(0, 5);
      return 'The five most watched clips on his channel:\n' + top.map(c => `- **${c.title}** · ${c.views} views`).join('\n') + '\nSay "play" and a title and I will open it.';
    },
    'how did he start?'() {
      return D.journey.slice(0, 7).map(j => `- **${j.tag}**: ${j.title}. ${j.text}`).join('\n');
    },
    'tell me about the albums'() {
      return D.albums.map(al => `- **${al.title}**: ${al.note} [Bandcamp](${al.url})`).join('\n');
    },
    'how do i book him?'() {
      const c = D.contact;
      return `**Booking:** ${c.booking.phone}, also on [WhatsApp](${c.booking.whatsapp}).\n**Management:** ${c.management.name}, ${c.management.phone}.`;
    }
  };

  /* ---------- Site actions the agent can take ---------- */
  function tryAction(q) {
    const s = q.toLowerCase();
    if (!/\b(play|watch|open|show me)\b|נגן|תנגן|תראה/.test(s)) return null;
    const words = s.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !['play', 'watch', 'open', 'show', 'the', 'clip', 'video', 'omri', 'smadar', 'live', 'feat', 'remix'].includes(w));
    let best = -1, score = 0;
    D.clips.forEach((c, i) => {
      const t = c.title.toLowerCase(); const sc = words.filter(w => t.includes(w)).length;
      if (sc > score) { score = sc; best = i; }
    });
    if (best < 0) return null;
    window.SITE && window.SITE.playClip(best);
    return `Landing on **${D.clips[best].title}**.`;
  }

  /* ---------- UI ---------- */
  function ago(ts) { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; }
  function setStatus() {
    const brain = nano === 'ready' ? 'Gemini Nano, on device' : nano === 'download' ? (download != null ? `Downloading model ${Math.round(download * 100)}%` : 'Gemini Nano, downloads on first question') : nano === 'checking' ? 'Checking model…' : 'Basic mode, no on-device model';
    const data = refreshing ? 'syncing web…' : live.at ? 'web synced ' + ago(live.at) : 'web data offline';
    statusEl.textContent = `${brain} · ${data}`;
    foot.textContent = live.at ? `Live sources: ${live.sources.join(', ')}. Answers can be wrong; check the ticket links.` : 'Using built-in facts. Live sources unreachable right now.';
  }
  const escH = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function md(text) {
    let h = escH(text)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">link</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    const lines = h.split('\n'); let out = '', inList = false;
    for (const l of lines) {
      const m = l.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
      if (m) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${m[1]}</li>`; }
      else { if (inList) { out += '</ul>'; inList = false; } if (l.trim()) out += (out && !out.endsWith('</ul>') ? '<br>' : '') + l; }
    }
    return out + (inList ? '</ul>' : '');
  }
  function add(cls, html) {
    const m = document.createElement('div'); m.className = 'msg ' + cls; m.dir = 'auto'; m.innerHTML = html;
    log.appendChild(m); log.scrollTop = log.scrollHeight; return m;
  }

  const history = [];
  let busy = false;
  async function ask(q) {
    q = q.trim(); if (!q || busy) return;
    busy = true; input.value = '';
    add('me', escH(q));
    const bubble = add('ai', '<span class="dots"><i></i><i></i><i></i></span>');
    // live stopwatch under the reply: counts from send until the answer has fully arrived
    const meta = add('meta run', '<i class="tm-ring"></i><b class="tm-time">0.0s</b><span class="tm-phase">thinking</span><button type="button" class="tm-log">View log</button>');
    const tEl = meta.querySelector('.tm-time'), phEl = meta.querySelector('.tm-phase'), t0 = performance.now();
    const tick = setInterval(() => { tEl.textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's'; }, 100);
    const g = group('ask', q);
    let answer = '', path = 'basic', firstAt = 0, chunks = 0, streamMs = 0;
    try {
      const pre = CANNED[q.toLowerCase()];
      const it = pre ? null : step(g, 'intent', 'is this a site action (play / open a clip)?');
      const acted = pre ? null : tryAction(q);
      if (it) it.done(acted ? 'yes: driving the page, no model needed' : 'no: this is a question');
      if (pre) { // a suggested question: we know the answer's shape, so build it from the data
        const cs = step(g, 'canned', 'suggested question: answer built from the data, model skipped');
        answer = pre(); cs.body(answer).done(); path = 'precomputed';
      } else if (acted) { answer = acted; path = 'action'; }
      else if (nano === 'ready' || nano === 'download') {
        path = 'nano';
        note(g, 'context', `built-in facts + live web data (${live.at ? 'synced ' + ago(live.at) : 'none'}, ${live.text.length} chars)`, live.text);
        phEl.textContent = base ? 'thinking' : 'loading model';
        const session = await getSession(g);
        const cl = step(g, 'clone', 'fork the session so this question starts from a clean context');
        const s = await session.clone(); cl.done();
        const ctx = history.slice(-2).map(h => `Earlier question: ${h.q}\nEarlier answer: ${h.a}`).join('\n');
        const prompt = (ctx ? ctx + '\n\n' : '') + 'Question: ' + q;
        const pr = step(g, 'prompt', `${prompt.length} chars${ctx ? `, with ${Math.min(history.length, 2)} earlier turn(s)` : ''}`).body(prompt);
        try {
          const n = await (s.measureInputUsage ? s.measureInputUsage(prompt) : s.countPromptTokens(prompt));
          readUsage(s); pr.done(`${prompt.length} chars = ${n} tokens`);
        } catch (e) { pr.done(); }
        phEl.textContent = 'thinking';
        const th = step(g, 'think', 'on-device inference, waiting for the first word');
        const stream = s.promptStreaming(prompt);
        let st = null;
        for await (const chunk of stream) {
          if (!firstAt) { firstAt = performance.now(); th.done(`first word after ${secs(firstAt - t0)}`); st = step(g, 'stream', ''); phEl.textContent = 'writing'; }
          // older Chrome builds stream the full text so far, newer ones stream deltas
          answer = chunk.startsWith(answer) && answer ? chunk : answer + chunk;
          chunks++; streamMs = performance.now() - firstAt;
          st.set(`${chunks} chunks, ${answer.length} chars, ${(chunks / Math.max(streamMs / 1000, 0.05)).toFixed(0)} tok/s`);
          bubble.innerHTML = md(answer); log.scrollTop = log.scrollHeight;
        }
        if (st) st.body(answer).done(); else th.done('model returned nothing', 'warn');
        readUsage(s); s.destroy();
      } else {
        note(g, 'model', 'Gemini Nano is not available in this browser', '', 'warn');
        const kw = step(g, 'lookup', 'keyword match over the built-in facts');
        answer = basicAnswer(q); kw.body(answer).done();
      }
    } catch (e) {
      console.warn('agent', e);
      note(g, 'error', e.message || e.name || 'unknown error', String(e.stack || e), 'err');
      if (!answer) { const kw = step(g, 'fallback', 'answering from built-in facts instead'); answer = basicAnswer(q); kw.done(); path = 'fallback'; }
      if (nano !== 'none') add('note', 'On-device model hiccup. Answered from built-in facts.');
    }
    clearInterval(tick);
    const total = performance.now() - t0;
    bubble.innerHTML = md(answer || 'I don\'t know that one.');
    const bits = [secs(total)];
    if (firstAt) bits.push(`first word ${secs(firstAt - t0)}`, `${(chunks / Math.max(streamMs / 1000, 0.05)).toFixed(0)} tok/s`);
    else bits.push(path === 'action' ? 'site action' : path === 'precomputed' ? 'precomputed, no AI' : path === 'nano' ? 'no output' : 'built-in facts');
    tEl.textContent = bits[0]; phEl.textContent = bits.slice(1).join(' · '); meta.classList.remove('run');
    note(g, 'render', `${answer.length} chars shown`);
    endGroup(g, `${path} · total ${bits.join(' · ')}`);
    history.push({ q, a: answer.slice(0, 400) });
    log.scrollTop = log.scrollHeight; busy = false;
  }
  log.addEventListener('click', e => { if (e.target.classList.contains('tm-log')) openTrace(); });

  function greet() {
    log.innerHTML = '';
    history.length = 0;
    add('ai', md('Hey. Ask me anything about **Omri Smadar**: shows, tracks, albums, his story. I can also play a clip for you.'));
    if (nano === 'none') add('note', 'Gemini Nano is not available in this browser, so I am in basic mode. Open in desktop Chrome with the built-in AI enabled for full answers.');
  }
  $('#agentChips').innerHTML = CHIPS.map(c => `<button type="button">${c}</button>`).join('');
  $('#agentChips').addEventListener('click', e => { if (e.target.tagName === 'BUTTON') ask(e.target.textContent); });
  $('#agentForm').addEventListener('submit', e => { e.preventDefault(); ask(input.value); });
  $('#agentClear').addEventListener('click', greet);

  function open() {
    panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false');
    refreshLive(); setStatus(); warmUp();
    if (matchMedia('(min-width: 901px)').matches) setTimeout(() => input.focus(), 400);
  }
  function close() { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); closeTrace(); }
  $('#askOpen').addEventListener('click', () => (panel.classList.contains('open') ? close() : open()));
  $('#agentClose').addEventListener('click', close);
  addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  checkNano().then(greet);
  if (!LM) { const g = group('boot', 'Check for the on-device model'); note(g, 'probe', 'no Prompt API in this browser', '', 'warn'); endGroup(g, 'basic mode: keyword answers from built-in facts'); greet(); }
  setStatus();
  publishEvents();
  refreshLive();
})();
