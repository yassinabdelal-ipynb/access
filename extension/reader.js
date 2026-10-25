// Screen reader view logic: turns the engine's flat list of items into the structure a blind person's
// screen reader (VoiceOver, TalkBack, NVDA, JAWS, Narrator) expects: ARIA landmarks, one h1 and a
// heading outline with no skipped levels, links whose purpose is clear, text for images, names for icon
// buttons. Pure functions with no DOM, so they can be tested directly.
// Standards followed: WCAG 2.2 1.1.1, 1.3.1, 2.4.1, 2.4.4, 2.4.6, 2.5.3, 3.1.1, 4.1.2; WAI-ARIA landmark practices.
(() => {
  if (globalThis.AccessReader) return;

  const GENERIC_LINK = /^(?:more|read more|learn more|see more|view more|find out more|click here|here|click|tap here|details|continue|continue reading|see all|view all|view|link|this|go|open|download|share|next|previous)\s*[»›>→…]*$/i;
  const GENERIC_ALT = /^(?:image|photo|picture|img[-_ ]?\d*|dsc[-_ ]?\d+|untitled|banner|logo|icon|graphic|thumbnail|[\w-]+\.(?:jpe?g|png|gif|webp|svg))$/i;
  const ICON_NAMES = [
    [/hamburger|burger|menu|bars/, 'Open menu'], [/search|magnif/, 'Search'], [/cart|basket|bag/, 'Shopping cart'],
    [/close|dismiss|cancel|times|xmark/, 'Close'], [/log-?in|sign-?in/, 'Sign in'], [/user|account|profile|person/, 'Account'],
    [/home/, 'Home'], [/share/, 'Share'], [/play/, 'Play'], [/pause/, 'Pause'], [/next|chevron-right|arrow-right|forward/, 'Next'],
    [/prev|back|chevron-left|arrow-left/, 'Previous'], [/mail|envelope/, 'Email'], [/phone|call/, 'Phone'],
    [/heart|favou?rite|like/, 'Favourite'], [/download/, 'Download'], [/settings|gear|cog/, 'Settings'], [/bell|notification/, 'Notifications'],
    [/facebook/, 'Facebook'], [/twitter|x-twitter/, 'X (Twitter)'], [/instagram/, 'Instagram'], [/linkedin/, 'LinkedIn'], [/youtube/, 'YouTube'],
    [/tiktok/, 'TikTok'], [/github/, 'GitHub'],
  ];
  const ROLES_NEEDING_NAME = ['navigation', 'complementary', 'search', 'region'];

  // A name a person would give an icon button, from its hints (title, class names, link address). Empty if unsure.
  function guessName(item) {
    const text = `${item.hint || ''} ${item.href ? new URL(item.href).pathname : ''}`.toLowerCase();
    for (const [pattern, name] of ICON_NAMES) if (pattern.test(text)) return name;
    return '';
  }

  const isGenericLink = (label) => GENERIC_LINK.test(String(label || '').trim());
  const clip = (text, n) => { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

  // Which images still need a text alternative a screen reader can use?
  function needsDescription(item, descriptions = {}) {
    if (descriptions[item.id]) return false;
    return item.kind === 'image' && (item.altState === 'missing' || (item.altState === 'text' && GENERIC_ALT.test(item.label.trim())));
  }

  function plan(allItems, { title = '', lang = '', descriptions = {} } = {}) {
    const items = allItems.filter((i) => i.kind !== 'collapse').map((i) => ({ ...i }));

    // 1. Give every item a landmark, inventing sensible ones for pages that declare none.
    const stats = { synthesized: false };
    const keyOf = (i) => `${i.landmark}:${i.landmarkId}`;
    const words = (i) => (i.label.match(/\S+/g) || []).length;

    // Anything the page did not put in a landmark is content by default...
    for (const item of items) {
      if (item.landmark) continue;
      item.landmark = 'main';
      item.landmarkId = -2;
      item.synth = true;
      stats.synthesized = true;
    }
    // ...except logos, menus and search before the content starts, and notes and links after it ends.
    const marker = (i) => i.kind === 'heading' || (i.kind === 'text' && words(i) >= 6);
    const first = items.findIndex(marker);
    const last = items.length - 1 - [...items].reverse().findIndex(marker);
    if (first > 0) {
      let run = [];
      let runs = 0;
      const flush = () => {
        if (run.length >= 3) { const id = -10 - runs++; run.forEach((i) => { i.landmark = 'navigation'; i.landmarkId = id; }); }
        else run.forEach((i) => { i.landmark = 'banner'; i.landmarkId = -1; });
        run = [];
      };
      for (let n = 0; n < first; n++) {
        const item = items[n];
        if (!item.synth) { flush(); continue; }
        if (item.kind === 'action' && item.link && !item.unnamed) run.push(item);
        else { flush(); item.landmark = 'banner'; item.landmarkId = -1; }
      }
      flush();
    }
    if (first >= 0 && last < items.length - 1) {
      const tail = items.slice(last + 1).filter((i) => i.synth);
      if (tail.length >= 2) tail.forEach((i) => { i.landmark = 'contentinfo'; i.landmarkId = -4; });
    }

    // 2. Group consecutive items by landmark. Only one main, one banner and one contentinfo are allowed.
    const groups = [];
    for (const item of items) {
      const key = keyOf(item);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(item);
      else groups.push({ key, role: item.landmark, label: item.landmarkLabel || '', items: [item] });
    }
    const seen = { main: false, banner: false, contentinfo: false };
    for (const g of groups) {
      if (!(g.role in seen)) continue;
      if (seen[g.role]) { g.label = g.label || clip(g.items.find((i) => i.kind === 'heading')?.label, 40) || (g.items[0].synth ? 'Page controls' : 'More content'); g.role = 'region'; }
      else seen[g.role] = true;
    }
    if (!seen.main) { // a page with no content landmark still gets exactly one main
      const candidate = groups.find((g) => g.role === 'region' || g.role === 'complementary') || groups.find((g) => g.role !== 'banner' && g.role !== 'contentinfo' && g.role !== 'navigation' && g.role !== 'search');
      if (candidate) { candidate.role = 'main'; candidate.label = ''; }
    }

    // 3. Names for landmarks that are repeated or have none.
    const counts = {};
    for (const g of groups) {
      if (!ROLES_NEEDING_NAME.includes(g.role)) continue;
      counts[g.role] = (counts[g.role] || 0) + 1;
      if (g.label) continue;
      const heading = g.items.find((i) => i.kind === 'heading');
      g.label = heading ? clip(heading.label, 40)
        : g.role === 'navigation' ? (counts.navigation === 1 ? 'Main navigation' : `Navigation ${counts.navigation}`)
        : g.role === 'search' ? 'Search' : g.role === 'complementary' ? 'Related content' : 'More content';
    }

    // 4. One h1 and no skipped levels.
    const headings = items.filter((i) => i.kind === 'heading');
    const firstH1 = headings.find((h) => h.level === 1);
    let synthetic = null;
    if (!firstH1) {
      synthetic = { id: 'reader-title', kind: 'heading', label: title || 'Untitled page', level: 1, synthetic: true };
      const mainGroup = groups.find((g) => g.role === 'main') || groups[0];
      if (mainGroup) mainGroup.items.unshift(synthetic);
    }
    let previous = 0;
    for (const h of [...(synthetic ? [synthetic] : []), ...headings]) {
      let level = h === firstH1 || h === synthetic ? 1 : Math.max(2, Math.min(Number(h.level) || 2, previous + 1));
      if (previous === 0 && level > 1) level = 2;
      h.readerLevel = level;
      previous = level;
    }

    // 5. Link purpose, image text, icon names.
    for (const g of groups) {
      g.items.forEach((item, index) => {
        if (item.kind === 'action' && item.unnamed) {
          const d = descriptions[item.id];
          item.readerLabel = (d?.label || d?.alt || '') || guessName(item) || (item.link ? 'Unlabelled link' : 'Unlabelled button');
          item.guessed = !d?.label && !d?.alt;
        } else if (item.kind === 'action' && item.link && isGenericLink(item.label)) {
          let context = '';
          for (let back = index - 1; back >= 0 && back >= index - 6 && !context; back--) {
            const before = g.items[back];
            if ((before.block && before.block === item.block || back === index - 1) && ['heading', 'text'].includes(before.kind)) context = clip(before.label, 70);
          }
          if (context) { item.readerLabel = `${item.label}: ${context}`; item.contextual = true; }
        }
        if (item.kind === 'image') {
          const d = descriptions[item.id];
          if (d) {
            item.readerAlt = d.decorative ? '' : d.alt || item.label || '';
            item.readerLong = [d.long, d.text ? `Text in the image: ${d.text}` : ''].filter(Boolean).join(' ');
            item.described = true;
          } else if (item.altState === 'decorative') {
            item.readerAlt = '';
          } else if (item.altState === 'text' && !GENERIC_ALT.test(item.label.trim())) {
            item.readerAlt = item.label;
          } else {
            item.readerAlt = item.caption || 'Image without a description';
            item.needsDescription = true;
          }
        }
      });
    }

    // 6. Skip links in reading order.
    const skip = [];
    if (groups.some((g) => g.role === 'main')) skip.push({ target: 'main', label: 'Skip to main content' });
    if (groups.some((g) => g.role === 'search')) skip.push({ target: 'search', label: 'Skip to search' });
    if (groups.some((g) => g.role === 'navigation')) skip.push({ target: 'navigation', label: 'Skip to navigation' });

    const summary = {
      landmarks: groups.length, headings: items.filter((i) => i.kind === 'heading').length + (synthetic ? 1 : 0),
      images: items.filter((i) => i.kind === 'image').length,
      needDescriptions: items.filter((i) => needsDescription(i, descriptions)).length + items.filter((i) => i.kind === 'action' && i.unnamed && !descriptions[i.id]).length,
      synthesized: stats.synthesized,
    };
    return { title, lang, groups, skip, summary };
  }

  // What to send for description: pictures (and unlabelled image links) as URLs, icon buttons as text hints.
  function describeRequest(allItems, { title = '', host = '', lang = '', referer = '', descriptions = {} } = {}) {
    const items = allItems.filter((i) => i.kind !== 'collapse');
    const context = (index) => {
      for (let back = index - 1; back >= Math.max(0, index - 4); back--) if (['heading', 'text'].includes(items[back].kind)) return clip(items[back].label, 240);
      return '';
    };
    const images = [];
    const controls = [];
    items.forEach((item, index) => {
      if (descriptions[item.id]) return;
      const usable = (src) => typeof src === 'string' && (/^https?:\/\//i.test(src) || /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(src));
      if (item.kind === 'image' && needsDescription(item, descriptions) && usable(item.src)) {
        images.push({ id: item.id, url: item.src, alt: item.label, context: item.caption || context(index), priority: item.landmark === 'main' ? 1 : 2 });
      } else if (item.kind === 'action' && item.unnamed) {
        if (item.thumb && !item.thumb.startsWith('data:image/svg') && usable(item.thumb)) {
          images.push({ id: item.id, url: item.thumb, alt: '', context: context(index), linked: item.href || 'a button', priority: 0 });
        } else {
          controls.push({ id: item.id, hint: item.hint || '' });
        }
      }
    });
    images.sort((a, b) => a.priority - b.priority);
    return { title, host, lang, referer, images: images.slice(0, 12).map(({ priority, ...rest }) => rest), controls: controls.slice(0, 24) };
  }

  globalThis.AccessReader = { plan, describeRequest, needsDescription, guessName, isGenericLink, GENERIC_ALT };
})();
