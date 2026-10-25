// Motor interaction layer shared by the app and extension. No AI-generated code.
(() => {
  if (globalThis.AccessMotor) return;
  // null = automatic: dwell click only on the big-tile board, never on the whole page where targets are small.
  const DWELLS = [null, 800, 1200, 2000, 0];
  const LOCK = 60; // After a dwell click the pointer must travel this far before the next one can start.
  const DWELL_TARGET = 'button:not(:disabled), a[href], summary, select:not(:disabled), .check label, input[type=checkbox], input[type=radio]';
  globalThis.AccessMotor = { mount({ panel, main, root, control, announce, getDwell = () => null, setDwell = () => {}, boardOn = () => false, canBoard = () => false, toggleBoard = () => {} }) {
    const dwellNow = () => { const ms = getDwell(); return ms === null ? (panel.dataset.board === 'true' ? 1200 : 0) : ms; };
    const doc = panel.ownerDocument, win = doc.defaultView;
    const client = crypto.randomUUID();
    let active = false, desired = 'manual', destroyed = false, version = 0, inFlight = false, sequence = 0;
    let target, hoverTimer, scrollTimer, frame, lastTime, scrollTarget;
    let shift = false, symbols = false;
    const make = (tag, text, cls) => {
      const el = doc.createElement(tag); if (text) el.textContent = text;
      if (cls) el.className = cls; return el;
    };
    const button = (name, fn) => {
      const b = make('button', name); b.type = 'button'; b.onclick = fn; return b;
    };
    const toolbar = make('div', null, 'motor-toolbar'); toolbar.hidden = true;
    toolbar.setAttribute('role', 'region'); toolbar.setAttribute('aria-label', 'Motor impairment controls');
    const status = make('span', 'Mouse / trackpad mode.', 'motor-state'); status.setAttribute('role', 'status');
    const wink = make('progress'); wink.max = 3; wink.value = 0; wink.setAttribute('aria-label', 'Right wink hold progress');
    const winkText = make('span', 'Open both eyes, then hold your right eye closed.');
    const head = button('Head control', () => switchMode('head'));
    const manual = button('Mouse / trackpad', () => switchMode('manual'));
    const recenter = button('Recenter head', () => request('recenter'));
    const dwellBtn = button('Dwell click', () => { const i = DWELLS.indexOf(getDwell()); setDwell(DWELLS[(i + 1) % DWELLS.length]); showDwell(); });
    const restBtn = button('Rest', () => setRest(true));
    const wake = button('Resume', () => setRest(false)); wake.dataset.wake = 'true'; wake.className = 'motor-wake';
    const rest = make('div', null, 'motor-rest'); rest.hidden = true; rest.setAttribute('role', 'dialog'); rest.setAttribute('aria-label', 'Resting');
    rest.append(make('p', 'Resting. Nothing will be clicked.'), wake);
    const sweep = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sweep.setAttribute('viewBox', '0 0 100 100'); sweep.setAttribute('class', 'motor-dwell'); sweep.setAttribute('aria-hidden', 'true');
    sweep.innerHTML = '<circle class="track" cx="50" cy="50" r="40"/><circle class="fill" cx="50" cy="50" r="40" pathLength="100"/>';
    sweep.style.display = 'none';
    // One button switches between the whole page and the big tiles; it always names the view it will switch to.
    const viewBtn = button('Big tiles', () => { toggleBoard(); showView(); }); viewBtn.className = 'motor-view';
    function showView() {
      const on = boardOn();
      viewBtn.textContent = on ? 'Whole page' : 'Big tiles';
      viewBtn.setAttribute('aria-label', on ? 'Whole page' : 'Big tiles');
      viewBtn.disabled = !on && !canBoard();
    }
    // Less-used controls live behind one Advanced button.
    const advBtn = button('Advanced', () => setAdvanced(adv.hidden)); advBtn.className = 'motor-adv'; advBtn.setAttribute('aria-expanded', 'false'); advBtn.setAttribute('aria-controls', 'motor-advanced');
    const adv = make('div', null, 'motor-advanced'); adv.id = 'motor-advanced'; adv.hidden = true; adv.setAttribute('role', 'group'); adv.setAttribute('aria-label', 'Advanced settings');
    const row = (control, hint) => { const r = make('div', null, 'motor-adv-row'); r.append(control, make('span', hint)); return r; };
    adv.append(row(recenter, 'Set your current position as the middle.'), row(dwellBtn, 'Hold the pointer still on a target to click it.'), row(restBtn, 'Pause everything until you choose Resume.'));
    function setAdvanced(open) { adv.hidden = !open; advBtn.setAttribute('aria-expanded', String(open)); }

    // A schematic face (outline, eyes, brows, nose, lips) drawn from landmark numbers only. It follows the head;
    // no camera picture is ever sent or shown.
    const NS = 'http://www.w3.org/2000/svg';
    const GROUPS = [['oval', 36, 1], ['eyeR', 16, 1], ['eyeL', 16, 1], ['browR', 10, 1], ['browL', 10, 1], ['nose', 10, 0], ['lipsOut', 20, 1], ['lipsIn', 20, 1]];
    const mask = make('div', null, 'motor-face'); mask.hidden = true; mask.dataset.state = 'wait';
    mask.setAttribute('role', 'img'); mask.setAttribute('aria-label', 'Live face mask. It shows how your head and face are moving. No camera picture is shown.');
    const maskSvg = doc.createElementNS(NS, 'svg'); maskSvg.setAttribute('viewBox', '0.2 0.12 0.6 0.5'); maskSvg.setAttribute('aria-hidden', 'true');
    const shapes = GROUPS.map(([name]) => { const el = doc.createElementNS(NS, 'path'); el.setAttribute('class', `m-${name}`); maskSvg.append(el); return el; });
    const dots = doc.createElementNS(NS, 'path'); dots.setAttribute('class', 'm-dots'); maskSvg.append(dots);
    const maskHint = make('span', 'Looking for your face', 'motor-face-hint');
    mask.append(maskSvg, maskHint);
    let shown = null, goal = null, maskFrame = 0, lastFace = 0;
    function setFace(face) {
      if (!face) { if (Date.now() - lastFace > 700) mask.dataset.state = lastFace ? 'lost' : 'wait'; return; }
      lastFace = Date.now(); mask.dataset.state = 'live';
      // Mirror like a mirror would (x), and keep the camera's 4:3 shape (y).
      goal = new Float32Array(276);
      for (let i = 0; i < 138; i++) { goal[2 * i] = 1 - face.pts[2 * i]; goal[2 * i + 1] = face.pts[2 * i + 1] * 0.75; }
      if (!shown) shown = Float32Array.from(goal);
      if (!maskFrame) maskFrame = win.requestAnimationFrame(drawMask);
    }
    function drawMask() {
      maskFrame = 0;
      if (!goal || !shown || mask.hidden || destroyed) return;
      let moving = false, k = 0, dotsPath = '';
      for (let i = 0; i < 276; i++) { const d = goal[i] - shown[i]; if (Math.abs(d) > 0.0004) { shown[i] += d * 0.35; moving = true; } else shown[i] = goal[i]; }
      GROUPS.forEach(([, n, closed], g) => {
        let d = '';
        for (let i = 0; i < n; i++, k++) { const x = shown[2 * k].toFixed(4), y = shown[2 * k + 1].toFixed(4); d += `${i ? 'L' : 'M'}${x} ${y}`; dotsPath += `M${x} ${y}h0`; }
        shapes[g].setAttribute('d', closed ? `${d}Z` : d);
      });
      dots.setAttribute('d', dotsPath);
      if (moving) maskFrame = win.requestAnimationFrame(drawMask);
    }
    function markWink(seconds) { mask.dataset.wink = seconds > 0 ? 'true' : 'false'; }

    toolbar.append(head, manual, viewBtn, advBtn, status, wink, winkText, mask, adv);
    panel.prepend(toolbar); panel.append(sweep, rest);    const rails = make('div', null, 'motor-scroll'); rails.hidden = true;
    rails.setAttribute('aria-label', 'Hover scroll controls');
    const keyboard = make('section', null, 'motor-keyboard'); keyboard.hidden = true;
    keyboard.setAttribute('aria-label', 'On-screen keyboard');
    const label = make('strong', 'Keyboard');
    const keytop = make('div', null, 'motor-keyboard-title');
    keytop.append(label, button('Done typing', hideKeyboard));
    const keys = make('div', null, 'motor-keys');
    keyboard.append(keytop, keys); panel.append(rails, keyboard);
    const ro = new ResizeObserver(() => {
      panel.style.setProperty('--motor-keyboard-height', keyboard.hidden ? '0px' : `${keyboard.offsetHeight + 24}px`);
      // The room for the keyboard exists only now, so lift the field being typed in above it.
      if (!keyboard.hidden && target?.isConnected) {
        target.style.scrollMarginBottom = `${keyboard.offsetHeight + 32}px`;
        requestAnimationFrame(() => target?.isConnected && target.scrollIntoView({ block: 'nearest', behavior: 'instant' }));
      }
    }); ro.observe(keyboard);

    function showDwell() {
      const raw = getDwell(), ms = dwellNow();
      dwellBtn.textContent = raw === null ? 'Dwell: tiles only' : ms ? `Dwell ${ms / 1000} s` : 'Dwell off';
      dwellBtn.setAttribute('aria-label', raw === null ? `Dwell click is automatic: on for big tiles${ms ? ` (${ms / 1000} seconds)` : ', off on the whole page'}. Press to change.`
        : ms ? `Dwell click after ${ms / 1000} seconds. Press to change.` : 'Dwell click is off. Press to change.');
      dwellBtn.setAttribute('aria-pressed', String(ms > 0));
    }
    function setRest(on) {
      stopDwell(); setAdvanced(false); rest.hidden = !on; panel.dataset.rest = String(on);
      if (on) { hideKeyboard(); announce?.('Resting. Look at Resume and hold still, or press it, to continue.'); wake.focus(); }
      else restBtn.focus();
    }
    // ---------- Dwell click: hold the pointer on a target and a ring fills; looking away cancels. ----------
    let dwellEl = null, dwellTimer = null, lock = null; const ptr = { x: 0, y: 0 };
    function stopDwell() {
      clearTimeout(dwellTimer); dwellTimer = null;
      if (dwellEl) { delete dwellEl.dataset.dwelling; dwellEl.style.removeProperty('--dwell'); }
      dwellEl = null; sweep.style.display = 'none';
    }
    function startDwell(el, ms, fire) {
      stopDwell(); dwellEl = el; el.dataset.dwelling = 'true'; el.style.setProperty('--dwell', `${ms}ms`);
      sweep.style.setProperty('--dwell', `${ms}ms`);
      sweep.style.display = ''; placeRing();
      const fill = sweep.querySelector('.fill'); fill.style.animation = 'none'; void fill.getBoundingClientRect(); fill.style.animation = '';
      dwellTimer = setTimeout(() => {
        const was = dwellEl; stopDwell();
        if (!was?.isConnected || !active) return;
        lock = { x: ptr.x, y: ptr.y }; fire(was);
      }, ms);
    }
    function placeRing() { sweep.style.left = `${ptr.x - 42}px`; sweep.style.top = `${ptr.y - 42}px`; }
    const onMove = (e) => {
      ptr.x = e.clientX; ptr.y = e.clientY;
      if (dwellEl) placeRing();
      // pointerover fires before the move that frees the lock, so look at what is under the pointer once it is free.
      if (lock && Math.hypot(ptr.x - lock.x, ptr.y - lock.y) >= LOCK) { lock = null; if (hovered?.isConnected) consider(hovered); }
    };
    // A real click (mouse or wink) on the target replaces the dwell, so the same action never runs twice.
    const onClick = (e) => {
      if (!e.isTrusted) return;
      stopDwell(); lock = { x: e.clientX, y: e.clientY };
    };

    function showMode() {
      head.setAttribute('aria-pressed', String(desired === 'head'));
      manual.setAttribute('aria-pressed', String(desired === 'manual'));
      recenter.disabled = desired !== 'head';
      mask.hidden = desired !== 'head';
      if (desired !== 'head') { mask.dataset.state = 'wait'; lastFace = 0; goal = null; shown = null; }
    }
    async function request(command) {
      if (!control) { status.textContent = 'Start the local Access server to use head control.'; return null; }
      const mine = version;
      try {
        const reply = await control({ command, client, sequence: ++sequence, ...(command === 'heartbeat' || command === 'head' ? { face: true } : {}) });
        if (destroyed || mine !== version) return reply;
        status.textContent = reply.owned ? reply.message : desired === 'head' ? reply.message || 'Head controller disconnected.' : 'Mouse / trackpad mode.';
        wink.value = Number(reply.hold_seconds) || 0;
        markWink(wink.value);
        if (desired === 'head') setFace(reply.face);
        winkText.textContent = reply.enabled ? (reply.hold_seconds > 0 ? `RIGHT wink: ${Number(reply.hold_seconds).toFixed(1)} / 3 seconds` : reply.wink_armed ? 'Ready for RIGHT wink' : reply.cancel_reason || 'Open both eyes to get ready') : '';
        if (reply.owned && reply.enabled) status.textContent = `Head control ON · RIGHT wink 3 seconds = left click${reply.clicks_enabled === false ? ' · Wink clicks disabled (F10)' : ''}`;
        if (command === 'heartbeat' && (!reply.owned || (!reply.pending && !reply.enabled))) { desired = 'manual'; showMode(); }
        return reply;
      } catch (error) {
        if (mine !== version || destroyed) return null;
        desired = 'manual'; showMode(); status.textContent = error.message || 'Controller unavailable. Mouse / trackpad still works.';
        return null;
      }
    }
    function switchMode(mode) {
      version++; desired = mode; showMode();
      status.textContent = mode === 'head' ? 'Starting head control...' : 'Mouse / trackpad mode.';
      request(mode);
    }
    const pulse = setInterval(async () => {
      if (!active || desired !== 'head' || inFlight) return;
      inFlight = true; try { await request('heartbeat'); } finally { inFlight = false; }
    }, 110);

    const editable = (el) => el?.matches?.('textarea,input:not([type]),input[type=text],input[type=email],input[type=url],input[type=tel],input[type=search],input[type=number]') && !el.disabled && !el.readOnly;
    function hideKeyboard() { clearTimeout(hoverTimer); keyboard.hidden = true; target = null; stopScroll(); }
    function openKeyboard(el) {
      if (!active || !el.isConnected || !editable(el)) return;
      target = el; keyboard.hidden = false;
      label.textContent = `Keyboard: ${el.labels?.[0]?.textContent || 'Text field'}`;
      el.focus({ preventScroll: true });
      el.style.scrollMarginBottom = `${keyboard.offsetHeight + 32}px`;
      el.style.scrollMarginTop = `${toolbar.offsetHeight + 12}px`;
      el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
    function typeKey(key) {
      if (!target?.isConnected || !editable(target)) { hideKeyboard(); return; }
      if (key === 'Shift') { shift = !shift; drawKeys(); return; }
      if (key === 'Symbols') { symbols = !symbols; drawKeys(); return; }
      target.focus({ preventScroll: true });
      const value = target.value;
      const a = target.selectionStart ?? value.length, b = target.selectionEnd ?? a;
      if (key === 'Left' || key === 'Right') {
        const caret = key === 'Left' ? Math.max(0, a - 1) : Math.min(value.length, b + 1);
        try { target.setSelectionRange(caret, caret); } catch { /* native email/number fields */ }
        return;
      }
      let start = a, end = b, insert = '';
      if (key === 'Backspace') start = a === b ? Math.max(0, a - 1) : a;
      else if (key === 'New line') { if (target.tagName !== 'TEXTAREA') return; insert = '\n'; }
      else insert = key === 'Space' ? ' ' : shift ? key.toUpperCase() : key;
      const next = value.slice(0, start) + insert + value.slice(end);
      if (target.maxLength >= 0 && next.length > target.maxLength) return;
      target.value = next;
      try { target.setSelectionRange(start + insert.length, start + insert.length); } catch { /* email/number */ }
      target.dispatchEvent(new win.Event('input', { bubbles: true }));
      target.dispatchEvent(new win.Event('change', { bubbles: true }));
    }
    function drawKeys() {
      keys.replaceChildren();
      const characters = symbols ? [...'!@#$%^&*()', ...'-_=+[]{}<>', ...':;"\'`~\\|/?', ...'1234567890'] : [...'1234567890', ...'qwertyuiop', ...'asdfghjkl;', ...'zxcvbnm,./'];
      for (const key of [...characters, '@', '-', '_', 'Shift', 'Space', 'Backspace', 'New line', 'Symbols', 'Left', 'Right']) {
        const shown = { Backspace: '⌫', 'New line': '↵', Shift: '⇧', Symbols: '#@!', Left: '←', Right: '→' }[key] || (key.length === 1 && shift ? key.toUpperCase() : key);
        const b = button(shown, () => typeKey(key));
        b.setAttribute('aria-label', `Key ${key}`);
        if (key === 'Shift') b.setAttribute('aria-pressed', String(shift));
        if (key === 'Symbols') b.setAttribute('aria-pressed', String(symbols));
        b.addEventListener('pointerdown', (e) => e.preventDefault());
        keys.append(b);
      }
    }
    drawKeys();
    let hovered = null;
    function onOver(e) { hovered = e.target; consider(e.target); }
    function consider(el) {
      if (!active || !el) return;
      const ms = dwellNow();
      const resting = panel.dataset.rest === 'true';
      if (!resting && editable(el) && el !== target) {
        // A field opens the keyboard: with dwell on it shows the ring (a little quicker), otherwise the old half-second hover.
        if (ms && !lock) startDwell(el, Math.max(500, Math.round(ms * 0.6)), openKeyboard);
        else if (!ms) { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => openKeyboard(el), 500); }
      } else if (ms && !lock) {
        const hit = el.closest?.(DWELL_TARGET);
        if (hit && (!resting || hit.dataset.wake) && !hit.closest('.motor-scroll [data-dir]') && hit !== dwellEl) startDwell(hit, ms, (node) => node.click());
        else if (!hit && dwellEl) stopDwell();
      }
      if (!rails.contains(el) && !toolbar.contains(el)) scrollTarget = scrollable(el);
    }
    const onOut = (e) => {
      if (editable(e.target)) clearTimeout(hoverTimer);
      if (dwellEl && !(e.relatedTarget && dwellEl.contains(e.relatedTarget))) stopDwell();
    };
    const onFocus = (e) => { if (active && editable(e.target) && e.target !== target) openKeyboard(e.target); };
    panel.addEventListener('pointerover', onOver); panel.addEventListener('pointerout', onOut); panel.addEventListener('focusin', onFocus);
    function scrollable(el) {
      for (let n = el; n; n = n.parentElement || n.getRootNode?.().host) {
        const style = win.getComputedStyle(n);
        if (/(auto|scroll)/.test(style.overflow + style.overflowX + style.overflowY) && (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1)) return n;
      }
      return doc.scrollingElement;
    }
    function stopScroll() { clearTimeout(scrollTimer); cancelAnimationFrame(frame); frame = null; lastTime = null; }
    const scrollers = [];
    // Back to top: one press, smooth jump to the start of the page.
    const topBtn = button('Back to top', () => {
      const el = scrollTarget?.isConnected ? scrollTarget : scrollable(main);
      el.scrollTo({ top: 0, behavior: win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    topBtn.className = 'motor-top'; topBtn.innerHTML = '<span class="arrow">⇧</span><span>Back to top</span>'; topBtn.setAttribute('aria-label', 'Back to top');
    rails.append(topBtn);
    // Tall hover zones. The farther the pointer is from the middle of the screen, toward the end of the zone, the faster it scrolls.
    const SPEED_MIN = .07, SPEED_MAX = 1.5; // pixels per millisecond
    for (const [name, dx, dy, arrow, hint] of [['Scroll up', 0, -1, '▲', 'farther up = faster'], ['Scroll down', 0, 1, '▼', 'farther down = faster'], ['Scroll left', -1, 0, '◀', ''], ['Scroll right', 1, 0, '▶', '']]) {
      const b = button(name, () => { const el = scrollTarget || scrollable(main); el.scrollBy(dx * 120, dy * 120); });
      b.innerHTML = `<span class="arrow">${arrow}</span><span>${name}</span>${hint ? `<small>${hint}</small>` : ''}`;
      b.setAttribute('aria-label', name); b.dataset.dir = dy < 0 ? 'up' : dy > 0 ? 'down' : dx < 0 ? 'left' : 'right';
      b.title = 'Hover to scroll. The farther toward the end of this button, the faster. Move away to stop.';
      // 0 at the inner edge of the zone, 1 at the far end.
      const depth = () => {
        const r = b.getBoundingClientRect();
        const f = dy < 0 ? (r.bottom - ptr.y) / r.height : dy > 0 ? (ptr.y - r.top) / r.height : dx < 0 ? (r.right - ptr.x) / r.width : (ptr.x - r.left) / r.width;
        return Math.min(1, Math.max(0, f));
      };
      b.onpointerenter = () => {
        stopScroll(); if (!active) return;
        scrollTimer = setTimeout(() => {
          const el = scrollTarget?.isConnected ? scrollTarget : scrollable(main);
          const step = (t) => {
            if (!active || doc.hidden || !b.matches(':hover')) { stopScroll(); b.style.removeProperty('--depth'); return; }
            const dt = lastTime == null ? 0 : Math.min(50, t - lastTime); lastTime = t;
            const f = depth(), speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * f * f;
            b.style.setProperty('--depth', f.toFixed(2));
            el.scrollBy(dx * dt * speed, dy * dt * speed); frame = requestAnimationFrame(step);
          };
          frame = requestAnimationFrame(step);
        }, 350);
      };
      b.onpointerleave = () => { stopScroll(); b.style.removeProperty('--depth'); }; rails.append(b); scrollers.push({ b, dx });
    }
    const overflowTimer = setInterval(() => {
      if (!active) return;
      const el = scrollTarget?.isConnected ? scrollTarget : scrollable(main);
      for (const { b, dx } of scrollers) b.hidden = !!dx && el.scrollWidth <= el.clientWidth + 1;
      if (target && !target.isConnected) hideKeyboard();
    }, 350);
    const blur = () => { stopScroll(); clearTimeout(hoverTimer); stopDwell(); };
    win.addEventListener('pointermove', onMove, true); panel.addEventListener('click', onClick, true);
    const hidden = () => { if (doc.hidden) { blur(); if (active && desired === 'head') switchMode('manual'); } };
    const unload = () => { if (active) control?.({ command: 'manual', client, sequence: ++sequence }).catch(() => {}); };
    const esc = (e) => { if (active && e.key === 'Escape') { if (!adv.hidden) { setAdvanced(false); advBtn.focus(); return; } switchMode('manual'); hideKeyboard(); } };
    const outside = (e) => { if (!adv.hidden && !e.composedPath().some((n) => n === adv || n === advBtn)) setAdvanced(false); };
    doc.addEventListener('pointerdown', outside, true);
    win.addEventListener('blur', blur); doc.addEventListener('visibilitychange', hidden);
    win.addEventListener('pagehide', unload); panel.addEventListener('keydown', esc);
    showMode(); showDwell();
    return {
      setActive(on, start = false) {
        if (on === active) return;
        active = on; toolbar.hidden = rails.hidden = !on; panel.dataset.motor = String(on);
        if (on) { switchMode('head'); }
        else { switchMode('manual'); hideKeyboard(); stopScroll(); stopDwell(); rest.hidden = true; panel.dataset.rest = 'false'; }
      },
      beforePaint() { hideKeyboard(); stopDwell(); },
      refreshDwell() { showDwell(); showView(); },
      // True while the person is mid-dwell or typing; the page view must not be rebuilt under them.
      busy: () => !!dwellEl || !keyboard.hidden,
      destroy() {
        unload(); destroyed = true; active = false; version++; stopDwell(); win.cancelAnimationFrame(maskFrame); doc.removeEventListener('pointerdown', outside, true);
        win.removeEventListener('pointermove', onMove, true); panel.removeEventListener('click', onClick, true); sweep.remove(); rest.remove();
        hideKeyboard(); clearInterval(pulse); clearInterval(overflowTimer); ro.disconnect();
        win.removeEventListener('blur', blur); doc.removeEventListener('visibilitychange', hidden); win.removeEventListener('pagehide', unload);
        panel.removeEventListener('keydown', esc); panel.removeEventListener('pointerover', onOver); panel.removeEventListener('pointerout', onOut); panel.removeEventListener('focusin', onFocus);
        toolbar.remove(); rails.remove(); keyboard.remove();
      },
    };
  }};
})();
