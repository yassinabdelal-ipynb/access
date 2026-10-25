// Takes over the current page in place: the original stays alive underneath while
// Access shows a redesigned version of it. Running this again closes the overlay.
(() => {
  if (globalThis.__accessOverlay) { globalThis.__accessOverlay.close(); return; }

  const previous = document.activeElement;
  const root = document.documentElement;
  const host = document.createElement('div');
  host.dataset.accessRoot = 'true';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;overflow:auto;display:block;';
  root.append(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const savedOverflow = root.style.overflow;
  root.style.overflow = 'hidden';
  // The engine still reads the page; users and assistive tech only meet the redesign.
  document.body.dataset.accessInert = '';
  document.body.inert = true;

  let ui;
  function close() {
    ui?.destroy();
    host.remove();
    root.style.overflow = savedOverflow;
    document.body.inert = false;
    delete document.body.dataset.accessInert;
    delete globalThis.__accessOverlay;
    previous?.focus?.();
  }
  globalThis.__accessOverlay = { close };

  chrome.storage.local.get('preferences').then((saved) => {
    if (!host.isConnected) return;
    ui = AccessUI.mount(shadow, AccessEngine.create(document), {
      mode: 'overlay',
      cssUrl: chrome.runtime.getURL('access.css'),
      preferences: saved.preferences,
      onPreferences: (preferences) => chrome.storage.local.set({ preferences }),
      onClose: close,
      onMotorControl: async (payload) => {
        const reply = await chrome.runtime.sendMessage({ type: 'MOTOR_CONTROL', payload });
        if (!reply?.ok) throw new Error(reply?.error || 'Head controller unavailable.');
        return reply.state;
      },
      onDescribe: async (payload) => {
        const reply = await chrome.runtime.sendMessage({ type: 'AI_DESCRIBE', payload });
        if (!reply?.ok) throw new Error(reply?.error || 'Image descriptions failed.');
        return reply.result;
      },
      onSiteStatus: async () => (await chrome.runtime.sendMessage({ type: 'SITE_STATUS' }))?.site === true,
      onSite: async (payload) => {
        const reply = await chrome.runtime.sendMessage({ type: 'SITE_READ', payload });
        if (!reply?.ok) throw new Error(reply?.error || 'Could not read this site.');
        return reply.site;
      },      onRedesign: async (payload) => {
        const reply = await chrome.runtime.sendMessage({ type: 'AI_REDESIGN', payload });
        if (!reply?.ok) throw new Error(reply?.error || 'The AI redesign failed.');
        return reply.plan;
      },
    });
    shadow.querySelector('.dock-toggle')?.focus();
  });
})();
