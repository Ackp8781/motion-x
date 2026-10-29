/* Site behaviour: theme toggle, mobile menu, scroll playhead, back to top, checksum copy, FAQ filter,
   search (/ or Ctrl+K), and the latest release info from GitHub. Everything from the network is
   written with textContent / attributes, never as HTML. */
(function () {
  const $ = id => document.getElementById(id);
  const root = document.documentElement;

  // ---- theme ----
  const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
  const MOON = '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>';
  const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches;
  function paintTheme() {
    const dark = isDark();
    $('themeIcon').innerHTML = dark ? SUN : MOON;   // fixed markup, no outside data
    $('themeBtn').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    document.querySelector('meta[name=theme-color]').setAttribute('content', dark ? '#0e0e0e' : '#f4f2ed');
  }
  $('themeBtn').addEventListener('click', () => {
    root.dataset.theme = isDark() ? 'light' : 'dark';
    try { localStorage.setItem('mx-theme', root.dataset.theme); } catch (e) {}
    paintTheme();
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', paintTheme);
  paintTheme();

  // ---- mobile menu ----
  const nav = $('navlinks'), menuBtn = $('menuBtn');
  const setMenu = open => { nav.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', String(open)); menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); };
  menuBtn.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
  nav.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });

  // ---- scroll playhead + back to top ----
  const head = $('playhead'), top = $('toTop');
  function onScroll() {
    const max = document.documentElement.scrollHeight - innerHeight;
    head.style.width = (max > 0 ? Math.min(100, scrollY / max * 100) : 0) + '%';
    top.classList.toggle('show', scrollY > innerHeight);
  }
  addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll); onScroll();
  top.addEventListener('click', () => { scrollTo({ top: 0 }); $('main').focus({ preventScroll: true }); });

  // ---- copy the checksum ----
  $('copyHash').addEventListener('click', async () => {
    const text = $('hash').textContent.trim();
    try { await navigator.clipboard.writeText(text); $('copied').textContent = 'Copied'; }
    catch (e) { const r = document.createRange(); r.selectNodeContents($('hash')); getSelection().removeAllRanges(); getSelection().addRange(r); $('copied').textContent = 'Press Ctrl+C'; }
    clearTimeout($('copied')._t); $('copied')._t = setTimeout(() => { $('copied').textContent = ''; }, 2000);
  });

  // ---- FAQ filter ----
  const faqs = [...document.querySelectorAll('#faqList details')];
  $('faqFilter').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase(); let n = 0;
    for (const d of faqs) { const hit = !q || d.textContent.toLowerCase().includes(q); d.hidden = !hit; if (hit) n++; if (q && hit) d.open = true; }
    $('faqNone').style.display = n ? 'none' : 'block';
  });

  // ---- search: effects, page sections and FAQ ----
  const dlg = $('search'), input = $('searchInput'), out = $('searchResults');
  const index = [];
  for (const [id, label] of [['try', 'Try the effects'], ['tour', 'Tour: keyframes, drawing, AI Enhance'], ['features', 'Features'], ['download', 'Download'], ['faq', 'Questions']])
    index.push({ label, kind: 'Section', go: () => location.hash = id });
  for (const h of document.querySelectorAll('.stop h3, .feature h3'))
    index.push({ label: h.textContent, kind: 'Feature', go: () => h.scrollIntoView() });
  faqs.forEach(d => index.push({ label: d.querySelector('summary').textContent, kind: 'Question', text: d.textContent, go: () => { d.hidden = false; d.open = true; d.scrollIntoView(); } }));
  if (window.AckFX) for (const d of Object.values(window.AckFX.DEFS)) if (d.kind === 'gl' && !d.hidden && d.cat !== 'Keying')
    index.push({ label: d.name, kind: 'Effect · ' + d.cat, go: () => { if (window.mxPlayground) window.mxPlayground.show(d.type); location.hash = 'try'; } });
  let hits = [], sel = 0;
  function render() {
    const q = input.value.trim().toLowerCase();
    hits = (q ? index.filter(i => (i.label + ' ' + i.kind + ' ' + (i.text || '')).toLowerCase().includes(q)) : index.filter(i => i.kind === 'Section')).slice(0, 30);
    sel = 0; out.replaceChildren();
    if (!hits.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Nothing found.'; out.append(li); return; }
    hits.forEach((h, i) => {
      const li = document.createElement('li'), a = document.createElement('a'), k = document.createElement('span');
      a.href = '#'; a.textContent = h.label; k.textContent = h.kind; a.append(k);
      a.addEventListener('click', e => { e.preventDefault(); choose(i); });
      li.append(a); out.append(li);
    });
    mark();
  }
  const mark = () => out.querySelectorAll('a').forEach((a, i) => a.classList.toggle('sel', i === sel));
  function choose(i) { const h = hits[i]; if (!h) return; dlg.close(); h.go(); }
  function openSearch() { if (dlg.open) return; input.value = ''; render(); dlg.showModal(); input.focus(); }
  $('searchBtn').addEventListener('click', openSearch);
  input.addEventListener('input', render);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(hits.length - 1, sel + 1); mark(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); mark(); e.preventDefault(); }
    else if (e.key === 'Enter') { choose(sel); e.preventDefault(); }
  });
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); openSearch(); }
  });

  // ---- latest release + last update, from GitHub ----
  const set = (k, v) => document.querySelectorAll(`[data-rel="${k}"]`).forEach(el => { el.textContent = v; });
  const date = s => new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const safeUrl = u => typeof u === 'string' && /^https:\/\/github\.com\/Ackp8781\/motion-x\//.test(u) ? u : null;
  fetch('https://api.github.com/repos/Ackp8781/motion-x/releases/latest').then(r => r.ok ? r.json() : null).then(rel => {
    if (!rel) return;
    if (typeof rel.tag_name === 'string') set('tag', rel.tag_name.slice(0, 20));
    const zip = (rel.assets || []).find(a => /\.zip$/i.test(a.name));
    if (zip) {
      set('size', Math.round(zip.size / 1048576) + ' MB');
      const u = safeUrl(zip.browser_download_url);
      if (u) document.querySelectorAll('[data-rel="link"]').forEach(a => { a.href = u; });
      if (zip.download_count > 0) set('count', ' · ' + zip.download_count.toLocaleString() + ' download' + (zip.download_count === 1 ? '' : 's'));
    }
    if (rel.published_at) set('date', ' · released ' + date(rel.published_at));
    const notes = safeUrl(rel.html_url); if (notes) document.querySelectorAll('[data-rel="notes"]').forEach(a => { a.href = notes; });
    // the release notes end with the checksum; show it if present
    const m = typeof rel.body === 'string' && rel.body.match(/\b([A-Fa-f0-9]{64})\b/);
    if (m) set('hash', m[1].toUpperCase());
  }).catch(() => {});
  fetch('https://api.github.com/repos/Ackp8781/motion-x').then(r => r.ok ? r.json() : null).then(repo => {
    if (repo && repo.pushed_at) $('updated').textContent = date(repo.pushed_at);
  }).catch(() => {});
})();
