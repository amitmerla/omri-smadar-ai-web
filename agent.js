// Side AI agent. Brain: Chrome built-in Gemini Nano (Prompt API), on-device, no keys.
// Knowledge: data.js baseline + live text pulled from the web in the browser, refreshed on a timer.
(function () {
  const D = window.OMRI;
  const $ = s => document.querySelector(s);
  const panel = $('#agent'), log = $('#agentLog'), input = $('#agentInput'), statusEl = $('#agentStatus'), foot = $('#agentFoot');

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
  async function fetchSource(src) {
    for (const reader of READERS) {
      try {
        const r = await fetch(reader(src.url), { signal: AbortSignal.timeout(12000) });
        if (!r.ok) continue;
        const text = src.pick(clean(await r.text()));
        if (text.length > 80) return `[${src.name}]\n${text}`;
      } catch (e) { /* try the next reader */ }
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
  }
  let refreshing = null;
  function refreshLive(force) {
    if (refreshing) return refreshing;
    if (!force && Date.now() - live.at < REFRESH_MS) return Promise.resolve(false);
    setStatus();
    refreshing = Promise.all(SOURCES.map(fetchSource)).then(parts => {
      const ok = parts.filter(Boolean);
      if (ok.length) {
        live = { at: Date.now(), text: ok.join('\n\n'), sources: SOURCES.filter((s, i) => parts[i]).map(s => s.name) };
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(live)); } catch (e) {}
        dropSession(); publishEvents();
      }
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
    try {
      const a = LM.availability ? await LM.availability() : (await LM.capabilities()).available;
      nano = (a === 'available' || a === 'readily') ? 'ready' : (a === 'unavailable' || a === 'no') ? 'none' : 'download';
    } catch (e) { nano = 'none'; }
    setStatus();
  }
  function dropSession() { if (base) { try { base.destroy(); } catch (e) {} base = null; } }
  function getSession() {
    if (base) return Promise.resolve(base);
    if (creating) return creating;
    const opts = {
      initialPrompts: [{ role: 'system', content: systemPrompt() }],
      monitor(m) { m.addEventListener('downloadprogress', e => { download = e.loaded; setStatus(); }); }
    };
    creating = LM.create(opts).then(s => { base = s; nano = 'ready'; download = null; return s; })
      .finally(() => { creating = null; setStatus(); });
    return creating;
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
    let answer = '';
    try {
      const acted = tryAction(q);
      if (acted) answer = acted;
      else if (nano === 'ready' || nano === 'download') {
        const s = await (await getSession()).clone();
        const ctx = history.slice(-2).map(h => `Earlier question: ${h.q}\nEarlier answer: ${h.a}`).join('\n');
        const stream = s.promptStreaming((ctx ? ctx + '\n\n' : '') + 'Question: ' + q);
        for await (const chunk of stream) {
          // older Chrome builds stream the full text so far, newer ones stream deltas
          answer = chunk.startsWith(answer) && answer ? chunk : answer + chunk;
          bubble.innerHTML = md(answer); log.scrollTop = log.scrollHeight;
        }
        s.destroy();
      } else answer = basicAnswer(q);
    } catch (e) {
      console.warn('agent', e);
      answer = answer || basicAnswer(q);
      if (nano !== 'none') add('note', 'On-device model hiccup. Answered from built-in facts.');
    }
    bubble.innerHTML = md(answer || 'I don\'t know that one.');
    history.push({ q, a: answer.slice(0, 400) });
    log.scrollTop = log.scrollHeight; busy = false;
  }

  function greet() {
    log.innerHTML = '';
    history.length = 0;
    add('ai', md('Hey. Ask me anything about **Omri Smadar**: shows, tracks, albums, his story. I can also play a clip for you.'));
    if (nano === 'none') add('note', 'Gemini Nano is not available in this browser, so I am in basic mode. Open in desktop Chrome with the built-in AI enabled for full answers.');
  }
  const CHIPS = ['When is the next show?', 'Most watched clips', 'Play Live at Masada', 'How did he start?', 'Tell me about the albums', 'How do I book him?'];
  $('#agentChips').innerHTML = CHIPS.map(c => `<button type="button">${c}</button>`).join('');
  $('#agentChips').addEventListener('click', e => { if (e.target.tagName === 'BUTTON') ask(e.target.textContent); });
  $('#agentForm').addEventListener('submit', e => { e.preventDefault(); ask(input.value); });
  $('#agentClear').addEventListener('click', greet);

  function open() {
    panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false');
    refreshLive(); setStatus();
    if (matchMedia('(min-width: 901px)').matches) setTimeout(() => input.focus(), 400);
  }
  function close() { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); }
  $('#askOpen').addEventListener('click', () => (panel.classList.contains('open') ? close() : open()));
  $('#agentClose').addEventListener('click', close);
  addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  checkNano().then(greet);
  if (!LM) greet();
  setStatus();
  publishEvents();
  refreshLive();
})();
