// Access reconstruction UI. Mounts into a ShadowRoot or any element and talks to
// an "engine" (scan / setValue / activate / observe). The engine may be local or
// a proxy to another tab, so every call is awaited.
(() => {
  if (globalThis.AccessUI) return;

  const NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
    auto: 'M3 5h18v11H3zM8 20h8M12 16v4',
    refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
    external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    focus: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    contrast: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18M12 3a9 9 0 0 1 0 18z',
    back: 'M15 6l-6 6 6 6',
    next: 'M9 6l6 6-6 6',
    close: 'M6 6l12 12M18 6L6 18',
    go: 'M5 12h14M13 6l6 6-6 6',
    spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
    ruler: 'M3 8h18v8H3zM7 8v3M11 8v4M15 8v3M19 8v4',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1.1.9-2 2-2h2.3A3.7 3.7 0 0 0 21 11c0-4.4-4-8-9-8zM7.5 11h.01M10 7.5h.01M14 7.5h.01',
  };

  // ---------- Colour safety for the site's own look ----------
  const rgb = (value) => {
    const m = /rgba?\(([^)]+)\)/.exec(value || '');
    if (!m) return null;
    const [r, g, b] = m[1].split(/[,/ ]+/).filter(Boolean).map(Number);
    return [r, g, b].some(Number.isNaN) ? null : { r, g, b };
  };
  const luminance = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  // Keep the site's colour when it is readable on its background, otherwise swap to black/white.
  function readable(fg, bg, min = 4.5) {
    const back = rgb(bg);
    if (!back) return fg || 'inherit';
    const front = rgb(fg);
    if (front && ratio(front, back) >= min) return fg;
    return ratio({ r: 17, g: 17, b: 17 }, back) >= ratio({ r: 255, g: 255, b: 255 }, back) ? '#111111' : '#ffffff';
  }
  const stack = (family) => `${family || ''}${family ? ', ' : ''}system-ui, sans-serif`;
  const TYPES = ['text', 'email', 'url', 'tel', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'color', 'range', 'search', 'checkbox', 'radio'];
  const THEMES = [['auto', 'Site default colours', 'Auto'], ['light', 'Light theme', 'Light'], ['dark', 'Dark theme', 'Dark']];

  function normalize(saved = {}) {
    const prefs = { theme: 'auto', scale: 0, contrast: false, focus: false, look: 'site', ruler: false, rulerSize: 1, ...saved };
    prefs.look = 'site'; // the page always keeps the site's own look
    if (saved.large && saved.scale === undefined) prefs.scale = 1;
    delete prefs.large;
    prefs.purpose = ['motor', 'reader'].includes(prefs.purpose) ? prefs.purpose : 'focus';
    if (prefs.purpose !== 'focus') prefs.focus = false;
    if (!THEMES.some(([id]) => id === prefs.theme)) prefs.theme = 'auto';
    prefs.scale = Math.min(2, Math.max(0, Number(prefs.scale) || 0));
    prefs.rulerSize = Math.min(2, Math.max(0, Number(prefs.rulerSize) || 0));
    // Dwell click: hold the pointer on a target for this many ms (0 = off, null = automatic: 1.2 s on the big tiles only).
    prefs.dwell = [0, 800, 1200, 2000].includes(prefs.dwell) ? prefs.dwell : null;
    return prefs;
  }

  function group(items) {
    const sections = [];
    let current = null;
    for (const item of items) {
      if (item.kind === 'heading' && item.level <= 2) {
        current = { title: item.label, titleStyle: item.style, titleLevel: item.level, titleRuns: item.runs, items: [] };
        sections.push(current);
        continue;
      }
      if (!current) {
        current = { title: null, items: [] };
        sections.push(current);
      }
      current.items.push(item);
    }
    return sections.filter((s) => s.items.length);
  }

  // ---------- Focus mode: slide 1 is the whole redesigned page, the rest is only the main content ----------
  // Only what is worth concentrating on becomes a slide: article text, a picture with its description,
  // a story card, a real form. The logo, menus, links and search box stay on slide 1.
  // Rules, each from published guidance (see server/policies/focus.md):
  //  - one idea per slide, about 50 words at most (W3C COGA "keep text succinct", Mayer segmenting)
  //  - at most 5 bullets per slide (COGA "avoid too much content")
  //  - a picture is shown together with its description (Mayer contiguity)
  //  - a form stays together on one slide so people see everything they are asked
  const SLIDE_WORDS = 50;
  const SLIDE_POINTS = 5;
  const wordsOf = (text) => (text.match(/\S+/g) || []).length;

  // TEXT IN CAPITALS is hard to read (WebAIM); show it in sentence case.
  const calm = (text) => (text && /[A-Z]{3}/.test(text) && text === text.toUpperCase() ? text.charAt(0) + text.slice(1).toLowerCase() : text);

  function chunkText(text, budget = SLIDE_WORDS) {
    const sentences = text.split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/);
    const out = [];
    let current = [];
    let count = 0;
    for (const sentence of sentences) {
      const w = wordsOf(sentence);
      if (current.length && count + w > budget) { out.push(current.join(' ')); current = []; count = 0; }
      current.push(sentence);
      count += w;
    }
    if (current.length) out.push(current.join(' '));
    return out;
  }

  // Which items are "main content"? Claude's ranges win; otherwise the page's own landmarks; otherwise a guess.
  function contentTest(items, mainIds) {
    if (mainIds) return (item) => mainIds.has(item.id);
    if (items.some((i) => i.region === 'main')) return (item) => item.region === 'main';
    return (item) => item.region !== 'chrome' && (
      item.kind === 'heading' || item.kind === 'image' || item.kind === 'table' || item.kind === 'embed' || item.kind === 'code' || item.kind === 'field' || (item.kind === 'action' && !item.link)
      || (item.kind === 'text' && (item.list || wordsOf(item.label) >= 8))
      || (item.kind === 'action' && item.link && item.thumb && item.label.length > 30));
  }

  function buildSlides(sections, { mainIds }) {
    const flat = [];
    sections.forEach((section, si) => section.items.forEach((item) => { if (item.kind !== 'collapse') flat.push({ item, si, title: calm(section.title) }); }));
    const isContent = contentTest(flat.map((f) => f.item), mainIds);

    const slides = [{ kind: 'page', section: 0 }];
    const first = [];
    let totalWords = 0;
    let heading = null;
    let cont = false;
    let sectionIndex = -1;
    let sectionTitle = null;
    let paras = [];
    let paraWords = 0;
    let points = [];
    let card = null;
    let formItems = [];

    const push = (kind, extra) => {
      if (first[sectionIndex] === undefined) first[sectionIndex] = slides.length;
      slides.push({ kind, section: Math.max(sectionIndex, 0), sectionTitle, ...extra });
    };
    const showHeading = () => { const h = heading; const c = cont; cont = true; return { heading: h, cont: c }; };
    const flushRead = () => { if (paras.length) push('read', { ...showHeading(), paras }); paras = []; paraWords = 0; };
    const flushPoints = () => { if (points.length) push('points', { ...showHeading(), items: points }); points = []; };
    const flushCard = () => { if (card) push('card', { ...card }); card = null; };
    const flushForm = () => {
      if (formItems.filter((i) => i.kind === 'field').length >= 3) push('form', { ...showHeading(), items: formItems });
      formItems = [];
    };
    const flushAll = () => { flushRead(); flushPoints(); flushCard(); flushForm(); };

    for (const { item, si, title } of flat) {
      if (si !== sectionIndex) { flushAll(); sectionIndex = si; sectionTitle = title; heading = title; cont = false; }
      if (!isContent(item)) continue;

      if (item.kind === 'heading') { flushAll(); heading = calm(item.label); cont = false; continue; }
      if (item.kind === 'field' || (item.kind === 'action' && !item.link)) {
        flushRead(); flushPoints(); flushCard();
        formItems.push(item);
        continue;
      }
      flushForm();
      if (item.kind === 'text' && item.list) {
        flushRead(); flushCard();
        points.push(item);
        totalWords += wordsOf(item.label);
        if (points.length === SLIDE_POINTS) flushPoints();
        continue;
      }
      if (item.kind === 'image') {
        flushAll();
        card = { image: { src: item.src, alt: item.chart && item.altState !== 'text' ? '' : item.label }, caption: item.caption || (item.chart && item.altState === 'text' ? item.label : ''), paras: [], ...showHeading() };
        continue;
      }
      if (item.kind === 'table' || item.kind === 'embed' || item.kind === 'code') {
        flushAll();
        push(item.kind, { ...showHeading(), item });
        continue;
      }
      if (item.kind === 'action' && item.link) {
        if (!item.thumb) continue; // plain links stay on slide 1
        flushAll();
        totalWords += wordsOf(item.label);
        // A story link usually holds headline, summary and "3 hrs ago" run together; keep it readable as one passage.
        const time = /\s+\d+\s+(?:mins?|hrs?|hours?|days?)\s+ago\b.*$/i.exec(item.label);
        const text = calm(time ? item.label.slice(0, time.index) : item.label);
        const short = wordsOf(text) <= 12;
        card = {
          image: { src: item.thumb, alt: '' }, link: item, meta: time ? time[0].trim() : '',
          ...(short ? { headline: text, paras: [] } : { paras: chunkText(text, 60).slice(0, 1) }), ...showHeading(),
        };
        continue;
      }
      if (item.kind === 'text') {
        flushPoints();
        totalWords += wordsOf(item.label);
        if (card && card.paras.length < 2) { card.paras.push(...chunkText(calm(item.label), 60).slice(0, 1)); if (item.gist) card.gist = item.gist; continue; }
        flushCard();
        if (item.gist) { flushRead(); push('gist', { ...showHeading(), text: item.gist }); }
        for (const piece of chunkText(calm(item.label))) {
          const w = wordsOf(piece);
          if (paras.length && paraWords + w > SLIDE_WORDS) flushRead();
          paras.push(piece);
          paraWords += w;
        }
      }
    }
    flushAll();

    const minutes = Math.max(1, Math.round(totalWords / 200));
    slides.push({ kind: 'end', section: Math.max(sectionIndex, 0), count: slides.length - 1 });
    return { slides, first, minutes, words: totalWords };
  }

  function mount(root, engine, options = {}) {
    const { onClose, onOpenOriginal, onRedesign, onDescribe, onSite, onSiteStatus, onPreferences = () => {}, cssUrl } = options;
    // 'overlay' replaces the page in place with nothing but the site's own look plus a small dock.
    const overlay = options.mode === 'overlay';
    const doc = root.ownerDocument;
    const win = doc.defaultView;
    const api = {
      scan: async () => engine.scan(),
      setValue: async (id, value) => engine.setValue(id, value),
      activate: async (id) => engine.activate(id),
      open: async (href) => engine.open(href),
    };

    const make = (tag, text, cls) => {
      const node = doc.createElement(tag);
      if (text) node.textContent = text;
      if (cls) node.className = cls;
      return node;
    };
    const icon = (name) => {
      const svg = doc.createElementNS(NS, 'svg');
      const path = doc.createElementNS(NS, 'path');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('class', 'icon');
      svg.setAttribute('aria-hidden', 'true');
      path.setAttribute('d', ICONS[name]);
      svg.append(path);
      return svg;
    };
    // The Access mark: the accessibility figure (head, arms, body, legs), drawn in the current text colour.
    const figure = () => {
      const svg = doc.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '16 12 96 100');
      svg.setAttribute('class', 'figure');
      svg.setAttribute('aria-hidden', 'true');
      const head = doc.createElementNS(NS, 'circle');
      head.setAttribute('cx', '64'); head.setAttribute('cy', '27'); head.setAttribute('r', '11'); head.setAttribute('fill', 'currentColor');
      const body = doc.createElementNS(NS, 'path');
      body.setAttribute('d', 'M26 49c13 5 26 7 38 7s25-2 38-7M64 56v24M64 80 47 106M64 80l17 26');
      body.setAttribute('fill', 'none'); body.setAttribute('stroke', 'currentColor'); body.setAttribute('stroke-width', '11'); body.setAttribute('stroke-linecap', 'round'); body.setAttribute('stroke-linejoin', 'round');
      svg.append(head, body);
      return svg;
    };    // name is the accessible name; text (optional) is the visible label.
    const button = (name, { glyph, text, cls = '', onClick }) => {
      const b = make('button', null, `btn ${cls}`.trim());
      b.type = 'button';
      b.setAttribute('aria-label', name);
      if (glyph) b.append(icon(glyph));
      if (text) b.append(make('span', text, 'label'));
      b.onclick = onClick;
      return b;
    };

    const prefs = normalize(options.preferences);
    const system = win.matchMedia('(prefers-color-scheme: dark)');

    // Light and Dark change the page itself, not just the Access controls. Auto leaves the site as its designers made it.
    function themed(native) {
      if (!native || prefs.theme === 'auto') return native;
      const wantDark = prefs.theme === 'dark';
      const back = rgb(native.bg) || { r: 255, g: 255, b: 255 };
      if ((luminance(back) < 0.4) === wantDark) return native;
      const bg = wantDark ? 'rgb(20, 23, 28)' : 'rgb(255, 255, 255)';
      return {
        ...native, bg, color: wantDark ? 'rgb(232, 235, 241)' : 'rgb(22, 26, 32)', headingColor: wantDark ? 'rgb(255, 255, 255)' : 'rgb(13, 17, 23)',
        accent: readable(native.accent, bg, 3), accentInk: bg,
      };
    }
    let model = { title: '', url: '', sections: [], skipped: 0 };
    let signature = '';
    let current = 0;
    let pending = false;
    let token = 0;
    let lastRender = 0;
    let refreshTimer;
    const touched = new Set();
    let attempted = false;
    // Motor board: which tile is open (sec), which step of it, which page of tiles; whole = the old full page.
    // The whole page is the default; "Big tiles" switches to the board.
    let board = { sec: null, step: 0, page: 0, whole: true };

    // ---------- Frame ----------
    const panel = make('div', null, 'access');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Accessible page view');
    const styles = make('style');
    styles.textContent = ':host{display:block;height:100%}:host([hidden]){display:none}';
    const nodes = [styles];
    if (cssUrl) {
      const link = make('link');
      link.rel = 'stylesheet';
      link.href = cssUrl;
      nodes.push(link);
    }
    root.replaceChildren(...nodes, panel);

    const skip = make('a', 'Skip to page content', 'skip');
    skip.href = '#content';
    skip.onclick = (event) => { event.preventDefault(); main.focus(); };

    const bar = make('header', null, 'bar');
    const brand = make('div', null, 'brand');
    const mark = make('div', null, 'mark');
    mark.setAttribute('aria-hidden', 'true');
    mark.append(figure());
    brand.append(mark, make('span', 'Access', 'name'));

    const controls = make('div', null, 'controls');
    controls.setAttribute('role', 'toolbar');
    controls.setAttribute('aria-label', 'View settings');

    const originalBtn = onOpenOriginal && button('Back to original page', { glyph: 'external', text: 'Original', onClick: () => onOpenOriginal() });
    const refreshBtn = button('Refresh page', { glyph: 'refresh', text: 'Refresh', onClick: manualRefresh });
    // The Apify agent: reads this public website (its hidden menu and main pages) so the redesign can include them.
    // The Apify agent is part of the AI redesign: when the server has it set up, the one AI button reads the site first.
    let siteReady = false;
    if (onSite) {
      if (!onSiteStatus) siteReady = true;
      else Promise.resolve(onSiteStatus()).then((ok) => { siteReady = !!ok; }).catch(() => {});
    }
    const focusBtn = button('Focus mode', { glyph: 'focus', text: 'Focus', onClick: () => update({ purpose: prefs.purpose, focus: !prefs.focus }) });
    const readerBtn = button('Screen reader mode', { text: 'Screen reader', onClick: () => update({ purpose: prefs.purpose === 'reader' ? 'focus' : 'reader', focus: false }) });
    const motorBtn = button('Motor impairment', { text: 'Motor impairment', onClick: () => update({ purpose: prefs.purpose === 'motor' ? 'focus' : 'motor', focus: false }) });
    const contrastBtn = button('High contrast', { glyph: 'contrast', text: 'Contrast', onClick: () => update({ contrast: !prefs.contrast }) });
    const aiBtn = (onRedesign || onDescribe) && button('AI redesign with Claude', { glyph: 'spark', text: 'AI redesign', cls: overlay ? 'primary dockai' : '', onClick: () => toggleAi() });
    const rulerBtn = button('Reading line', { glyph: 'ruler', text: 'Reading line', onClick: () => update({ ruler: !prefs.ruler }) });
    const thinner = button('Thinner reading line', { cls: 'icon-only', onClick: () => update({ rulerSize: prefs.rulerSize - 1 }) });
    const thicker = button('Thicker reading line', { cls: 'icon-only', onClick: () => update({ rulerSize: prefs.rulerSize + 1 }) });
    thinner.append(make('span', '\u2013'));
    thicker.append(make('span', '+'));
    const lineSizes = make('div', null, 'segment');
    lineSizes.append(thinner, thicker);
    const smaller = button('Smaller text', { cls: 'icon-only', onClick: () => update({ scale: prefs.scale - 1 }) });
    const larger = button('Larger text', { cls: 'icon-only', onClick: () => update({ scale: prefs.scale + 1 }) });
    smaller.append(make('span', 'A−'));
    larger.append(make('span', 'A+'));
    const sizes = make('div', null, 'segment');
    sizes.append(smaller, larger);

    const themeGroup = make('div', null, 'segment');
    themeGroup.setAttribute('role', 'group');
    themeGroup.setAttribute('aria-label', 'Theme');
    const themeButtons = THEMES.map(([id, name]) => {
      const b = button(name, { glyph: id === 'auto' ? 'auto' : id === 'light' ? 'sun' : 'moon', cls: 'icon-only', onClick: () => update({ theme: id }) });
      b.dataset.theme = id;
      themeGroup.append(b);
      return b;
    });
    const closeBtn = onClose && button('Close view', { glyph: 'close', text: 'Close', onClick: () => onClose() });
    controls.append(...[originalBtn, refreshBtn, aiBtn, focusBtn, motorBtn, readerBtn, rulerBtn, lineSizes, contrastBtn, sizes, themeGroup, closeBtn].filter(Boolean));
    bar.append(brand, controls);

    // Overlay mode: the controls live in a small dock instead of a top bar.
    const dock = make('div', null, 'dock');
    if (overlay) {
      // A labelled pill, not a bare circle, so people can find where Screen reader, Focus and Motor impairment live.
      const toggle = make('button', null, 'btn dock-toggle');
      toggle.type = 'button';
      toggle.setAttribute('aria-label', 'Access settings');
      toggle.setAttribute('aria-expanded', 'false');
      const dockMark = make('span', null, 'dock-mark');
      dockMark.append(figure());
      toggle.append(dockMark, make('span', 'Access settings', 'dock-text'));
      const drawer = make('div', null, 'dockpanel');
      drawer.hidden = true;
      drawer.setAttribute('role', 'group');
      drawer.setAttribute('aria-label', 'Access settings');
      drawer.append(...[refreshBtn, focusBtn, motorBtn, readerBtn, rulerBtn, lineSizes, contrastBtn, sizes, themeGroup, closeBtn].filter(Boolean));
      const setOpen = (open) => { drawer.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); };
      toggle.onclick = () => setOpen(drawer.hidden);
      dock.onkeydown = (event) => { if (event.key === 'Escape' && !drawer.hidden) { setOpen(false); toggle.focus(); } };
      const row = make('div', null, 'dockrow');
      row.append(...[aiBtn, toggle].filter(Boolean));
      dock.append(drawer, row);
    }

    const layout = make('div', null, 'layout');
    const outline = make('nav', null, 'outline');
    outline.setAttribute('aria-label', 'Page outline');
    // A div, not <main>: in screen reader mode the page's own landmarks (banner, main, ...) must not be nested inside another main.
    const main = make('div', null, 'page');
    main.id = 'content';
    main.setAttribute('role', 'main');
    main.tabIndex = -1;
    layout.append(...(overlay ? [main] : [outline, main]));
    // In focus mode Enter commits the answer and moves to the next step.
    panel.addEventListener('keydown', (event) => {
      // Arrow keys move between slides unless the person is typing in a field.
      if (!prefs.focus || event.altKey || event.ctrlKey || event.metaKey || !['ArrowRight', 'ArrowLeft'].includes(event.key)) return;
      const target = event.composedPath()[0];
      if (target.matches?.('input:not([type="checkbox"]):not([type="radio"]),select,textarea,[contenteditable]')) return;
      event.preventDefault();
      goSlide(slideIndex + (event.key === 'ArrowRight' ? 1 : -1));
    });
    main.addEventListener('keydown', async (event) => {
      const field = event.target;
      if (!prefs.focus || event.key !== 'Enter' || !field.matches?.('input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])')) return;
      event.preventDefault();
      await field.onchange?.();
      goSlide(slideIndex + 1);
    });

    const status = make('p', null, 'status');
    status.setAttribute('role', 'status');

    const sheet = make('div', null, 'sheet');
    sheet.hidden = true;
    // Container queries live on the shell so the toast and dialog can stay fixed to the viewport.
    const shell = make('div', null, 'shell');
    shell.append(...(overlay ? [skip, layout] : [skip, bar, layout]));
    const band = make('div', null, 'ruler');
    band.setAttribute('aria-hidden', 'true');
    panel.append(shell, band, status, sheet);
    if (overlay) panel.append(dock);
    panel.dataset.mode = overlay ? 'overlay' : 'panel';

    // The toast fades after a few seconds so it never sits on top of the content.
    let announceTimer;
    function announce(text, quiet = false) {
      // quiet: read by screen readers but not drawn, for what the screen already shows (the step title).
      status.classList.toggle('quiet', quiet);
      status.textContent = text;
      clearTimeout(announceTimer);
      announceTimer = setTimeout(() => { status.textContent = ''; }, 7000);
    }

    const motor = globalThis.AccessMotor?.mount({
      panel, main, root, control: options.onMotorControl, announce,
      getDwell: () => prefs.dwell,
      setDwell: (ms) => { prefs.dwell = ms; onPreferences({ ...prefs }); },
      boardOn: () => boardShown(),
      canBoard: () => model.sections.length > 0,
      toggleBoard: () => {
        // The toolbar button: tiles on, or back to the whole page.
        if (boardShown()) board.whole = true;
        else { board.whole = false; board.sec = null; }
        paint();
      },
    });

    // ---------- Preferences ----------
    function applyPrefs() {
      if (model.nativeTheme) model.theme = themed(model.nativeTheme);
      const resolved = prefs.theme === 'auto' ? (system.matches ? 'dark' : 'light') : prefs.theme;
      panel.dataset.resolved = resolved;
      panel.dataset.scale = String(prefs.scale);
      panel.dataset.contrast = String(prefs.contrast);
      panel.dataset.focus = String(prefs.focus);
      motorBtn.setAttribute('aria-pressed', String(prefs.purpose === 'motor'));
      readerBtn.setAttribute('aria-pressed', String(prefs.purpose === 'reader'));
      // In screen reader mode the rebuilt page declares its own landmarks, so this wrapper must not be one.
      main.setAttribute('role', prefs.purpose === 'reader' ? 'none' : 'main');
      panel.dataset.purpose = prefs.purpose;
      if (aiBtn) {
        const reading = prefs.purpose === 'reader';
        aiBtn.setAttribute('aria-label', reading ? 'Describe images with Claude' : 'AI redesign with Claude');
        const text = aiBtn.querySelector('.label');
        if (text) text.textContent = reading ? 'Describe images' : 'AI redesign';
      }
      motor?.setActive(prefs.purpose === 'motor');
      panel.classList.toggle('large', prefs.scale > 0);
      themeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === prefs.theme)));
      panel.dataset.look = prefs.look;
      contrastBtn.setAttribute('aria-pressed', String(prefs.contrast));
      aiBtn?.setAttribute('aria-pressed', String(prefs.purpose === 'reader' ? Object.keys(aiDescriptions).length > 0 : !!aiSpec));
      rulerBtn.setAttribute('aria-pressed', String(prefs.ruler));
      band.hidden = !prefs.ruler;
      band.style.setProperty('--h', `${[64, 96, 144][prefs.rulerSize] * SCALES[prefs.scale]}px`);
      thinner.disabled = prefs.rulerSize <= 0;
      thicker.disabled = prefs.rulerSize >= 2;
      focusBtn.setAttribute('aria-pressed', String(prefs.focus));
      smaller.disabled = prefs.scale <= 0;
      larger.disabled = prefs.scale >= 2;
    }
    function update(change) {
      const enteringMotor = change.purpose === 'motor' && prefs.purpose !== 'motor';
      const enteringReader = change.purpose === 'reader' && prefs.purpose !== 'reader';
      if (change.purpose && change.purpose !== prefs.purpose) { aiSpec = null; aiMainIds = null; if (model.base) model.sections = model.base; }
      Object.assign(prefs, normalize({ ...prefs, ...change }));
      if (change.focus && model.sections.length) {
        slideIndex = 0;
      }
      if (enteringMotor) { board = { sec: null, step: 0, page: 0, whole: true }; motor?.setActive(true, true); }
      applyPrefs();
      paint();
      if (enteringReader) announceReader();
      onPreferences({ ...prefs });
    }
    system.addEventListener('change', applyPrefs);

    // Reading line: everything is dimmed except a horizontal band that follows the pointer,
    // or the keyboard focus. Digital reading rulers have controlled evidence of helping readers.
    const moveBand = (y) => band.style.setProperty('--y', `${Math.round(y)}px`);
    moveBand(win.innerHeight * 0.4);
    const onPointer = (event) => { if (prefs.ruler) moveBand(event.clientY); };
    const onFocus = (event) => {
      const target = event.composedPath()[0];
      if (!prefs.ruler || !target?.getBoundingClientRect || target.closest?.('.dock,.sheet')) return;
      const box = target.getBoundingClientRect();
      moveBand(box.top + box.height / 2);
    };
    win.addEventListener('pointermove', onPointer, { passive: true });
    panel.addEventListener('focusin', onFocus);

    // ---------- AI focus plan: Claude may only hide, fold, order and label (see server/policies/focus.md) ----------
    let aiSpec = null;
    let aiMainIds = null; // ids Claude marked as the main content, for the focus slides
    let aiBusy = false;
    let aiDescriptions = {}; // image and icon descriptions from Claude, by item id (screen reader mode)
    const wordCount = (text) => (text.match(/\S+/g) || []).length;
    const LINK_RUN = 8;

    // Long runs of plain links (menus, footers) are folded locally: no AI, no tokens.
    function foldLinkRuns(items) {
      if (prefs.purpose === 'motor') return items;
      const out = [];
      let run = [];
      const flush = () => {
        if (run.length >= LINK_RUN) out.push({ id: `fold-${run[0].id}`, kind: 'collapse', label: `Links (${run.length}): ${run.slice(0, 3).map((l) => l.label.slice(0, 24)).join(', ')}…`, items: run });
        else out.push(...run);
        run = [];
      };
      for (const item of items) {
        if (item.kind === 'action' && item.link) run.push(item);
        else { flush(); out.push(item); }
      }
      flush();
      return out;
    }

    // Applies Claude's operations to the page's own sections. Anything not named stays where it was.
    function applyOps(sections, ops) {
      const all = sections.flatMap((s) => s.items);
      const byId = new Map(all.map((i) => [i.id, i]));
      const gist = new Map(ops.gists.map((g) => [g.id, g.text]));
      const withGist = (item) => (gist.has(item.id) ? { ...item, gist: gist.get(item.id) } : item);
      const hidden = new Set(ops.hide.map((h) => h.id));
      const foldOf = new Map(ops.collapse.flatMap((c) => c.ids.map((id) => [id, c.label])));
      const chunkAt = new Map(ops.chunks.map((c) => [c.startId, c.title]));
      // Claude names stretches of the page (from one item to another) that are the main content.
      const order = all.filter((i) => i.kind !== 'collapse').map((i) => i.id);
      aiMainIds = new Set();
      for (const range of ops.main) {
        const a = order.indexOf(range.from);
        const b = order.indexOf(range.to);
        if (a >= 0 && b >= a) order.slice(a, b + 1).forEach((id) => aiMainIds.add(id));
      }
      hidden.forEach((id) => aiMainIds.delete(id));
      if (!aiMainIds.size) aiMainIds = null;

      // Claude says where a stretch with a different purpose begins (steps, a chart, a key fact...). It becomes its own
      // section so it can be designed for that purpose; nothing is moved, removed or reworded.
      const layoutAt = new Map((ops.layout || []).map((l) => [l.startId, l]));
      const out = [];
      const tucked = [];
      for (const section of sections) {
        let piece = { ...section, items: [] };
        const pieces = [piece];
        let fold = null;
        for (const item of section.items) {
          if (hidden.has(item.id)) { tucked.push(item); continue; }
          const hint = layoutAt.get(item.id) || (item.kind === 'collapse' ? layoutAt.get(item.items?.[0]?.id) : undefined);
          if (hint) {
            if (piece.items.length) {
              piece = { title: item.kind === 'heading' ? null : hint.title || null, titleStyle: section.titleStyle, titleLevel: 2, items: [], aiRole: hint.role };
              pieces.push(piece);
              fold = null;
            } else {
              piece.aiRole = hint.role;
              if (hint.title && !piece.title && item.kind !== 'heading') piece.title = hint.title;
            }
          }
          if (foldOf.has(item.id)) {
            const label = foldOf.get(item.id);
            if (fold && fold.label === label) fold.items.push(item);
            else { fold = { id: `fold-${item.id}`, kind: 'collapse', label, items: [item] }; piece.items.push(fold); }
            continue;
          }
          fold = null;
          if (chunkAt.has(item.id)) piece.items.push({ id: `chunk-${item.id}`, kind: 'heading', level: 3, label: chunkAt.get(item.id) });
          piece.items.push(withGist(item));
        }
        for (const part of pieces) if (part.items.length) out.push(part);
      }
      if (tucked.length) {
        out.push({ title: null, srTitle: 'Hidden by Claude', items: [{ id: 'hidden-by-claude', kind: 'collapse', label: `Hidden by Claude (${tucked.length}) - show`, items: tucked }] });
      }
      return out;
    }

    function plan(base) {
      if (!aiSpec) aiMainIds = null;
      const folded = base.map((s) => ({ ...s, items: foldLinkRuns(s.items) }));
      return aiSpec ? applyOps(folded, aiSpec) : folded;
    }

    function askConsent(kind = 'text') {
      motor?.beforePaint();
      return new Promise((resolve) => {
        pending = true;
        const dialog = make('div', null, 'dialog');
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'ai-title');
        if (kind === 'site') {
          const heading = make('h2', 'Let Apify and Claude redesign this website?');
          heading.id = 'ai-title';
          const yes = button('Send and redesign', { text: 'Send and redesign', cls: 'primary' });
          const no = button('Not now', { text: 'Not now' });
          const finish = (answer) => { pending = false; sheet.hidden = true; sheet.replaceChildren(); resolve(answer); };
          yes.onclick = () => finish(true);
          no.onclick = () => finish(false);
          dialog.onkeydown = (event) => { if (event.key === 'Escape') no.click(); };
          const buttons = make('div', null, 'row');
          buttons.append(yes, no);
          dialog.append(heading,
            make('p', 'First, Access sends this page’s web address, without anything after a ? or #, to Apify, a web-scraping service, through your own Access server. Apify reads the page and the pages its main menu links to, so the redesign can show menu items the page hides and the site’s other pages.'),
            make('p', 'Then Access sends the page’s headings, text and button labels, and the names of the site’s pages, to Claude (Anthropic) to plan the layout. Nothing is deleted, and you can undo it. Only public sites can be read. What you type into fields, passwords and sign-ins are never sent.'), buttons);
          sheet.replaceChildren(dialog);
          sheet.hidden = false;
          no.focus();
          return;
        }
        const images = kind === 'images';
        const title = make('h2', images ? 'Let Claude describe the pictures on this page?' : prefs.purpose === 'motor' ? 'Let Claude organize this page for motor access?' : 'Let Claude help you focus on this page?');
        title.id = 'ai-title';
        const yes = button(images ? 'Send and describe' : 'Send and redesign', { text: images ? 'Send and describe' : 'Send and redesign', cls: 'primary' });
        const no = button('Not now', { text: 'Not now' });
        const done = (answer) => { pending = false; sheet.hidden = true; sheet.replaceChildren(); resolve(answer); };
        yes.onclick = () => done(true);
        no.onclick = () => done(false);
        dialog.onkeydown = (event) => { if (event.key === 'Escape') no.click(); };
        const row = make('div', null, 'row');
        row.append(yes, no);
        if (images) {
          dialog.append(title,
            make('p', 'Access will download this page’s pictures and the words next to them, and send them to Claude (Anthropic) through your own Access server so your screen reader can read what they show.'),
            make('p', 'Descriptions are written automatically and can be wrong. Passwords, what you type into fields and the rest of your screen are never sent.'), row);
          sheet.replaceChildren(dialog);
          sheet.hidden = false;
          no.focus();
          return;
        }
        dialog.append(title,
          make('p', prefs.purpose === 'motor' ? 'Access sends page headings, text and button labels to Claude through your local server. Claude may suggest section headings. All content and actions stay available; head control, hover scrolling and the keyboard work locally.' : 'Access will send this page’s headings, text and button labels to Claude (Anthropic) through your own Access server. Claude can only hide distractions, fold side content, put the main content first, add short headings and write short gists of long text. Nothing is deleted, and you can undo it.'),
          make('p', 'What you type into fields, and passwords, are never sent.'), row);
        sheet.replaceChildren(dialog);
        sheet.hidden = false;
        no.focus();
      });
    }

    // ---------- The Apify agent: what it found is merged into the page like any other content ----------
    let siteData = null;
    let siteBusy = false;
    let siteError = '';
    const hrefKey = (href) => { try { const u = new URL(href); return `${u.origin}${u.pathname.replace(/\/+$/, '')}${u.search}`; } catch { return String(href); } };
    const siteHere = () => { try { return !!siteData && new URL(model.url).origin === siteData.origin; } catch { return false; } };

    // What Claude may use about the site as a whole (short, plain, untrusted).
    function siteContext() {
      if (!siteHere()) return undefined;
      return { title: siteData.title, description: siteData.description, menu: siteData.menu.slice(0, 12).map((m) => m.label), pages: siteData.pages.slice(0, 8).map((p) => p.title) };
    }

    // Menu items the page hides (drop-downs) join the navigation, and the site's other pages become a related section.
    function withSite(items, snapshot) {
      if (!siteData || !siteHere()) return items;
      const theme = snapshot.theme || {};
      const links = items.filter((i) => i.kind === 'action' && i.link && i.href);
      const have = new Set(links.map((i) => hrefKey(i.href)));
      have.add(hrefKey(snapshot.url));
      const linkStyle = links[0]?.style || { color: theme.color, font: theme.font, weight: '400', size: theme.size || 16, underline: true };
      const textStyle = items.find((i) => i.kind === 'text')?.style || { color: theme.color, font: theme.font, weight: '400', size: theme.size || 16 };
      const headStyle = items.find((i) => i.kind === 'heading')?.style || { color: theme.headingColor, font: theme.headingFont, weight: '700', size: 28 };
      const out = items.slice();
      const fresh = siteData.menu.filter((m) => !have.has(hrefKey(m.href)));
      if (fresh.length) {
        let at = -1;
        items.forEach((i, n) => { if (i.kind === 'action' && i.link && (i.landmark === 'navigation' || i.landmark === 'banner')) at = n; });
        const anchor = at >= 0 ? items[at] : null;
        out.splice(at + 1, 0, ...fresh.map((m, n) => ({
          id: `site-menu-${n}`, kind: 'action', link: true, label: m.label, href: m.href, fromSite: true, style: linkStyle,
          region: 'chrome', landmark: anchor?.landmark || 'navigation', landmarkId: anchor?.landmarkId ?? -50, landmarkLabel: anchor?.landmarkLabel || 'Site menu',
        })));
      }
      const pages = siteData.pages.filter((p) => !have.has(hrefKey(p.url)));
      if (pages.length) {
        const place = { region: 'chrome', landmark: 'complementary', landmarkId: -60, landmarkLabel: 'Elsewhere on this site' };
        out.push({ id: 'site-pages-heading', kind: 'heading', level: 2, label: 'Elsewhere on this site', style: headStyle, ...place });
        pages.forEach((p, n) => {
          out.push({ id: `site-page-${n}`, kind: 'action', link: true, label: p.title, href: p.url, fromSite: true, style: linkStyle, block: `site-block-${n}`, ...place });
          if (p.description) out.push({ id: `site-page-text-${n}`, kind: 'text', label: p.description, style: textStyle, block: `site-block-${n}`, ...place });
        });
      }
      siteData.added = { menu: fresh.length, pages: pages.length };
      return out;
    }

    // Part of the AI redesign: returns true when the site was read. A failure is explained and the redesign goes on without it.
    async function readSite() {
      if (siteBusy || !onSite) return false;
      siteBusy = true;
      announce('Reading this site with Apify. This can take up to a minute.');
      try {
        const result = await onSite({ url: model.url, consent: true });
        siteData = result?.site || result;
        await render(true);
        return true;
      } catch (error) {
        siteError = error.message || 'Could not read this site.';
        announce(`${siteError} Continuing with this page only.`);
        return false;
      } finally {
        siteBusy = false;
      }
    }

    // Screen reader mode: Claude looks at the pictures and names the icon buttons the page forgot to label.
    async function describeFlow() {
      if (aiBusy || !onDescribe) return;
      if (!prefs.imageConsent) {
        if (!(await askConsent('images'))) { aiBtn.focus(); return; }
        prefs.imageConsent = true;
        onPreferences({ ...prefs });
      }
      const request = AccessReader.describeRequest(model.all || [], {
        title: model.title, lang: model.lang, descriptions: aiDescriptions, referer: model.url,
        host: (() => { try { return new URL(model.url).host; } catch { return ''; } })(),
      });
      if (!request.images.length && !request.controls.length) { announce('Every picture and button on this page already has a description.'); return; }
      aiBusy = true;
      aiBtn.disabled = true;
      main.setAttribute('aria-busy', 'true');
      announce(`Asking Claude to describe ${request.images.length} pictures and name ${request.controls.length} buttons. This can take up to a minute.`);
      try {
        const result = await onDescribe(request);
        if (prefs.purpose !== 'reader') return;
        for (const d of result.images || []) aiDescriptions[d.id] = d;
        for (const c of result.controls || []) aiDescriptions[c.id] = { ...(aiDescriptions[c.id] || {}), label: c.label };
        aiPageSummary = result.summary || aiPageSummary;
        paint();
        announce(`Claude described ${(result.images || []).length} pictures and named ${(result.controls || []).length} buttons. They are now in the page.`);
      } catch (error) {
        announce(error.message || 'Image descriptions failed.');
      } finally {
        aiBusy = false;
        aiBtn.disabled = false;
        main.removeAttribute('aria-busy');
        applyPrefs();
        aiBtn.focus();
      }
    }

    async function toggleAi() {
      if (prefs.purpose === 'reader') return describeFlow();
      if (aiBusy) return;
      if (aiSpec) {
        aiSpec = null;
        await render(true);
        applyPrefs();
        announce('Showing the standard redesign.');
        return;
      }
      const withSiteMap = siteReady && !siteHere();
      if (withSiteMap && !prefs.siteConsent) {
        if (!(await askConsent('site'))) { aiBtn.focus(); return; }
        prefs.siteConsent = true;
        prefs.aiConsent = true;
        onPreferences({ ...prefs });
      } else if (!prefs.aiConsent) {
        if (!(await askConsent())) { aiBtn.focus(); return; }
        prefs.aiConsent = true;
        onPreferences({ ...prefs });
      }
      aiBusy = true;
      aiBtn.disabled = true;
      try {
        let siteNote = '';
        if (withSiteMap) {
          if (await readSite()) {
            const { menu = 0, pages = 0 } = siteData.added || {};
            siteNote = ` With Apify: ${plural(menu, 'menu link', 'menu links')} the page was hiding and ${plural(pages, 'other page', 'other pages')} added.`;
            announce(`Read the site.${siteNote} Asking Claude to plan it. This can take up to a minute.`);
          } else siteNote = ` The site could not be read, so only this page was used: ${siteError}`;
        } else announce(siteHere() ? 'Asking Claude to plan the whole site. This can take up to a minute.' : 'Asking Claude to plan this page. This can take up to a minute.');
        const folded = model.base.flatMap((s) => prefs.purpose === 'motor' ? s.items : foldLinkRuns(s.items));
        const items = folded.filter((i) => i.kind !== 'collapse');
        const payload = {
          purpose: prefs.purpose,
          site: siteContext(),
          title: model.title,
          host: (() => { try { return new URL(model.url).host; } catch { return ''; } })(),
          note: items.length < folded.length ? 'Long menus and link lists were already folded and are not listed.' : '',
          items: items.map(({ id, kind, level, type, required, link, label, region, chart }) => ({
            id, kind, level, type, required, link, region, chart, label: label.slice(0, 120), words: kind === 'text' ? wordCount(label) : undefined,
          })),
        };
        const result = await onRedesign(payload);
        if (payload.purpose !== prefs.purpose) return;
        aiSpec = result;
        await render(true);
        const n = (list) => list.length;
        announce(`Claude organized this page: ${n(aiSpec.main)} main content areas found, ${n(aiSpec.hide)} distractions hidden, ${n(aiSpec.collapse)} groups folded.${siteNote}`);
      } catch (error) {
        aiSpec = null;
        announce(error.message || 'The AI redesign failed.');
      } finally {
        aiBusy = false;
        aiBtn.disabled = false;
        applyPrefs();
        aiBtn.focus();
      }
    }

    // ---------- Actions ----------
    async function run(item) {
      attempted = true;
      const seen = pageKeys();
      try {
        // A link only the Apify agent found is not on the page: open its address instead.
        if (item.fromSite) { announce(await api.open(item.href)); return; }
        announce(await api.activate(item.id));
        setTimeout(async () => { await render(); showWhatChanged(seen); }, 450);
      } catch (error) {
        announce(error.message);
      }
    }

    function request(item, trigger) {
      motor?.beforePaint();
      if (!item.confirm) { run(item); return; }
      pending = true;
      const dialog = make('div', null, 'dialog');
      dialog.setAttribute('role', 'alertdialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'confirm-title');
      const title = make('h2', 'Run this on the original page?');
      title.id = 'confirm-title';
      const motorMode = prefs.purpose === 'motor';
      const yes = button('Confirm action', { text: motorMode ? 'Yes, do it' : 'Confirm action', cls: 'primary' });
      const no = button('Cancel', { text: motorMode ? 'No, go back' : 'Cancel', cls: motorMode ? 'safe' : '' });
      const close = (after) => { pending = false; sheet.hidden = true; sheet.replaceChildren(); after(); };
      yes.onclick = () => close(() => { run(item); refreshBtn.focus(); });
      no.onclick = () => close(() => trigger.focus());
      dialog.onkeydown = (event) => {
        if (event.key === 'Escape') { no.click(); return; }
        if (event.key !== 'Tab') return;
        const [first, last] = [yes, no];
        const active = root.activeElement || doc.activeElement;
        if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
      };
      const row = make('div', null, 'row');
      // For head or gaze control the safe answer comes first and is the one focused.
      row.append(...(motorMode ? [no, yes] : [yes, no]));
      dialog.append(title, make('p', `"${item.label}" may submit information or change the page.`), row);
      sheet.replaceChildren(dialog);
      sheet.hidden = false;
      no.focus();
    }

    // ---------- Rendering ----------
    const SCALES = [1, 1.2, 1.45];
    const isSite = () => prefs.look === 'site' && !!model.theme && !boardShown();

    // Copy the site's typography onto a node, keeping its colour only when readable on `bg`.
    function skin(node, st, bg, { min = 15, max = 60 } = {}) {
      if (!st) return node;
      node.style.color = readable(st.color, bg);
      node.style.fontFamily = stack(st.font);
      node.style.fontWeight = st.weight;
      if (st.italic) node.style.fontStyle = 'italic';
      if (st.transform && st.transform !== 'none') node.style.textTransform = st.transform;
      if (st.spacing && st.spacing !== 'normal') node.style.letterSpacing = st.spacing;
      if (st.underline) node.style.textDecoration = 'underline';
      node.style.fontSize = `${Math.min(Math.max(st.size || 16, min), max) * SCALES[prefs.scale]}px`;
      return node;
    }
    function skinBox(node, st, bg, limits) {
      skin(node, st, st.bg || bg, limits);
      node.style.background = st.bg || 'transparent';
      node.style.border = st.border || '0';
      node.style.borderRadius = st.radius;
      return node;
    }

    // Decorative: the button's text already names it.
    function thumbImage(src) {
      const img = make('img', null, 'thumb');
      img.src = src;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      return img;
    }

    function actionButton(item) {
      if (!isSite()) {
        const b = button(item.label, { text: item.label, cls: 'action', onClick: () => request(item, b) });
        b.removeAttribute('aria-label');
        if (item.thumb) b.prepend(thumbImage(item.thumb));
        b.disabled = !!item.disabled;
        const tag = make('span', item.link ? 'Link' : 'Action', 'tag');
        tag.setAttribute('aria-hidden', 'true');
        b.append(tag, icon(item.link ? 'external' : 'go'));
        return b;
      }
      const b = make('button', item.shown || item.label, item.link ? 'slink' : 'sbtn');
      if (item.shown) b.setAttribute('aria-label', item.label);
      b.type = 'button';
      b.disabled = !!item.disabled;
      b.onclick = () => request(item, b);
      skinBox(b, item.style, model.theme.bg, { max: 28 });
      if (item.style.bg) b.dataset.filled = '1';
      // A long link is a headline (a story, a product): show its picture on top and the text as a title.
      const headline = item.link && item.label.length > 36;
      if (item.thumb) {
        const pic = thumbImage(item.thumb);
        if (headline) pic.className = 'thumb cover';
        b.prepend(pic);
      }
      if (headline) b.classList.add('headline');
      if (item.link) { b.style.textDecoration = item.style.underline ? 'underline' : 'none'; b.style.border = '0'; }
      return b;
    }

    function fieldBlock(item) {
      const site = isSite();
      const bg = site ? model.theme.bg : null;
      const isCheck = ['checkbox', 'radio'].includes(item.type);
      const wrap = make('div', null, isCheck ? 'field check' : 'field');
      const label = make('label', item.label + (item.required ? ' (required)' : ''));
      const input = make(item.type === 'select' ? 'select' : item.type === 'textarea' ? 'textarea' : 'input');
      input.id = `ui-${item.id}`;
      label.htmlFor = input.id;
      if (input.tagName === 'INPUT') input.type = TYPES.includes(item.type) ? item.type : 'text';
      for (const option of item.options || []) {
        const o = make('option', option.label);
        o.value = option.value;
        o.disabled = option.disabled;
        input.append(o);
      }
      input.value = item.value || '';
      if (item.placeholder && input.tagName !== 'SELECT') input.placeholder = item.placeholder;
      if (isCheck) input.checked = item.checked;
      input.disabled = !!item.disabled || !!item.multiple;
      input.required = !!item.required;
      if (site) {
        skin(label, item.labelStyle || { ...item.style, weight: '600', size: item.style.size }, bg, { max: 28 });
        if (!isCheck) {
          const fieldBg = item.style.bg || bg;
          skin(input, item.style, fieldBg, { max: 28 });
          input.style.background = fieldBg;
          input.style.border = item.style.border || `2px solid ${readable('#767676', fieldBg, 3)}`;
          input.style.borderRadius = item.style.radius;
        }
      }
      // Don't scold an empty field before the person has touched it or tried to submit.
      const shown = touched.has(item.id) || attempted ? item.error : '';
      const error = make('p', shown || '', 'error');
      error.id = `error-${item.id}`;
      input.setAttribute('aria-describedby', error.id);
      input.setAttribute('aria-invalid', String(!!shown));
      input.onchange = async () => {
        touched.add(item.id);
        try {
          announce(await api.setValue(item.id, isCheck ? input.checked : input.value));
          // Keep the model current so the "check your answers" slide shows what was typed.
          if (isCheck) item.checked = input.checked; else item.value = input.value;
          const fresh = (await api.scan()).items.find((x) => x.id === item.id);
          error.textContent = fresh?.error || '';
          input.setAttribute('aria-invalid', String(!!fresh?.error));
          if (item.type === 'radio') render(true);
        } catch (e) {
          announce(e.message);
        }
      };
      if (prefs.purpose === 'motor' && item.type === 'select' && !input.disabled) {
        input.addEventListener('mousedown', (event) => event.preventDefault());
        input.addEventListener('click', () => pickOption(item, input, input));
        input.addEventListener('keydown', (event) => { if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); pickOption(item, input, input); } });
      }
      if (isCheck) wrap.append(input, label, error);
      else wrap.append(label, input, error);
      if (item.multiple) wrap.append(make('p', 'Use the original page for multiple selection.', 'note'));
      return wrap;
    }

    // A figure keeps its picture, drawing or chart together with the caption the page gave it.
    function imageBlock(item) {
      const figure = make('figure', null, item.chart ? 'fig chart' : 'fig');
      const img = make('img', null, 'pic');
      img.src = item.src;
      img.alt = item.chart && item.altState !== 'text' ? '' : item.label;
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.style.maxWidth = `min(100%, ${item.width}px)`;
      img.style.borderRadius = item.style.radius;
      // Reserve the picture's space while it loads, so the page does not jump.
      if (item.width && item.height) img.style.aspectRatio = `${item.width} / ${item.height}`;
      if (item.chart && item.altState !== 'text') img.setAttribute('role', 'img');
      figure.append(img);
      const caption = item.caption || (item.chart && item.altState === 'text' ? item.label : '');
      if (caption) figure.append(make('figcaption', caption));
      return figure;
    }

    // Text with its links, bold and italics kept in place (the engine sends them as runs).
    function richText(node, item) {
      if (!item.runs) { node.textContent = item.label; return node; }
      node.textContent = '';
      for (const run of item.runs) {
        let part;
        if (run.link) {
          const a = make('a', run.t, 'inlink');
          a.href = run.href || '#';
          a.onclick = (event) => { event.preventDefault(); request({ id: run.link, label: run.t, link: true, href: run.href }, a); };
          part = a;
        } else part = doc.createTextNode(run.t);
        for (const [flag, tag] of [['b', 'strong'], ['i', 'em'], ['c', 'code'], ['sup', 'sup'], ['sub', 'sub']]) {
          if (!run[flag]) continue;
          const wrap = make(tag);
          wrap.append(part);
          part = wrap;
        }
        node.append(part);
      }
      return node;
    }

    // A data table, in full, with a scrollable frame so wide tables are never cut off.
    function tableBlock(item, rows = item.rows, headerRows = item.headerRows) {
      const figure = make('figure', null, 'fig tablefig');
      const frame = make('div', null, 'tablewrap');
      frame.tabIndex = 0;
      frame.setAttribute('role', 'region');
      frame.setAttribute('aria-label', item.caption || item.label);
      const table = make('table', null, 'dtable');
      if (item.caption) table.append(make('caption', item.caption));
      const head = make('thead');
      const body = make('tbody');
      rows.forEach((row, r) => {
        const tr = make('tr');
        for (const cell of row) {
          const th = r < headerRows || cell.h;
          const td = make(th ? 'th' : 'td');
          if (th) td.scope = r < headerRows ? 'col' : 'row';
          if (cell.span > 1) td.colSpan = cell.span;
          if (cell.link) {
            const a = make('a', cell.t, 'inlink');
            a.href = cell.href || '#';
            a.onclick = (event) => { event.preventDefault(); request({ id: cell.link, label: cell.t, link: true, href: cell.href }, a); };
            td.append(a);
          } else td.textContent = cell.t;
          tr.append(td);
        }
        (r < headerRows ? head : body).append(tr);
      });
      if (head.children.length) table.append(head);
      table.append(body);
      frame.append(table);
      figure.append(frame);
      return figure;
    }

    // Video, audio, frames and interactive graphics cannot be rebuilt, so they stay visible as a clear card with a way back to the page.
    function embedBlock(item) {
      const card = make('aside', null, `embed ${item.embed || ''}`);
      card.setAttribute('aria-label', item.label);
      if (item.poster) { const img = thumbImage(item.poster); img.className = 'embed-poster'; card.append(img); }
      const text = make('div', null, 'embed-text');
      const kind = { video: 'Video', audio: 'Audio', canvas: 'Interactive graphic', iframe: 'Embedded content' }[item.embed] || 'Embedded content';
      text.append(make('small', kind + (item.host ? ` · ${item.host}` : ''), 'embed-kind'), make('strong', item.label), make('span', 'This is interactive or media content. Use the original page to play or explore it.', 'embed-note'));
      if (item.caption) text.append(make('span', item.caption, 'embed-note'));
      card.append(text);
      if (onOpenOriginal) card.append(button('Open the original page', { glyph: 'external', text: 'Original page', onClick: () => onOpenOriginal() }));
      return card;
    }

    function codeBlock(item) {
      const pre = make('pre', null, 'codeblock');
      pre.tabIndex = 0;
      pre.append(make('code', item.label));
      return pre;
    }

    function sectionCard(section, index) {
      const site = isSite();
      const theme = model.theme;
      const card = make('section', null, site ? 'section site-section' : 'section');
      card.id = `sec-${index}`;
      const heading = make('h2');
      heading.tabIndex = -1;
      if (site) {
        if (section.title) {
          heading.append(doc.createTextNode(section.title));
          skin(heading, { ...(section.titleStyle || {}), font: section.titleStyle?.font || theme.headingFont, color: section.titleStyle?.color || theme.headingColor }, theme.bg, { min: 26, max: 52 });
          heading.classList.add('site-title');
        } else {
          heading.className = 'vh';
          heading.append(doc.createTextNode(section.srTitle || 'Start of page'));
        }
      } else {
        const number = make('small', String(index + 1).padStart(2, '0'));
        number.setAttribute('aria-hidden', 'true');
        heading.append(number, doc.createTextNode(section.title || 'Start of page'));
      }
      card.append(heading);

      fillItems(card, section.items);
      return card;
    }

    // Places items the way the original grouped them: shared rows stay together,
    // runs of buttons/links share a row, list items become a real list.
    function fillItems(card, items) {
      const site = isSite();
      const theme = model.theme;
      // Consecutive items that share a row/entry in the original are kept together.
      const chunks = [];
      for (const item of items) {
        const last = chunks[chunks.length - 1];
        if (item.block && last && last.block === item.block) last.items.push(item);
        else chunks.push({ block: item.block, items: [item] });
      }

      let actions = null;
      let list = null;
      let cards = null;
      let gallery = null;
      let lastFigure = null;
      const reset = () => { actions = null; list = null; cards = null; gallery = null; lastFigure = null; };
      const headingTag = (item) => (item.level >= 5 ? 'h5' : item.level === 4 ? 'h4' : 'h3');
      const addItem = (item, into) => {
        if (item.kind === 'heading') {
          const h = richText(make(headingTag(item)), item);
          if (site) skin(h, item.style, theme.bg, { min: 18, max: 40 });
          into.append(h);
        } else if (item.kind === 'text') {
          const p = richText(make(item.quote ? 'blockquote' : 'p'), item);
          if (site) skin(p, item.style, theme.bg);
          if (item.gist) {
            const box = make('details', null, 'gistbox');
            const summary = make('summary');
            summary.append(make('b', 'In short: '), doc.createTextNode(item.gist));
            box.append(summary, p);
            into.append(box);
          } else {
            into.append(p);
          }
        } else if (item.kind === 'collapse') {
          const box = make('details', null, 'fold');
          box.append(make('summary', item.label));
          const inner = make('div', null, 'foldbody');
          fillItems(inner, item.items);
          box.append(inner);
          into.append(box);
        } else if (item.kind === 'image') {
          into.append(imageBlock(item));
        } else if (item.kind === 'table') {
          into.append(tableBlock(item));
        } else if (item.kind === 'embed') {
          into.append(embedBlock(item));
        } else if (item.kind === 'code') {
          into.append(codeBlock(item));
        } else if (item.kind === 'action') {
          into.append(actionButton(item));
        } else {
          into.append(fieldBlock(item));
        }
      };
      for (const chunk of chunks) {
        if (chunk.items.length > 1) {
          reset();
          const row = make('div', null, 'cluster');
          for (const item of chunk.items) addItem(item, row);
          card.append(row);
          continue;
        }
        const [item] = chunk.items;
        if (item.kind === 'action') {
          // Links with a picture or a headline are cards in a grid; other links and buttons share a row.
          if (item.link && item.thumb && item.label.length > 20) {
            actions = null; list = null; gallery = null; lastFigure = null;
            if (!cards) { cards = make('div', null, 'cards'); card.append(cards); }
            cards.append(actionButton(item));
            continue;
          }
          list = null; cards = null; gallery = null; lastFigure = null;
          if (!actions) { actions = make('div', null, 'actions'); card.append(actions); }
          actions.append(actionButton(item));
          continue;
        }
        if (item.kind === 'image' && !item.chart && item.width < 900) {
          // Two or more pictures in a row become a gallery.
          actions = null; list = null; cards = null;
          const figure = imageBlock(item);
          if (gallery) gallery.append(figure);
          else if (lastFigure && lastFigure.parentNode === card) {
            gallery = make('div', null, 'gallery');
            card.insertBefore(gallery, lastFigure);
            gallery.append(lastFigure, figure);
          } else { card.append(figure); lastFigure = figure; }
          continue;
        }
        actions = null; cards = null; gallery = null; lastFigure = null;
        if (item.kind === 'text' && item.list && !item.quote) {
          if (!list || list.tagName !== (item.ordered ? 'OL' : 'UL')) { list = make(item.ordered ? 'ol' : 'ul', null, 'items'); card.append(list); }
          const li = richText(make('li'), item);
          if (site) skin(li, item.style, theme.bg);
          list.append(li);
          continue;
        }
        list = null;
        addItem(item, card);
      }
      return card;
    }

    // The framed canvas that carries the original site's colours and fonts.
    function siteFrame() {
      const t = model.theme;
      const frame = make('div', null, overlay ? 'site bleed' : 'site');
      const back = rgb(t.bg) || { r: 255, g: 255, b: 255 };
      const dark = luminance(back) < 0.4;
      frame.style.background = t.bg;
      frame.style.color = readable(t.color, t.bg);
      frame.style.fontFamily = stack(t.font);
      frame.style.setProperty('--pd-bg', t.bg);
      // When Light or Dark changes the site's own mode, logos drawn for the other mode get a small backing so they stay visible.
      if (model.nativeTheme && model.nativeTheme !== t) frame.dataset.forced = prefs.theme;
      frame.style.setProperty('--ring', dark ? '#ffffff' : '#111111');
      frame.style.setProperty('--halo', dark ? '#111111' : '#ffffff');
      return frame;
    }

    // ---------- Motor board: a few tiles, one short step at a time, nothing to scroll ----------
    // Why: pointing with the head or eyes is imprecise, so every target must be large, there must be few of them on
    // screen, and scrolling must not be needed. A tile opens by dwell (hold still while a ring fills) or by a click;
    // hovering alone never acts. The board uses the extension's own plain palette, not the site's.
    const STEP_WEIGHT = 6;
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const isButton = (i) => i.kind === 'action' && !i.link;
    const isLink = (i) => i.kind === 'action' && i.link;
    function boardShown() { return prefs.purpose === 'motor' && !board.whole && !!model.sections.length; }

    function boardItems(items) {
      const flat = [];
      const walk = (list) => list.forEach((i) => (i.kind === 'collapse' ? walk(i.items) : flat.push(i)));
      walk(items);
      // Long paragraphs become short ones, and long tables a few rows at a time, so one screen never needs scrolling.
      return flat.flatMap((i) => {
        if (i.kind === 'text' && wordsOf(i.label) > 45) return chunkText(i.label, 40).map((label) => ({ ...i, label, runs: undefined }));
        if (i.kind === 'table' && i.rows.length > i.headerRows + 5) {
          const header = i.rows.slice(0, i.headerRows);
          const body = i.rows.slice(i.headerRows);
          const parts = [];
          for (let k = 0; k * 5 < body.length; k++) {
            parts.push({ ...i, id: `${i.id}-r${k}`, rows: [...header, ...body.slice(k * 5, k * 5 + 5)], caption: `${i.caption || i.label}${k ? ` (rows ${k * 5 + 1}–${Math.min(body.length, k * 5 + 5)})` : ` (rows 1–5 of ${body.length})`}` });
          }
          return parts;
        }
        return [i];
      });
    }

    const stepWeight = (i) => (i.kind === 'field' ? (['checkbox', 'radio'].includes(i.type) ? 2 : 3)
      : i.kind === 'action' ? (i.link ? 1 : 2) : i.kind === 'heading' ? 1 : i.kind === 'image' ? 3
        : i.kind === 'table' ? STEP_WEIGHT : i.kind === 'embed' || i.kind === 'code' ? 4 : 1 + Math.ceil(wordsOf(i.label) / 22));

    function stepsOf(items) {
      const steps = [];
      let step = [];
      let used = 0;
      for (const item of boardItems(items)) {
        const w = stepWeight(item);
        if (step.length && used + w > STEP_WEIGHT) {
          // A heading never ends a screen: it travels with the thing it introduces.
          const orphan = step.at(-1).kind === 'heading' && step.length > 1 ? step.pop() : null;
          steps.push(step);
          step = orphan ? [orphan] : [];
          used = step.reduce((n, i) => n + stepWeight(i), 0);
        }
        step.push(item);
        used += w;
      }
      if (step.length) steps.push(step);
      // A screen that would hold nothing but one button joins the screen before it when there is room.
      const total = (s) => s.reduce((n, i) => n + stepWeight(i), 0);
      for (let k = steps.length - 1; k > 0; k--) {
        if (steps[k].every(isButton) && total(steps[k - 1]) + total(steps[k]) <= STEP_WEIGHT + 2) { steps[k - 1].push(...steps[k]); steps.splice(k, 1); }
      }
      return steps;
    }

    // Tiles are built from the page's sections, but a tile must be worth opening: sections that are only a menu are
    // gathered into one "Menu" tile, and tiny sections (a button and a line of text) into one "Quick actions" tile.
    const heavy = (i) => i.kind === 'field' || i.kind === 'table' || i.kind === 'image' || i.kind === 'embed' || i.kind === 'code' || (i.kind === 'text' && wordsOf(i.label) >= 14);
    let tileCache = { model: null, tiles: [] };

    function boardTiles() {
      if (tileCache.model === model) return tileCache.tiles;
      const tiles = [];
      let quick = null;
      let menu = null;
      const gather = (kind, section) => {
        const slot = kind === 'quick' ? quick : menu;
        if (slot) { slot.parts.push(section); return; }
        const tile = { kind, parts: [section] };
        tiles.push(tile);
        if (kind === 'quick') quick = tile; else menu = tile;
      };
      for (const section of model.sections) {
        const flat = boardItems(section.items);
        if (!flat.length) continue;
        if (flat.every(isLink)) gather('menu', section);
        else if (flat.length <= 3 && !flat.some(heavy)) gather('quick', section);
        else tiles.push({ kind: 'section', parts: [section] });
      }
      for (const tile of tiles) {
        if (tile.parts.length === 1) tile.kind = 'section';
        tile.items = tile.parts.length === 1 ? tile.parts[0].items
          : tile.parts.flatMap((part) => [...(part.title ? [{ id: `part-${firstId(part.items[0] || {})}`, kind: 'heading', level: 3, label: calm(part.title), style: part.titleStyle }] : []), ...part.items]);
        tile.flat = boardItems(tile.items);
        tile.key = firstId(tile.parts[0].items[0] || {});
        tile.heading = tile.parts.length === 1 ? calm(tile.parts[0].title) || '' : '';
      }
      tileCache = { model, tiles };
      return tiles;
    }

    const clipSnippet = (text, max) => {
      const t = String(text || '').replace(/\s+/g, ' ').trim();
      if (t.length <= max) return t;
      return `${t.slice(0, max).replace(/\s+\S*$/, '').replace(/[,;:.\-–—]+$/, '')}…`;
    };
    const nice = (i) => clipSnippet(calm(i.label).replace(/\s*\(required\)$/i, ''), 40);
    const listOf = (labels) => (labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : labels[0] || '');

    // What a tile says on the outside, from what is inside it (Claude's wording replaces this when it is available).
    function nameTile(tile) {
      const items = tile.flat;
      const of = (kind) => items.filter((i) => i.kind === kind);
      const fields = of('field');
      const tables = of('table');
      const texts = of('text').filter((i) => wordsOf(i.label) >= 3);
      const buttons = items.filter(isButton);
      const links = items.filter(isLink);
      const pictures = items.filter((i) => i.kind === 'image' || i.kind === 'embed');
      const inner = items.find((i) => i.kind === 'heading');
      let title = tile.heading;
      if (!title) {
        if (tile.kind === 'menu') title = 'Menu and links';
        else if (tile.kind === 'quick') title = 'Quick actions';
        else if (links.length >= 2 && !fields.length && !tables.length && texts.every((x) => wordsOf(x.label) < 8)) title = 'Site menu';
        else if (inner) title = clipSnippet(calm(inner.label), 40);
        else if (fields.length) title = `Fill in ${nice(fields[0]).toLowerCase()}`;
        else if (texts.length) title = clipSnippet(calm(texts[0].label).split(/[.!?]/)[0], 32);
        else if (buttons.length) title = nice(buttons[0]);
        else if (links.length) title = `Links: ${nice(links[0])}`;
        else title = 'More on this page';
      }
      let subtitle = '';
      if (tile.kind === 'quick') {
        const parts = tile.parts.map((part) => clipSnippet(calm(part.title) || calm(boardItems(part.items)[0]?.label) || '', 32)).filter(Boolean);
        subtitle = `${listOf(parts.slice(0, 3))}${parts.length > 3 ? ` and ${parts.length - 3} more` : ''}`;
      } else if (fields.length) subtitle = `${fields.length === 1 ? 'Enter' : 'Fill in'} ${listOf(fields.slice(0, 3).map((f) => nice(f).toLowerCase()))}${fields.length > 3 ? ' and more' : ''}`;
      else if (tables.length) subtitle = `Table: ${clipSnippet(tables[0].caption || tables[0].label, 60)}`;
      else if (tile.kind === 'menu' || title === 'Site menu' || (links.length >= 2 && !texts.length)) subtitle = `Go to ${listOf(links.slice(0, 3).map(nice))}${links.length > 3 ? `, and ${links.length - 3} more` : ''}`;
      else if (texts.length) {
        const pick = texts.find((t) => !calm(t.label).startsWith(title)) || texts[0];
        subtitle = clipSnippet(calm(pick.label), 84);
      } else if (pictures.length) subtitle = pictures[0].caption || pictures[0].label || plural(pictures.length, 'picture', 'pictures');
      else if (buttons.length) subtitle = `Press ${listOf(buttons.slice(0, 2).map(nice))}`;
      const chips = [];
      if (fields.length) chips.push(plural(fields.length, 'field', 'fields'));
      if (tables.length) chips.push(plural(tables.length, 'table', 'tables'));
      if (pictures.length) chips.push(plural(pictures.length, 'picture', 'pictures'));
      if (buttons.length) chips.push(plural(buttons.length, 'button', 'buttons'));
      if (links.length) chips.push(plural(links.length, 'link', 'links'));
      if (!chips.length && texts.length) chips.push(plural(texts.length, 'paragraph', 'paragraphs'));
      const ai = aiTiles.get(tile.key);
      return { title: ai?.title || title, subtitle: ai?.subtitle || subtitle, chips: chips.slice(0, 3), steps: stepsOf(tile.items).length, ai: !!ai };
    }

    // ----- Claude writes the tile titles and subtitles (only with the person's consent already given) -----
    const aiTiles = new Map();
    let aiTilesFor = '';
    let aiTilesState = '';

    function tilePayload(tiles) {
      return tiles.slice(0, 40).map((tile, n) => {
        const items = tile.flat;
        const count = (test) => items.filter(test).length;
        const sample = [
          ...items.filter((i) => i.kind === 'heading').slice(0, 2).map((i) => i.label),
          ...items.filter((i) => i.kind === 'text').slice(0, 2).map((i) => i.label),
          ...items.filter((i) => i.kind === 'field').slice(0, 3).map((i) => i.label),
          ...items.filter(isButton).slice(0, 2).map((i) => i.label),
          ...items.filter(isLink).slice(0, 3).map((i) => i.label),
        ].map((s) => clipSnippet(s, 90)).slice(0, 5);
        return { n, heading: tile.heading, sample, counts: { fields: count((i) => i.kind === 'field'), buttons: count(isButton), links: count(isLink), paragraphs: count((i) => i.kind === 'text'), tables: count((i) => i.kind === 'table'), pictures: count((i) => i.kind === 'image' || i.kind === 'embed') } };
      });
    }

    async function requestTileTitles(force = false) {
      if (!onRedesign || !prefs.aiConsent || aiTilesState === 'loading' || !boardShown()) return;
      const tiles = boardTiles();
      if (!tiles.length) return;
      const signature = `${model.url}|${tiles.map((t) => t.key).join(',')}`;
      if (!force && signature === aiTilesFor) return;
      aiTilesFor = signature;
      aiTilesState = 'loading';
      repaintBoardHome();
      try {
        const host = (() => { try { return new URL(model.url).host; } catch { return ''; } })();
        const result = await onRedesign({ purpose: 'motor', tilesOnly: true, title: model.title, host, site: siteContext(), tiles: tilePayload(tiles) });
        for (const entry of result?.tiles || []) {
          const tile = tiles[entry.n];
          if (tile && entry.title) aiTiles.set(tile.key, { title: entry.title, subtitle: entry.subtitle || '' });
        }
        aiTilesState = 'done';
      } catch {
        aiTilesState = 'failed';
        aiTilesFor = ''; // may try again next time the tiles are shown
      }
      repaintBoardHome();
    }

    // Repaint the tile screen, but never while someone is aiming at a tile.
    function repaintBoardHome(tries = 0) {
      if (!boardShown() || board.sec !== null) return;
      if (motor?.busy?.() && tries < 6) { setTimeout(() => repaintBoardHome(tries + 1), 700); return; }
      paint();
    }

    // After a button runs, take the person to whatever just appeared (a result, a thank-you, an error), so it is never unseen.
    const keyOf = (i) => `${i.kind}|${i.label}`;
    function pageKeys() { return new Set(model.sections.flatMap((s) => boardItems(s.items).map(keyOf))); }
    function showWhatChanged(seen) {
      if (prefs.purpose !== 'motor' || board.whole || board.sec === null) return;
      const tiles = boardTiles();
      for (let ti = 0; ti < tiles.length; ti++) {
        const steps = stepsOf(tiles[ti].items);
        for (let k = 0; k < steps.length; k++) {
          const fresh = steps[k].find((i) => (i.kind === 'text' || i.kind === 'heading') && !seen.has(keyOf(i)));
          if (!fresh) continue;
          openTile(ti, k);
          announce(`New on the page: ${fresh.label.slice(0, 90)}`);
          return;
        }
      }
    }

    function openTile(sec, step = 0) {
      board.sec = sec;
      board.step = step;
      paint();
      main.scrollIntoView({ block: 'start' });
      (main.querySelector('.board-title') || main).focus({ preventScroll: true });
      if (sec === null) { announce('Choose a tile. Hold the pointer on it until the ring fills.', true); return; }
      const tile = boardTiles()[sec];
      if (!tile) return;
      const info = nameTile(tile);
      announce(`${info.title}, step ${step + 1} of ${info.steps}`, true);
    }

    function boardNav(parts) {
      const bar = make('nav', null, 'board-nav');
      bar.setAttribute('aria-label', 'Steps');
      for (const part of parts) bar.append(part);
      return bar;
    }

    function boardParts() {
      const tiles = boardTiles();
      const frame = make('div', null, 'plain board');
      const single = tiles.length === 1;
      if (board.sec !== null && board.sec >= tiles.length) board.sec = null;
      if (single && board.sec === null) board.sec = 0;

      const top = make('header', null, 'board-top');
      const heading = (text) => { const h = make('h1', text, 'board-title'); h.tabIndex = -1; return h; };

      if (board.sec === null) {
        // Two rows of tiles; how many columns depends on the width of the window.
        const cols = win.innerWidth >= 980 ? 3 : win.innerWidth >= 640 ? 2 : 1;
        const perPage = cols * 2;
        const pages = Math.max(1, Math.ceil(tiles.length / perPage));
        board.page = Math.min(board.page, pages - 1);
        top.append(heading(model.title || 'This page'));
        if (onRedesign && !prefs.aiConsent) {
          top.append(button('Write clearer tile titles with AI', { text: 'Smart titles', cls: 'ghost', onClick: async () => {
            if (!(await askConsent())) return;
            prefs.aiConsent = true;
            onPreferences({ ...prefs });
            requestTileTitles(true);
          } }));
        }
        const hint = make('p', `${prefs.dwell !== 0 ? 'Hold the pointer on a tile. A ring fills, then it opens. Nothing happens by just looking.' : 'Press a tile to open it.'}${aiTilesState === 'loading' ? ' Writing clearer titles…' : ''}`, 'board-hint');
        hint.setAttribute('aria-live', 'polite');
        const grid = make('div', null, 'tiles');
        grid.style.setProperty('--cols', String(cols));
        tiles.slice(board.page * perPage, (board.page + 1) * perPage).forEach((tile, k) => {
          const index = board.page * perPage + k;
          const info = nameTile(tile);
          const el = make('button', null, 'tile');
          el.type = 'button';
          el.dataset.kind = tile.kind;
          el.setAttribute('aria-label', `${info.title}. ${info.subtitle ? `${info.subtitle}. ` : ''}Opens ${plural(info.steps, 'step', 'steps')}.`);
          const head = make('span', null, 'tile-head');
          head.append(make('span', String(index + 1), 'tile-no'), make('span', info.title, 'tile-name'), icon('next'));
          const chips = make('span', null, 'tile-chips');
          for (const chip of info.chips) chips.append(make('span', chip, 'chip'));
          el.append(head, make('span', info.subtitle, 'tile-sub'), chips);
          el.onclick = () => openTile(index);
          grid.append(el);
        });
        frame.append(top, hint, grid);
        if (pages > 1) {
          const prev = button('Earlier tiles', { glyph: 'back', text: 'Earlier', onClick: () => { board.page--; paint(); } });
          const next = button('More tiles', { glyph: 'next', text: 'More', cls: 'primary', onClick: () => { board.page++; paint(); } });
          prev.disabled = board.page === 0;
          next.disabled = board.page >= pages - 1;
          const where = make('span', `Page ${board.page + 1} of ${pages}`, 'board-where');
          frame.append(boardNav([prev, where, next]));
        }
        setTimeout(requestTileTitles, 60);
        return [frame];
      }

      const tile = tiles[board.sec];
      const info = nameTile(tile);
      const steps = stepsOf(tile.items);
      board.step = Math.min(board.step, Math.max(steps.length - 1, 0));
      const back = single ? null : button('Back to all tiles', { glyph: 'back', text: 'All tiles', cls: 'ghost', onClick: () => openTile(null) });
      top.append(...(back ? [back] : []), heading(info.title), make('span', `Step ${board.step + 1} of ${steps.length}`, 'board-where'));
      const card = make('section', null, 'board-step');
      card.setAttribute('aria-label', `${info.title}, step ${board.step + 1} of ${steps.length}`);
      fillItems(card, steps[board.step] || []);
      const prev = button('Previous step', { glyph: 'back', text: 'Back', onClick: () => openTile(board.sec, board.step - 1) });
      prev.disabled = board.step === 0;
      const last = board.step >= steps.length - 1;
      const next = last && !single
        ? button('Finish and go back to all tiles', { glyph: 'go', text: 'All tiles', cls: 'primary', onClick: () => openTile(null) })
        : button('Next step', { glyph: 'next', text: 'Next', cls: 'primary', onClick: () => openTile(board.sec, board.step + 1) });
      next.disabled = last && single;
      const dots = make('span', null, 'board-dots');
      dots.setAttribute('aria-hidden', 'true');
      steps.forEach((_, k) => dots.append(make('i', null, k === board.step ? 'on' : k < board.step ? 'done' : '')));
      frame.append(top, card, boardNav([prev, dots, next]));
      return [frame];
    }

    // The number of tile columns follows the window width.
    let resizeTimer;
    const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (boardShown() && board.sec === null) paint(); }, 160); };
    win.addEventListener('resize', onResize);

    // A native dropdown is a tiny, fiddly target. This lists every choice as a giant card instead.
    function pickOption(item, input, opener) {
      motor?.beforePaint();
      pending = true;
      const dialog = make('div', null, 'dialog picker');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', `Choose: ${item.label}`);
      const list = make('div', null, 'picker-list');
      list.setAttribute('role', 'radiogroup');
      const close = (after) => { pending = false; sheet.hidden = true; sheet.replaceChildren(); after?.(); };
      for (const option of item.options || []) {
        const b = make('button', option.label, 'pick');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(option.value === input.value));
        b.disabled = !!option.disabled;
        b.onclick = () => close(() => { input.value = option.value; input.dispatchEvent(new win.Event('change', { bubbles: true })); opener.focus({ preventScroll: true }); });
        list.append(b);
      }
      const cancel = button('Cancel', { text: 'Keep the current choice', cls: 'ghost', onClick: () => close(() => opener.focus({ preventScroll: true })) });
      dialog.onkeydown = (event) => { if (event.key === 'Escape') cancel.click(); };
      dialog.append(make('h2', item.label), list, cancel);
      sheet.replaceChildren(dialog);
      sheet.hidden = false;
      (list.querySelector('[aria-checked=true]') || list.firstElementChild || cancel).focus();
    }

    // ---------- Focus mode: slides ----------
    let slideIndex = 0;
    let deck = { slides: [], first: [], minutes: 1, words: 0 };
    let menuOpen = false;
    const SLIDE_NAMES = { page: 'The whole page', gist: 'In short', read: 'Read', points: 'Key points', card: 'Picture and description', form: 'Form', image: 'Picture', table: 'Table', embed: 'Embedded content', code: 'Code', end: 'End' };

    function goSlide(index) {
      slideIndex = Math.min(Math.max(index, 0), deck.slides.length - 1);
      menuOpen = false;
      paint();
      const slide = deck.slides[slideIndex];
      if (!slide) return;
      main.scrollIntoView({ block: 'start' });
      const field = slide.kind === 'form' ? main.querySelector('input,select,textarea') : null;
      (field || main.querySelector('.slide-title,h1,h2') || main).focus({ preventScroll: true });
      const what = slide.headline || slide.heading || SLIDE_NAMES[slide.kind];
      announce(`Slide ${slideIndex + 1} of ${deck.slides.length}: ${what}`.slice(0, 160));
    }

    function goTo(index) {
      if (prefs.focus) { goSlide(deck.first[index] ?? 0); return; }
      current = Math.min(Math.max(index, 0), model.sections.length - 1);
      const card = main.querySelector(`#sec-${current}`);
      card?.scrollIntoView({ behavior: win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      card?.querySelector('h2')?.focus({ preventScroll: true });
      paintOutline();
    }

    // Text in the site's own fonts and colours, but never in capitals (hard to read, WebAIM).
    function tone(node, head = false) {
      if (isSite()) {
        const t = model.theme;
        node.style.color = readable(head ? t.headingColor : t.color, t.bg);
        node.style.fontFamily = stack(head ? t.headingFont : t.font);
      }
      return node;
    }

    function slideView(slide) {
      const view = make('section', null, `slide ${slide.kind}${slide.cont ? ' cont' : ''}`);
      const title = (text) => { const h = tone(make('h2', text, 'slide-title'), true); h.tabIndex = -1; return h; };
      const eyebrow = (text) => make('p', text, 'slide-eyebrow');

      if (slide.kind === 'gist') {
        view.append(eyebrow('In short'), tone(make('p', slide.text, 'gist'), true), make('p', 'The details are on the next slides.', 'slide-note'));
      } else if (slide.kind === 'read') {
        if (slide.heading) view.append(title(slide.heading));
        for (const text of slide.paras) view.append(tone(make('p', text)));
      } else if (slide.kind === 'points') {
        if (slide.heading) view.append(title(slide.heading));
        const list = make('ul', null, 'bullets');
        for (const item of slide.items) list.append(tone(make('li', calm(item.label))));
        view.append(list);
      } else if (slide.kind === 'card') {
        // A picture always travels with its description.
        const img = make('img', null, 'pic cover');
        img.src = slide.image.src;
        img.alt = slide.image.alt || '';
        img.referrerPolicy = 'no-referrer';
        view.append(img);
        if (slide.caption) view.append(make('p', slide.caption, 'slide-note'));
        if (slide.headline) view.append(title(slide.headline));
        else if (slide.heading && !slide.cont) view.append(title(slide.heading));
        if (slide.gist) view.append(make('p', slide.gist, 'slide-note'));
        for (const text of slide.paras) view.append(tone(make('p', text)));
        if (slide.meta) view.append(make('p', slide.meta, 'slide-note'));
        if (slide.link) {
          const open = button('Open this on the page', { glyph: 'external', text: 'Open on the page', onClick: () => request(slide.link, open) });
          view.append(open);
        }
      } else if (slide.kind === 'image') {
        if (slide.heading) view.append(title(slide.heading));
        view.append(imageBlock(slide.items[0]));
      } else if (slide.kind === 'form') {
        if (slide.heading) view.append(title(slide.heading));
        const holder = make('div', null, 'formbox');
        fillItems(holder, slide.items);
        view.append(holder);
      } else if (slide.kind === 'table' || slide.kind === 'embed' || slide.kind === 'code') {
        if (slide.heading) view.append(title(slide.heading));
        view.append(slide.kind === 'table' ? tableBlock(slide.item) : slide.kind === 'embed' ? embedBlock(slide.item) : codeBlock(slide.item));
      } else if (slide.kind === 'end') {
        view.append(title(slide.count > 1 ? 'That is the main content' : 'Nothing here needs focusing'));
        view.append(tone(make('p', slide.count > 1 ? 'You have seen the parts of this page worth reading. The menus, links and search are on slide 1.' : 'This page is mostly menus, links and search. Slide 1 shows it all.')));
        const row = make('div', null, 'slide-actions');
        row.append(button('Back to the whole page', { glyph: 'back', text: 'Back to the whole page', cls: 'primary', onClick: () => goSlide(0) }));
        row.append(button('Leave focus mode', { text: 'Leave focus mode', onClick: () => update({ focus: false }) }));
        view.append(row);
      }
      return view;
    }

    function slideNav() {
      const total = deck.slides.length;
      const bar = make('div', null, 'stepper slidenav');
      const prev = button('Previous slide', { glyph: 'back', text: 'Back', onClick: () => goSlide(slideIndex - 1) });
      const nextBtn = button('Next slide', { glyph: 'next', text: 'Next', cls: 'primary', onClick: () => goSlide(slideIndex + 1) });
      prev.disabled = slideIndex === 0;
      nextBtn.disabled = slideIndex === total - 1;
      const menu = button('Sections', { glyph: 'list', text: 'Sections', onClick: () => { menuOpen = !menuOpen; paint(); } });
      menu.setAttribute('aria-expanded', String(menuOpen));
      menu.classList.add('menu');
      const track = make('div', null, 'track');
      const fill = make('i');
      fill.style.width = `${((slideIndex + 1) / total) * 100}%`;
      track.append(fill);
      track.setAttribute('aria-hidden', 'true');
      const left = Math.max(0, Math.round(deck.minutes * (1 - slideIndex / Math.max(total - 1, 1))));
      const mid = make('div', null, 'mid');
      mid.append(track, make('span', `Slide ${slideIndex + 1} of ${total}${slideIndex > 0 && left ? ` · ~${left} min left` : ''}`, 'count'));
      bar.append(prev, mid, menu, nextBtn);
      return bar;
    }

    function slideMenu() {
      const box = make('nav', null, 'slidemenu');
      box.setAttribute('aria-label', 'Sections');
      const whole = button('The whole page', { onClick: () => { menuOpen = false; goSlide(0); } });
      whole.removeAttribute('aria-label');
      whole.append(make('small', '01'), doc.createTextNode('The whole page'));
      if (slideIndex === 0) whole.setAttribute('aria-current', 'true');
      box.append(whole);
      model.sections.forEach((section, index) => {
        if (deck.first[index] === undefined) return;
        const b = button(section.title || 'Main content', { onClick: () => { menuOpen = false; goSlide(deck.first[index]); } });
        b.removeAttribute('aria-label');
        b.append(make('small', String(index + 2).padStart(2, '0')), doc.createTextNode(calm(section.title) || 'Main content'));
        if (deck.slides[slideIndex]?.section === index && slideIndex > 0) b.setAttribute('aria-current', 'true');
        box.append(b);
      });
      return box;
    }

    function paintOutline() {
      const heading = make('h2', 'On this page');
      const list = make('ol');
      model.sections.forEach((section, index) => {
        const b = button(section.title || 'Start of page', { onClick: () => goTo(index), cls: 'jump' });
        b.removeAttribute('aria-label');
        b.append(make('small', String(index + 1).padStart(2, '0')), doc.createTextNode(section.title || 'Start of page'));
        if (index === current) b.setAttribute('aria-current', 'true');
        const li = make('li');
        li.append(b);
        list.append(li);
      });
      outline.replaceChildren(heading, list);
    }

    // ---------- The designed page: header, hero, readable sections, a side rail, a footer ----------
    // Every item of the page is placed somewhere on it; nothing is dropped. Regions come from the page's own
    // landmarks (or sensible guesses, shared with the screen reader view), so the result reads like a well-made site.
    const BUCKET = { banner: 'top', navigation: 'top', search: 'top', complementary: 'aside', contentinfo: 'foot' };
    const flattenItem = (item) => (item.kind === 'collapse' ? item.items.flatMap(flattenItem) : [item]);
    const firstId = (item) => (item.kind === 'collapse' ? firstId(item.items[0] || {}) : item.id);

    function roleMap() {
      const map = new Map();
      try {
        const result = globalThis.AccessReader?.plan(model.all || [], { title: model.title, lang: model.lang });
        for (const group of result?.groups || []) for (const item of group.items) map.set(item.id, group.role);
      } catch { /* without regions the page simply keeps its own order */ }
      return map;
    }

    // Claude (or a local guess) labels what each section is for; the look follows from that.
    function sectionRole(section) {
      const flat = section.items.flatMap(flattenItem);
      const count = (test) => flat.filter(test).length;
      if (count((i) => i.kind === 'table') >= 1 && count((i) => i.kind === 'text') < 3) return 'data';
      if (count((i) => i.kind === 'action' && i.link && i.thumb) >= 3) return 'cards';
      if (count((i) => i.kind === 'image' && !i.chart) >= 3) return 'gallery';
      return 'article';
    }

    function topBar(sections) {
      const items = sections.flatMap((s) => [...(s.title ? [{ id: `top-${s.title}`, kind: 'heading', level: 3, label: s.title, style: s.titleStyle }] : []), ...s.items]);
      const bar = make('header', null, 'pd-top');
      const inner = make('div', null, 'pd-top-in');
      const brand = make('div', null, 'pd-brand');
      const nav = [];
      const folds = [];
      const tools = make('div', null, 'pd-tools');
      const moreTools = [];
      const extra = make('div', null, 'pd-tagline');
      let seenLink = false;
      const TEXT_FIELD = /^(text|search|email|url|tel|number|textarea)$/;
      for (const item of items) {
        if (item.kind === 'collapse') { folds.push(item); continue; }
        const short = wordsOf(item.label || '') <= 8;
        if (item.kind === 'image' && brand.children.length < 2 && !seenLink) { const img = thumbImage(item.src); img.className = 'pd-logo'; img.alt = item.label; brand.append(img); continue; }
        if (item.kind === 'action' && item.link && item.thumb && !seenLink && (item.unnamed || item.label.length <= 28) && brand.children.length < 2) { brand.append(actionButton(item)); continue; }
        if ((item.kind === 'heading' || item.kind === 'text') && short && !seenLink && brand.children.length < 2) { brand.append(richText(make('span', null, 'pd-site'), item)); continue; }
        if (item.kind === 'field' && TEXT_FIELD.test(item.type)) { tools.append(fieldBlock(item)); continue; }
        if (item.kind === 'field') { moreTools.push(item); continue; }
        if (item.kind === 'action' && (!item.link || item.style?.bg)) { if (tools.children.length < 4) tools.append(actionButton(item)); else moreTools.push(item); continue; }
        if (item.kind === 'action') { seenLink = true; nav.push(item); continue; }
        if (item.kind === 'text' || item.kind === 'heading') { richText(extra.appendChild(make(item.kind === 'heading' ? 'strong' : 'span')), item); continue; }
        extra.append(item.kind === 'image' ? imageBlock(item) : item.kind === 'table' ? tableBlock(item) : item.kind === 'embed' ? embedBlock(item) : make('span', item.label));
      }
      if (brand.children.length) inner.append(brand);
      const group = (list, label, limit) => {
        const nav2 = make('nav');
        nav2.setAttribute('aria-label', label);
        const ul = make('ul', null, 'pd-nav');
        for (const item of list.slice(0, limit)) { const li = make('li'); li.append(actionButton(item)); ul.append(li); }
        nav2.append(ul);
        if (list.length > limit) {
          const more = make('details', null, 'pd-more');
          more.append(make('summary', `More (${list.length - limit})`));
          const rest = make('ul', null, 'pd-nav pd-nav-more');
          for (const item of list.slice(limit)) { const li = make('li'); li.append(actionButton(item)); rest.append(li); }
          more.append(rest);
          nav2.append(more);
        }
        return nav2;
      };
      if (nav.length) inner.append(group(nav, 'Site', 7));
      if (tools.children.length) inner.append(tools);
      if (moreTools.length || folds.length) {
        const more = make('details', null, 'pd-more');
        more.append(make('summary', `More controls and links (${moreTools.length + folds.reduce((n, f) => n + f.items.length, 0)})`));
        const holder = make('div', null, 'foldbody');
        fillItems(holder, [...folds, ...moreTools]);
        more.append(holder);
        inner.append(more);
      }
      bar.append(inner);
      if (extra.children.length) bar.append(extra);
      return bar;
    }
    function designFrame(sections) {
      const roles = roleMap();
      // Page chrome goes to the header, side rail or footer. Only the first stretch of navigation stays in the header;
      // after its first heading (a table of contents, an appearance panel) the rest is a side panel.
      const assigned = new Map();
      let navClosed = false;
      let navItems = 0;
      for (const section of sections) {
        // A titled stretch that starts inside the navigation (a contents list, a menu panel) is a side panel.
        if (section.title && roles.get(firstId(section.items[0] || {})) === 'navigation') navClosed = true;
        for (const item of section.items) {
          const role = roles.get(firstId(item));
          let bucket = BUCKET[role] || 'main';
          if (bucket === 'main' && !section.title && item.region === 'chrome' && (item.kind === 'action' || item.kind === 'field')) bucket = 'top';
          if (role === 'navigation') {
            if (navClosed || item.kind === 'heading' || navItems >= 14) { navClosed = true; bucket = 'aside'; }
            else navItems += item.kind === 'collapse' ? Math.min(item.items.length, 6) : 1;
          }
          assigned.set(item, bucket);
        }
      }
      const bucketOf = (item) => assigned.get(item) || 'main';
      const buckets = { top: [], aside: [], foot: [] };
      const content = [];
      for (const section of sections) {
        const counts = { top: 0, aside: 0, foot: 0, main: 0 };
        for (const item of section.items) counts[bucketOf(item)]++;
        if (section.title && counts.main === 0) {
          // A whole titled section of page chrome (a menu, a footer block) goes where it belongs, with its title.
          const best = Object.keys(counts).find((k) => counts[k] === Math.max(...Object.values(counts)));
          buckets[best].push(section);
          continue;
        }
        // The untitled lead of the page is split item by item: logo and menus to the top, the rest stays content.
        const split = { top: [], aside: [], foot: [], main: [] };
        for (const item of section.items) split[bucketOf(item)].push(item);
        for (const key of ['top', 'aside', 'foot']) if (split[key].length) buckets[key].push({ title: null, items: split[key] });
        if (split.main.length) content.push({ ...section, items: split.main });
      }

      const frame = siteFrame();
      frame.classList.add('pd');
      const theme = model.theme;
      if (theme.band) { frame.style.setProperty('--pd-band', theme.band.bg); frame.style.setProperty('--pd-band-ink', readable(theme.band.color, theme.band.bg)); }
      frame.style.setProperty('--pd-accent', theme.accent && rgb(theme.accent) && ratio(rgb(theme.accent), rgb(theme.bg) || { r: 255, g: 255, b: 255 }) >= 3 ? theme.accent : readable(theme.color, theme.bg));
      if (buckets.top.length) frame.append(topBar(buckets.top));

      const body = make('div', null, 'pd-body');
      const column = make('div', null, 'pd-main');
      content.forEach((plain, i) => {
        // Claude's label for this stretch (if it was asked) picks the design; otherwise a local guess does.
        const section = plain;
        const role = plain.aiRole || sectionRole(section);
        const card = sectionCard(section, i);
        card.classList.add('pd-sec', `pd-${role}`);
        if (i === 0 && section.title && (role === 'hero' || section.titleLevel === 1 || content.length > 1)) card.classList.add('pd-hero');
        column.append(card);
      });
      body.append(column);

      const rail = make('aside', null, 'pd-rail');
      rail.setAttribute('aria-label', 'Related and on this page');
      const titled = content.map((s, i) => ({ s, i })).filter(({ s }) => s.title && !/cookie|consent|privacy preferences/i.test(s.title));
      if (titled.length >= 4) {
        const toc = make('nav', null, 'pd-toc');
        toc.setAttribute('aria-label', 'On this page');
        toc.append(make('h2', 'On this page'));
        const list = make('ol');
        for (const { s, i } of titled.slice(0, 16)) {
          const li = make('li');
          const b = make('button', calm(s.title), 'pd-toc-link');
          b.type = 'button';
          b.onclick = () => panel.querySelector(`#sec-${i}`)?.scrollIntoView({ behavior: win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
          li.append(b);
          list.append(li);
        }
        toc.append(list);
        rail.append(toc);
      }
      buckets.aside.forEach((section, k) => { const card = sectionCard(section, 100 + k); card.classList.add('pd-card'); rail.append(card); });
      if (rail.children.length) { body.append(rail); body.classList.add('has-rail'); }
      frame.append(body);

      if (buckets.foot.length) {
        const foot = make('footer', null, 'pd-foot');
        buckets.foot.forEach((section, k) => foot.append(sectionCard(section, 200 + k)));
        frame.append(foot);
      }
      return frame;
    }

    // The whole redesigned page (also slide 1 of focus mode).
    function pageParts(sections) {
      // The page title is a heading for assistive technology; the page itself is the design.
      const hero = make('header', null, 'vh');
      hero.append(make('h1', model.title));
      const parts = [hero];
      if (!sections.length) parts.push(make('p', 'No supported content found. Use the original page.', 'section empty'));
      if (isSite() && sections.length) {
        parts.push(designFrame(sections));
      } else {
        parts.push(...sections.map((section, i) => sectionCard(section, i)));
      }
      return parts;
    }

    function paint() {
      motor?.beforePaint();
      const { sections } = model;
      outline.hidden = prefs.purpose === 'reader';
      if (prefs.purpose === 'reader') {
        // The rebuilt page brings its own landmarks, so none of the sighted-mode wrappers are added.
        panel.style.background = overlay && isSite() ? model.theme.bg : '';
        main.replaceChildren(...readerParts());
        return;
      }
      let body;
      panel.dataset.board = String(prefs.purpose === 'motor' && !board.whole && sections.length > 0);
      motor?.refreshDwell();
      if (prefs.purpose === 'motor' && !board.whole && sections.length) {
        current = Math.min(current, sections.length - 1);
        paintOutline();
        body = boardParts();
        panel.style.background = overlay && isSite() ? model.theme.bg : '';
        main.replaceChildren(...body);
        return;
      }
      if (prefs.focus && sections.length) {
        deck = buildSlides(sections, { mainIds: aiMainIds });
        slideIndex = Math.min(slideIndex, deck.slides.length - 1);
        const slide = deck.slides[slideIndex];
        current = slide.section;
        paintOutline();
        if (slide.kind === 'page') {
          // Slide 1: the whole redesigned page, exactly as without focus mode.
          body = pageParts(sections);
        } else {
          const page = isSite() ? siteFrame() : make('div', null, 'plain');
          page.classList.add('slidebox');
          const view = slideView(slide);
          view.classList.add('enter');
          page.append(view);
          body = [page];
        }
        body.push(slideNav());
        if (menuOpen) body.push(slideMenu());
      } else {
        current = Math.min(current, Math.max(sections.length - 1, 0));
        paintOutline();
        body = pageParts(sections);
      }
      if (!overlay) body.push(make('p', 'Supported: standard text, links, buttons and form fields. Embedded frames, custom widgets and protected fields may need the original page.' + (model.skipped ? ` ${model.skipped} elements omitted.` : ''), 'note'));
      // In overlay mode the site's own background fills the whole window.
      panel.style.background = overlay && isSite() ? model.theme.bg : '';
      main.replaceChildren(...body);
    }

    // ---------- Screen reader view: real landmarks, headings, labels and text for pictures ----------
    let aiPageSummary = '';

    function readerPlan() {
      return AccessReader.plan(model.all || [], { title: model.title, lang: model.lang, descriptions: aiDescriptions });
    }

    function announceReader() {
      const { summary } = readerPlan();
      const pieces = [`Screen reader view: ${summary.landmarks} regions, ${summary.headings} headings, ${summary.images} pictures.`];
      if (summary.needDescriptions) pieces.push(`${summary.needDescriptions} pictures or buttons have no description. Choose Describe images to have Claude write them.`);
      announce(pieces.join(' '));
    }

    function readerItem(item, theme, site) {
      if (item.kind === 'heading') {
        const h = richText(make(`h${item.readerLevel || 2}`), item);
        if (item.synthetic) h.className = 'vh';
        else if (site) skin(h, { ...item.style, font: item.style?.font || theme.headingFont }, theme.bg, { min: 18, max: 44 });
        return h;
      }
      if (item.kind === 'text') {
        const p = richText(make(item.quote ? 'blockquote' : 'p'), item);
        if (site) skin(p, item.style, theme.bg);
        return p;
      }
      if (item.kind === 'table') return tableBlock(item);
      if (item.kind === 'embed') return embedBlock(item);
      if (item.kind === 'code') return codeBlock(item);
      if (item.kind === 'image') {
        const figure = make('figure', null, 'figure');
        const img = make('img', null, 'pic');
        img.src = item.src;
        img.alt = item.readerAlt ?? '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.style.maxWidth = `min(100%, ${item.width}px)`;
        // A purely decorative picture is a bare <img alt=""> so a screen reader skips it without announcing an empty figure.
        if (!img.alt && !item.caption && !item.readerLong) return img;
        if (item.readerLong) {
          const long = make('p', item.readerLong, 'vh');
          long.id = `long-${item.id}`;
          img.setAttribute('aria-describedby', long.id);
          figure.append(long);
        }
        if (item.described) img.dataset.described = 'claude';
        if (item.needsDescription) img.dataset.needsDescription = 'true';
        figure.prepend(img);
        if (item.caption) figure.append(make('figcaption', item.caption));
        return figure;
      }
      if (item.kind === 'action' && item.link && item.href) {
        const a = make('a', item.unnamed ? '' : item.label, 'rlink');
        a.href = item.href;
        if (item.unnamed) {
          // A logo or picture that is the whole link: the picture's text alternative is the link's name.
          if (item.thumb && !item.thumb.startsWith('data:image/svg')) {
            const img = thumbImage(item.thumb);
            img.alt = item.readerLabel;
            img.className = 'thumb logo';
            a.append(img);
          } else {
            a.append(...(item.thumb ? [thumbImage(item.thumb)] : []), doc.createTextNode(item.readerLabel));
          }
        }
        if (item.contextual) a.setAttribute('aria-label', item.readerLabel);
        a.onclick = (event) => { event.preventDefault(); request(item, a); };
        if (site) skin(a, { ...item.style, underline: true }, theme.bg, { max: 28 });
        return a;
      }
      if (item.kind === 'action') {
        const b = make('button', item.unnamed ? item.readerLabel : item.label, 'rbtn');
        b.type = 'button';
        b.disabled = !!item.disabled;
        b.onclick = () => request(item, b);
        if (item.unnamed && item.thumb) b.prepend(thumbImage(item.thumb));
        if (site) skinBox(b, item.style, theme.bg, { max: 28 });
        return b;
      }
      if (item.kind === 'field') return fieldBlock(item);
      return null;
    }

    function readerParts() {
      const theme = model.theme;
      const site = isSite();
      const plan = readerPlan();
      const frame = site ? siteFrame() : make('div', null, 'plain');
      frame.classList.add('reader');
      if (plan.lang) frame.lang = plan.lang;

      // Skip links come first so a screen reader user can jump straight to what they want.
      const targets = {};
      if (plan.skip.length) {
        // A plain group, not another navigation landmark, so the landmark list stays short.
        const nav = make('div', null, 'skiplinks');
        nav.setAttribute('role', 'group');
        nav.setAttribute('aria-label', 'Skip links');
        for (const link of plan.skip) {
          const a = make('a', link.label, 'skip');
          a.href = `#reader-${link.target}`;
          a.onclick = (event) => { event.preventDefault(); const el = targets[link.target]; el?.scrollIntoView({ block: 'start' }); el?.focus({ preventScroll: true }); };
          nav.append(a);
        }
        frame.append(nav);
      }
      if (aiPageSummary) {
        // For screen readers only: a short summary and a note that descriptions were written automatically.
        const note = make('section', null, 'vh');
        note.setAttribute('aria-label', 'About this page');
        note.append(make('p', aiPageSummary));
        if (Object.keys(aiDescriptions).length) note.append(make('p', 'Picture descriptions and button names on this page were written automatically and can be wrong.'));
        frame.append(note);
      }

      for (const group of plan.groups) {
        const tag = { banner: 'header', navigation: 'nav', search: 'div', main: 'main', complementary: 'aside', contentinfo: 'footer', region: 'section' }[group.role] || 'div';
        const landmark = make(tag, null, `landmark ${group.role}`);
        if (['banner', 'search', 'contentinfo'].includes(group.role)) landmark.setAttribute('role', group.role);
        if (group.label && group.role !== 'banner' && group.role !== 'main' && group.role !== 'contentinfo') landmark.setAttribute('aria-label', group.label);
        if (group.role === 'main' || group.role === 'navigation' || group.role === 'search') {
          if (!targets[group.role]) { landmark.id = `reader-${group.role}`; landmark.tabIndex = -1; targets[group.role] = landmark; }
        }

        let list = null;
        for (const item of group.items) {
          const asLink = group.role === 'navigation' && item.kind === 'action' && item.link;
          if ((item.kind === 'text' && item.list) || asLink) {
            const ordered = Boolean(item.ordered) && !asLink;
            const wanted = ordered ? 'OL' : 'UL';
            if (!list || list.tagName !== wanted) { list = make(wanted.toLowerCase(), null, asLink ? 'navlist' : 'items'); landmark.append(list); }
            const li = make('li');
            if (asLink) li.append(readerItem(item, theme, site));
            else { richText(li, item); if (site) skin(li, item.style, theme.bg); }
            list.append(li);
            continue;
          }
          list = null;
          const node = readerItem(item, theme, site);
          if (node) landmark.append(node);
        }
        frame.append(landmark);
      }
      return [frame];
    }

    function showUnavailable(message) {
      const card = make('section', null, 'section');
      card.append(make('h2', 'Original page unavailable'), make('p', message));
      if (onOpenOriginal) card.append(button('Back to original page', { glyph: 'external', text: 'Go to original', onClick: () => onOpenOriginal() }));
      main.replaceChildren(card);
      outline.replaceChildren();
      announce('The original page is unavailable.');
    }

    async function render(force = false) {
      const mine = ++token;
      let snapshot;
      try {
        snapshot = await api.scan();
      } catch (error) {
        if (mine === token) showUnavailable(error.message);
        return false;
      }
      if (mine !== token) return false;
      lastRender = Date.now();
      const next = JSON.stringify([snapshot.title, snapshot.items, snapshot.theme]);
      if (!force && next === signature) return false;
      signature = next;
      if (!aiSpec) aiMainIds = null;
      const items = withSite(snapshot.items, snapshot);
      const base = group(items.filter((i) => !i.unnamed || prefs.purpose === 'reader'));
      model = { title: snapshot.title, url: snapshot.url, lang: snapshot.lang, all: items, skipped: snapshot.skipped, nativeTheme: snapshot.theme, theme: themed(snapshot.theme), base, sections: aiSpec ? plan(base) : base };
      paint();
      return true;
    }

    async function manualRefresh() {
      if (pending) { announce('Confirm or cancel the pending action first.'); return; }
      announce((await render(true)) ? 'View refreshed from the original page.' : 'Original page is not available.');
    }

    const editing = () => main.contains(root.activeElement || doc.activeElement);
    const stop = engine.observe(() => {
      if (pending || editing()) { announce('The page changed. Finish editing, then refresh to see the latest content.'); return; }
      clearTimeout(refreshTimer);
      const tryRender = async () => {
        // Never rebuild the tiles while the ring is filling or the keyboard is open: the target would vanish under the pointer.
        if (motor?.busy()) { refreshTimer = setTimeout(tryRender, 700); return; }
        if (await render()) announce('View updated from the original page.', prefs.purpose === 'motor' && !board.whole);
      };
      refreshTimer = setTimeout(tryRender, Math.max(0, 1000 - (Date.now() - lastRender)));
    });

    applyPrefs();
    render(true).then(() => {
      // Let pictures and charts that load on scroll appear, then show them too.
      if (overlay) Promise.resolve(engine.warm?.()).then(() => render()).catch(() => {});
      if (overlay) announce('Open "Access settings" at the bottom right for Screen reader, Focus, Motor impairment and more.', prefs.purpose === 'motor');
    });
    return {
      refresh: () => render(true),
      setPreferences: (change) => update(change),
      destroy() { motor?.destroy(); clearTimeout(announceTimer); clearTimeout(resizeTimer); win.removeEventListener('resize', onResize); win.removeEventListener('pointermove', onPointer); clearTimeout(refreshTimer); system.removeEventListener('change', applyPrefs); stop?.(); },
    };
  }

  globalThis.AccessUI = { mount };
})();
