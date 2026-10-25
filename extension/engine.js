// Reads a document into plain data (text, images, charts, tables, fields, actions + the site's own look)
// and applies edits back to the original elements. Used in-page, never renders UI.
//
// The scan walks the page like a reader would: text is gathered into paragraphs with its links, bold and
// italics kept inline ("runs"), so a sentence with a link in it stays one sentence. Nothing visible is
// dropped on purpose: pictures, charts (inline SVG and canvas), data tables, quotes, code and embedded
// video/frames all become items. Only decorative icons, hidden text and protected fields are left out.
(() => {
  if (globalThis.AccessEngine) return;

  const MAX_ITEMS = 3000;
  const FIELD = 'input:not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]),select,textarea';
  const BUTTONISH = 'button,input[type="submit"],input[type="button"],input[type="reset"]';
  const PROTECTED = 'input[type="hidden"],input[type="password"],input[type="file"]';
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'link', 'meta', 'title', 'base', 'datalist', 'option', 'optgroup', 'map', 'area', 'track', 'source', 'param']);
  const PHRASING = new Set(['a', 'abbr', 'acronym', 'b', 'bdi', 'bdo', 'big', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i', 'ins', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var', 'wbr']);
  // Anything inside a phrasing element that makes it a block of its own.
  const BLOCKISH = 'div,p,ul,ol,li,dl,dt,dd,table,form,button,input,select,textarea,label,h1,h2,h3,h4,h5,h6,figure,figcaption,section,article,nav,header,footer,aside,main,pre,blockquote,canvas,video,audio,iframe,object,embed,details,summary,hr';
  const SEPARATORS = /[\s|•·,;:/\\\-–—()[\]<>›»«‹→▸*]+/g;
  const SVG_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'display', 'visibility'];

  function create(doc) {
    const ids = new WeakMap();
    const elements = new Map();
    const win = doc.defaultView;
    let counter = 0;

    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const css = (el) => win.getComputedStyle(el);
    const visible = (el) =>
      !el.closest('[data-access-root],[hidden],[inert]:not([data-access-inert])') && el.getClientRects().length > 0 && css(el).visibility !== 'hidden';

    function label(el) {
      const refs = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
        .map((id) => doc.getElementById(id)?.textContent).join(' ');
      return clean(
        refs || el.getAttribute('aria-label') || Array.from(el.labels || []).map((x) => x.textContent).join(' ')
        || el.getAttribute('alt') || el.innerText || el.querySelector?.('img[alt]')?.getAttribute('alt') || el.getAttribute('placeholder') || el.getAttribute('title')
        || (el.matches('input[type="submit"],input[type="button"],input[type="reset"]') ? el.value : '')
        // Fields may fall back to their name or type; a button or link must not be named "submit" or "button".
        || (el.matches('input,select,textarea') ? el.name || el.type : ''),
      );
    }

    function id(el) {
      if (!ids.has(el)) ids.set(el, `access-${++counter}`);
      const key = ids.get(el);
      elements.set(key, el);
      return key;
    }

    // Where an item lives on the page: the main content, or page chrome (menus, footers, search, sidebars).
    const CHROME = 'nav,footer,aside,[role="navigation"],[role="contentinfo"],[role="complementary"],[role="search"],[role="banner"]';
    function regionOf(el) {
      const area = el.closest('main,article,[role="main"]');
      if (el.closest(CHROME) || (el.type === 'search')) return 'chrome';
      const header = el.closest('header');
      if (header && !(area && area.contains(header))) return 'chrome';
      return area ? 'main' : null;
    }

    // ARIA landmark an item lives in (banner, navigation, search, main, complementary, contentinfo).
    // Used by the screen reader view so the rebuilt page has the same regions a good site would declare.
    const landmarkIds = new WeakMap();
    let landmarkCount = 0;
    function landmarkOf(el) {
      let node = null;
      let role = null;
      const inContent = (n) => n.closest('article,section,main,[role="main"]');
      if ((node = el.closest('[role="search"]')) || (el.type === 'search' && (node = el.form || el))) role = 'search';
      else if ((node = el.closest('nav,[role="navigation"]'))) role = 'navigation';
      else if ((node = el.closest('aside,[role="complementary"]'))) role = 'complementary';
      else if ((node = el.closest('footer,[role="contentinfo"]')) && !(node.tagName === 'FOOTER' && inContent(node))) role = 'contentinfo';
      else if ((node = el.closest('header,[role="banner"]')) && !(node.tagName === 'HEADER' && inContent(node))) role = 'banner';
      else if ((node = el.closest('main,[role="main"]'))) role = 'main';
      if (!role) return null;
      if (!landmarkIds.has(node)) landmarkIds.set(node, ++landmarkCount);
      const named = node.getAttribute('aria-label') || (node.getAttribute('aria-labelledby') || '').split(/\s+/).map((i) => doc.getElementById(i)?.textContent || '').join(' ');
      return { role, id: landmarkIds.get(node), label: clean(named).slice(0, 80) };
    }

    // Inline SVG as an image that still looks right: the page's stylesheets will not apply inside <img>,
    // so the computed paint properties are written onto every element.
    function styledSvg(svg, box) {
      const source = [svg, ...svg.querySelectorAll('*')];
      if (source.length > 4000) return null;
      const copy = svg.cloneNode(true);
      const target = [copy, ...copy.querySelectorAll('*')];
      source.forEach((node, i) => {
        const style = css(node);
        let inline = '';
        for (const prop of SVG_PROPS) { const value = style.getPropertyValue(prop); if (value) inline += `${prop}:${value};`; }
        target[i].setAttribute('style', `${target[i].getAttribute('style') || ''};${inline}`);
        for (const attr of Array.from(target[i].attributes)) if (/^on/i.test(attr.name)) target[i].removeAttribute(attr.name);
      });
      copy.querySelectorAll('script').forEach((s) => s.remove());
      copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      copy.setAttribute('width', Math.round(box.width));
      copy.setAttribute('height', Math.round(box.height));
      if (!copy.getAttribute('viewBox')) copy.setAttribute('viewBox', `0 0 ${Math.round(box.width)} ${Math.round(box.height)}`);
      const markup = new win.XMLSerializer().serializeToString(copy).replace(/currentColor/g, css(svg).color);
      return markup.length < 900000 ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}` : null;
    }

    // Logos and icons inside links/buttons: an <img> source or an inline <svg> as a data URL.
    function thumbOf(el) {
      const img = Array.from(el.querySelectorAll('img')).find((i) => i.getBoundingClientRect().width >= 16);
      const src = img && (img.currentSrc || img.src);
      if (src && src.length < 100000) return src;
      const svg = el.querySelector('svg');
      const box = svg?.getBoundingClientRect();
      if (!svg || box.width < 16 || box.height < 16) return null;
      const copy = svg.cloneNode(true);
      copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      copy.setAttribute('width', Math.round(box.width));
      copy.setAttribute('height', Math.round(box.height));
      const markup = new win.XMLSerializer().serializeToString(copy).replace(/currentColor/g, css(svg).color);
      return markup.length < 30000 ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}` : null;
    }

    // Items inside the same row/list entry/card are shown together, like the original.
    const blocks = new WeakMap();
    let blockCount = 0;
    function blockOf(el) {
      const block = el.closest('tr,li,article,dl,figure,[role="listitem"]');
      if (!block) return null;
      if (!blocks.has(block)) blocks.set(block, ++blockCount);
      return blocks.get(block);
    }

    // ---------- The site's own look ----------
    const transparent = (c) => !c || c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c);
    function backdrop(el) {
      for (let n = el; n; n = n.parentElement) {
        const c = css(n).backgroundColor;
        if (!transparent(c)) return c;
      }
      return 'rgb(255, 255, 255)';
    }
    function textStyle(el) {
      const s = css(el);
      return {
        color: s.color, font: s.fontFamily, weight: s.fontWeight, size: parseFloat(s.fontSize),
        italic: s.fontStyle === 'italic', transform: s.textTransform, spacing: s.letterSpacing,
        underline: s.textDecorationLine.includes('underline'),
      };
    }
    function boxStyle(el) {
      const s = css(el);
      const side = s.borderTopWidth !== '0px' && s.borderTopStyle !== 'none';
      return {
        ...textStyle(el), bg: transparent(s.backgroundColor) ? null : s.backgroundColor, radius: s.borderTopLeftRadius,
        border: side ? `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}` : null,
      };
    }
    // The strongest background the page uses for its own header, so the redesign can echo the site's identity.
    function brandBand() {
      // The page's own top bar: the first wide, short, painted box near the top (a header, a nav, or a styled div).
      const limit = Math.min(doc.body.querySelectorAll('*').length, 400);
      const all = doc.body.querySelectorAll('*');
      for (let i = 0; i < limit; i++) {
        const el = all[i];
        if (el.closest('[data-access-root]')) continue;
        const box = el.getBoundingClientRect();
        if (box.top > 140 || box.width < win.innerWidth * 0.6 || box.height < 36 || box.height > 220) continue;
        const c = css(el).backgroundColor;
        if (transparent(c) || css(el).position === 'fixed' && box.height > 160) continue;
        if (c === backdrop(doc.body) && el !== doc.body) continue;
        return { bg: c, color: css(el).color };
      }
      return null;
    }    function siteTheme() {
      const body = doc.body;
      const button = Array.from(doc.querySelectorAll('button,input[type="submit"],a[class*="btn"],a[class*="button"]')).filter(visible)
        .find((b) => !transparent(css(b).backgroundColor));
      const heading = doc.querySelector('h1,h2');
      const link = doc.querySelector('a[href]');
      return {
        bg: backdrop(body), color: css(body).color, font: css(body).fontFamily,
        headingFont: heading ? css(heading).fontFamily : css(body).fontFamily,
        headingColor: heading ? css(heading).color : css(body).color,
        accent: button ? css(button).backgroundColor : link ? css(link).color : css(body).color,
        accentInk: button ? css(button).color : backdrop(body),
        size: parseFloat(css(body).fontSize),
        band: brandBand(),
      };
    }

    // ---------- The scan ----------
    function scan() {
      elements.clear();
      const items = [];
      let skipped = 0;
      const seen = new WeakMap();
      const captioned = new WeakSet();

      const push = (item) => {
        if (items.length >= MAX_ITEMS) { skipped++; return false; }
        items.push(item);
        return true;
      };
      const itemId = (owner) => {
        const n = seen.get(owner) || 0;
        seen.set(owner, n + 1);
        return n ? `${id(owner)}-${n}` : id(owner);
      };
      const place = (item, el) => {
        item.block = blockOf(el);
        item.region = regionOf(el);
        const landmark = landmarkOf(el);
        if (landmark) Object.assign(item, { landmark: landmark.role, landmarkId: landmark.id, landmarkLabel: landmark.label });
        return item;
      };
      const hrefOf = (a) => (/^https?:/i.test(a.href) ? a.href.slice(0, 600) : undefined);
      const hasRects = (el) => el.getClientRects().length > 0 || css(el).display === 'contents';
      const big = (img) => { const r = img.getBoundingClientRect(); return r.width >= 32 && r.height >= 32; };
      const captionOf = (el) => {
        const figure = el.closest('figure');
        const text = clean(figure?.querySelector('figcaption')?.textContent).slice(0, 300);
        if (figure && text) captioned.add(figure);
        return text;
      };

      // ----- inline text: words, links, bold, italics -----
      function inlineNode(node, runs, marks) {
        if (node.nodeType === 3) { if (node.data) runs.push({ t: node.data, ...marks }); return; }
        if (node.nodeType !== 1) return;
        const tag = node.localName;
        if (SKIP.has(tag) || tag === 'svg' || node.hasAttribute('data-access-root')) return;
        const style = css(node);
        if (style.display === 'none' || node.hasAttribute('hidden') || style.visibility === 'hidden') return;
        if (tag === 'br' || tag === 'wbr') { runs.push({ t: ' ', ...marks }); return; }
        if (tag === 'img') { if (node.alt && !big(node)) runs.push({ t: node.alt, ...marks }); return; }
        if (tag === 'a' && node.hasAttribute('href')) {
          const t = clean(node.innerText || node.textContent);
          if (/^\[(edit|edit source|show|hide)\]$/i.test(t)) return;
          if (t) runs.push({ t, link: id(node), href: hrefOf(node), ...marks, ...(/^\[[\w ]{1,12}\]$/.test(t) || /^\d{1,3}$/.test(t) && node.closest('sup') ? { sup: 1 } : {}) });
          return;
        }
        const next = { ...marks };
        if (tag === 'strong' || tag === 'b') next.b = 1;
        else if (tag === 'em' || tag === 'i' || tag === 'cite' || tag === 'dfn') next.i = 1;
        else if (tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'tt' || tag === 'var') next.c = 1;
        else if (tag === 'sup') next.sup = 1;
        else if (tag === 'sub') next.sub = 1;
        for (const child of node.childNodes) inlineNode(child, runs, next);
      }

      // Merge neighbours that look the same, collapse spaces, trim the ends.
      function finish(runs) {
        const out = [];
        const same = (a, b) => !a.link && !b.link && !!a.b === !!b.b && !!a.i === !!b.i && !!a.c === !!b.c && !!a.sup === !!b.sup && !!a.sub === !!b.sub;
        for (const run of runs) {
          const t = run.t.replace(/\s+/g, ' ');
          if (!t) continue;
          const last = out[out.length - 1];
          if (last && same(last, run)) last.t += t;
          else out.push({ ...run, t });
        }
        // A space at the join of two runs should appear once.
        for (let i = 1; i < out.length; i++) if (out[i - 1].t.endsWith(' ') && out[i].t.startsWith(' ')) out[i].t = out[i].t.slice(1);
        if (out.length) out[0].t = out[0].t.replace(/^\s+/, '');
        if (out.length) out[out.length - 1].t = out[out.length - 1].t.replace(/\s+$/, '');
        return out.filter((r) => r.t);
      }

      const isPhrasing = (node) => {
        const tag = node.localName;
        if (SKIP.has(tag)) return true; // ignorable: never starts a new block
        if (tag === 'svg') { const r = node.getBoundingClientRect(); return r.width < 120 || r.height < 70; } // icons stay inline; charts are blocks
        if (!PHRASING.has(tag)) return false;
        if (node.querySelector(BLOCKISH)) return false;
        return !Array.from(node.querySelectorAll('img,svg')).some(big);
      };

      function emitText(owner, rawRuns, ctx, kind = 'text') {
        const runs = finish(rawRuns);
        const text = runs.map((r) => r.t).join('');
        if (!text) return;
        if (!hasRects(owner)) return;
        const links = runs.filter((r) => r.link);
        // A line that is only links (a menu, a row of buttons) stays a set of links, as before.
        if (kind === 'text' && links.length && !runs.filter((r) => !r.link).map((r) => r.t).join('').replace(SEPARATORS, '')) {
          for (const run of links) { const a = elements.get(run.link); if (a) action(a); }
          return;
        }
        const item = { id: itemId(owner), kind, label: text.slice(0, 6000) };
        if (runs.length <= 200 && runs.some((r) => r.link || r.b || r.i || r.c || r.sup || r.sub)) item.runs = runs;
        item.style = textStyle(owner);
        if (kind === 'heading') item.level = Number(owner.localName[1]);
        if (owner.localName === 'li') Object.assign(item, { list: true, ordered: owner.parentElement?.tagName === 'OL' });
        if (ctx.quote) item.quote = true;
        place(item, owner);
        const lang = owner.getAttribute('lang');
        if (lang) item.hasLang = lang;
        push(item);
      }

      function walkChildren(el, ctx) {
        let runs = [];
        const flush = () => { if (runs.length) emitText(el, runs, ctx); runs = []; };
        for (const child of el.childNodes) {
          if (child.nodeType === 3) { runs.push({ t: child.data }); continue; }
          if (child.nodeType !== 1) continue;
          if (isPhrasing(child)) { inlineNode(child, runs, {}); continue; }
          flush();
          walk(child, ctx);
        }
        flush();
      }

      // ----- leaves -----
      function image(el) {
        if (!visible(el)) return;
        const box = el.getBoundingClientRect();
        const src = el.currentSrc || el.src;
        if (box.width < 32 || box.height < 32 || !src || src.length > 4_000_000) return;
        if (el.getAttribute('aria-hidden') === 'true' || ['presentation', 'none'].includes(el.getAttribute('role'))) return;
        if (items.length >= MAX_ITEMS) { skipped++; return; }
        push(place({
          id: id(el), kind: 'image', label: clean(el.alt), src, width: Math.round(box.width), height: Math.round(box.height),
          // 'missing' (no alt attribute), 'decorative' (alt=""), or 'text' - screen readers treat them differently.
          altState: !el.hasAttribute('alt') ? 'missing' : clean(el.alt) ? 'text' : 'decorative',
          caption: captionOf(el), style: { radius: css(el).borderTopLeftRadius },
        }, el));
      }

      // A drawn chart or diagram: inline SVG or canvas, kept as a picture with its caption.
      function drawing(el, src) {
        const box = el.getBoundingClientRect();
        const caption = captionOf(el);
        const name = clean(el.getAttribute('aria-label') || doc.getElementById(el.getAttribute('aria-labelledby') || '')?.textContent || el.querySelector?.(':scope > title')?.textContent || el.getAttribute('title'));
        if (!src) { skipped++; return; }
        push(place({
          id: id(el), kind: 'image', chart: true, label: (name || caption || 'Chart or diagram').slice(0, 300), src, width: Math.round(box.width), height: Math.round(box.height),
          altState: name ? 'text' : 'missing', caption: name && caption ? caption : '', style: { radius: '0px' },
        }, el));
      }
      function chart(el) {
        if (el.closest('a,button,[role="button"]') || !visible(el)) return;
        const box = el.getBoundingClientRect();
        if (box.width < 120 || box.height < 70) return; // icons and decoration
        drawing(el, styledSvg(el, box));
      }
      function canvas(el) {
        if (!visible(el)) return;
        const box = el.getBoundingClientRect();
        if (box.width < 120 || box.height < 70) return;
        let src = null;
        try { src = el.toDataURL('image/png'); } catch { src = null; } // cross-origin canvases cannot be read
        if (src && src.length > 6_000_000) src = null;
        if (src) drawing(el, src);
        else embed(el, 'canvas');
      }

      function embed(el, kind = el.localName) {
        if (!visible(el)) return;
        const box = el.getBoundingClientRect();
        if (kind !== 'audio' && (box.width < 120 || box.height < 60)) return;
        const raw = el.currentSrc || el.src || el.data || '';
        const url = /^https?:/i.test(raw) ? raw.slice(0, 600) : '';
        let host = '';
        try { host = url ? new URL(url).host : ''; } catch { host = ''; }
        const name = clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('name'));
        const caption = captionOf(el);
        const what = { video: 'Video', audio: 'Audio', iframe: 'Embedded content', object: 'Embedded content', embed: 'Embedded content', canvas: 'Interactive graphic' }[kind] || 'Embedded content';
        push(place({
          id: id(el), kind: 'embed', embed: kind, label: (name || caption || `${what}${host ? ` from ${host}` : ''}`).slice(0, 300),
          poster: kind === 'video' && /^https?:/i.test(el.poster || '') ? el.poster : undefined, src: url || undefined, host: host || undefined,
          width: Math.round(box.width), height: Math.round(box.height), caption: name && caption ? caption : '', style: { radius: '0px' },
        }, el));
      }

      function table(el, ctx) {
        const role = el.getAttribute('role');
        const data = !['presentation', 'none'].includes(role) && !el.querySelector('table') && (el.querySelector('th,caption,thead'))
          && el.rows.length >= 2;
        if (!data || !visible(el)) { walkChildren(el, ctx); return; }
        const rows = [];
        let headerRows = 0;
        for (const tr of Array.from(el.rows).slice(0, 400)) {
          if (!tr.getClientRects().length) continue;
          const cells = Array.from(tr.cells).slice(0, 16).map((cell) => {
            const a = cell.querySelector('a[href]');
            const text = clean(cell.innerText || cell.textContent).slice(0, 400);
            const out = { t: text };
            if (cell.tagName === 'TH') out.h = 1;
            if (cell.colSpan > 1) out.span = Math.min(cell.colSpan, 16);
            if (a && hrefOf(a) && clean(a.textContent).length >= text.length * 0.5) { out.link = id(a); out.href = hrefOf(a); }
            return out;
          });
          if (!cells.length) continue;
          rows.push(cells);
          if (headerRows === rows.length - 1 && (tr.parentElement?.tagName === 'THEAD' || cells.every((c) => c.h))) headerRows = rows.length;
        }
        if (!rows.length) return;
        const caption = clean(el.caption?.textContent) || captionOf(el);
        if (el.caption === null || !el.caption) captionOf(el);
        const headers = (rows[0] || []).map((c) => c.t).filter(Boolean).slice(0, 6).join(', ');
        push(place({
          id: id(el), kind: 'table', label: (caption || `Table: ${headers}`).slice(0, 300), caption, rows, headerRows, rowCount: rows.length,
          colCount: Math.max(...rows.map((r) => r.reduce((n, c) => n + (c.span || 1), 0))), style: textStyle(el),
        }, el));
      }

      function code(el) {
        const text = (el.innerText || el.textContent || '').replace(/\s+$/g, '');
        if (!text.trim() || !hasRects(el)) return;
        push(place({ id: itemId(el), kind: 'code', label: text.slice(0, 8000), style: textStyle(el) }, el));
      }

      function field(el) {
        if (el.matches(PROTECTED)) { skipped++; return; }
        if (!visible(el)) return;
        const tag = el.localName;
        const named = label(el);
        if (!named && ['checkbox', 'radio'].includes(el.type)) return; // unlabelled hidden toggles used for CSS-only menus
        const text = named || 'Unnamed field';
        push(place({
          id: id(el), label: text.slice(0, 2500), kind: 'field',
          type: tag === 'input' ? el.type : tag, value: el.value, checked: el.checked, required: el.required,
          disabled: el.disabled || el.readOnly, multiple: el.multiple, form: !!el.form,
          options: tag === 'select' ? Array.from(el.options).map((o) => ({ value: o.value, label: o.text, disabled: o.disabled })) : undefined,
          error: el.validity && !el.validity.valid ? el.validationMessage : '', placeholder: el.placeholder || undefined,
          style: boxStyle(el), labelStyle: el.labels?.[0] ? textStyle(el.labels[0]) : undefined,
        }, el));
      }

      function action(el) {
        if (!visible(el)) return;
        const tag = el.localName;
        let text = label(el);
        // A button or link with no accessible name (an icon, a logo): keep it so it can be named, instead of dropping it.
        let unnamed = false;
        if (!text && el.matches('button,a,[role="button"]') && (el.querySelector('svg,img,i,span') || el.className)) { unnamed = true; text = ''; }
        else if (!text) return;
        if (/^\[[\w ]{1,12}\]$/.test(text) || /^\[?edit( source)?\]?$/i.test(text)) return; // citation markers like [29] and section edit links
        const item = place({
          id: id(el), label: text.slice(0, 2500), kind: 'action',
          disabled: el.disabled, confirm: el.matches('button,input,a[download]'), link: tag === 'a', style: boxStyle(el),
          thumb: tag === 'input' ? null : thumbOf(el),
        }, el);
        if (tag === 'a' && /^https?:/i.test(el.href)) item.href = el.href.slice(0, 600);
        // What the page shows on the button can differ from its accessible name (an aria-label like "Toggle menu").
        const shown = clean(el.innerText);
        if (shown && shown !== text) item.shown = shown.slice(0, 300);
        if (unnamed) {
          item.unnamed = true;
          // What a person (or Claude) could use to guess its purpose.
          item.hint = clean([el.getAttribute('title'), el.getAttribute('data-testid'), el.id, String(el.className?.baseVal ?? el.className), tag === 'a' ? new URL(el.href, doc.baseURI).pathname : '',
            // Words beside the icon help only when they are few (a label next to it), not a whole menu's text.
            (el.parentElement?.textContent || '').length <= 60 ? el.parentElement.textContent : ''].filter(Boolean).join(' ')).slice(0, 160);
        }
        push(item);
      }

      function heading(el, ctx) {
        if (!hasRects(el)) return;
        const runs = [];
        for (const child of el.childNodes) inlineNode(child, runs, {});
        // Headings keep their links but never bold/italic noise.
        emitText(el, runs.map(({ b, i, ...rest }) => rest), ctx, 'heading');
      }

      function walk(el, ctx) {
        const tag = el.localName;
        if (SKIP.has(tag) || el.hasAttribute('data-access-root')) return;
        if (el.hasAttribute('hidden') || (el.inert && !el.hasAttribute('data-access-inert'))) return;
        const style = css(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        if (/^h[1-6]$/.test(tag)) return heading(el, ctx);
        if (tag === 'img') return image(el);
        if (tag === 'svg') return chart(el);
        if (tag === 'canvas') return canvas(el);
        if (tag === 'video' || tag === 'audio' || tag === 'iframe' || tag === 'object' || tag === 'embed') return embed(el);
        if (tag === 'table') return table(el, ctx);
        if (tag === 'pre') return code(el);
        if (el.matches(FIELD)) return field(el);
        if (el.matches(BUTTONISH)) return action(el);
        if (tag === 'a' && el.hasAttribute('href')) {
          // A picture that is a link (a figure on a page) is content: keep the picture; a small logo stays a named link.
          const pictures = Array.from(el.querySelectorAll('img')).filter((img) => img.getBoundingClientRect().width >= 120 && big(img));
          const content = el.closest('figure') || regionOf(el) === 'main' || pictures.some((img) => img.getBoundingClientRect().width >= 300);
          if (pictures.length && content && !clean(el.innerText)) { pictures.forEach(image); return; }
          return action(el);
        }
        if (tag === 'label') { el.querySelectorAll(FIELD).forEach(field); return; } // a label's words belong to its field
        if (tag === 'figcaption' && captioned.has(el.closest('figure'))) return;
        if (tag === 'blockquote') return walkChildren(el, { ...ctx, quote: true });
        // Visually hidden text (screen-reader-only helpers) is not content for a sighted view.
        const box = el.getBoundingClientRect();
        if (box.width <= 1 && box.height <= 1 && style.overflow !== 'visible' && style.display !== 'contents') return;
        return walkChildren(el, ctx);
      }

      if (doc.body) walk(doc.body, {});
      return { title: doc.title || 'Untitled page', url: doc.location.href, lang: doc.documentElement.lang || '', items, skipped, theme: siteTheme() };
    }

    function target(key) {
      const el = elements.get(key);
      if (!el || !el.isConnected || !visible(el)) throw new Error('The page changed. Refresh before trying again.');
      if (el.disabled || el.readOnly) throw new Error('This control is unavailable.');
      return el;
    }

    function setValue(key, value) {
      const el = target(key);
      if (!el.matches('input,select,textarea') || ['password', 'file', 'hidden'].includes(el.type)) throw new Error('Edit this field on the original page.');
      if (el.multiple) throw new Error('Use the original page for multiple selection.');
      const property = ['checkbox', 'radio'].includes(el.type) ? 'checked' : 'value';
      const proto = el.tagName === 'INPUT' ? win.HTMLInputElement.prototype : el.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, property).set.call(el, value);
      el.dispatchEvent(new win.Event('input', { bubbles: true }));
      el.dispatchEvent(new win.Event('change', { bubbles: true }));
      return el.validity && !el.validity.valid ? el.validationMessage : 'Updated on the original page.';
    }

    function activate(key) {
      const el = target(key);
      if (!el.matches('button,a,input[type="submit"],input[type="button"],input[type="reset"]')) throw new Error('Unsupported action.');
      if (el.tagName === 'A' && !['http:', 'https:'].includes(new URL(el.href, doc.baseURI).protocol)) throw new Error('Use the original page for this link type.');
      el.click();
      return 'Action sent. Check page feedback below; completion is not yet confirmed.';
    }

    // Opens an address the page itself did not contain (a menu item found by the Apify agent).
    function open(href) {
      const url = new URL(String(href), doc.baseURI);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use the original page for this link type.');
      win.location.assign(url.href);
      return 'Opening the page.';
    }

    function observe(callback) {
      let timer;
      const observer = new win.MutationObserver((changes) => {
        if (changes.every((c) => c.target.nodeType === 1 && c.target.closest('[data-access-root]'))) return;
        clearTimeout(timer);
        timer = setTimeout(callback, 350);
      });
      observer.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'aria-invalid', 'aria-expanded'] });
      return () => { clearTimeout(timer); observer.disconnect(); };
    }

    // Many pages draw pictures and charts only when they scroll into view. Visit the page top to bottom once
    // (the redesigned view covers it) so they exist before the scan, then come back to where the person was.
    async function warm() {
      const scroller = doc.scrollingElement || doc.documentElement;
      const start = scroller.scrollTop;
      const step = Math.max(300, win.innerHeight * 0.9);
      const end = Math.min(scroller.scrollHeight, 60000);
      for (let y = 0, n = 0; y < end && n < 70; y += step, n++) {
        scroller.scrollTop = y;
        await new Promise((r) => setTimeout(r, 90));
      }
      await new Promise((r) => setTimeout(r, 250));
      scroller.scrollTop = start;
    }

    return { scan, setValue, activate, open, observe, warm };
  }

  globalThis.AccessEngine = { create };
})();
