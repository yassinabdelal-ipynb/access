const SERVER = 'http://127.0.0.1:4173';

async function openAccess() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || '')) {
    throw new Error('Open a normal HTTP(S) webpage first. Restricted browser pages cannot be adapted.');
  }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['engine.js', 'reader.js', 'motor.js', 'ui.js', 'content.js'] });
  return { ok: true };
}

// The Anthropic key lives only on the local Access server; the extension just relays the plan request.
async function planWithAi(payload) {
  let response;
  try {
    response = await fetch(`${SERVER}/api/redesign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Access': '1' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: 'The Access server is not running. Start it with "node server.mjs" in the Access folder.' };
  }
  const data = await response.json().catch(() => ({}));
  return response.ok ? { ok: true, plan: data } : { ok: false, error: data.error || 'The AI redesign failed.' };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'MOTOR_CONTROL') {
    fetch(`${SERVER}/api/motor`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Access': '1' }, body: JSON.stringify(message.payload) })
      .then(async (r) => { const data = await r.json(); respond(r.ok ? { ok: true, state: data } : { ok: false, error: data.error }); })
      .catch(() => respond({ ok: false, error: 'Start the local Access server ("node server.mjs" in the Access folder) to use head control.' }));
    return true;
  }
  if (message.type === 'OPEN_ACCESS') {
    openAccess().then(respond, (error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'AI_REDESIGN') {
    planWithAi(message.payload).then(respond);
    return true;
  }
  if (message.type === 'SITE_STATUS') {
    fetch(`${SERVER}/api/status`, { headers: { 'X-Access': '1' } })
      .then(async (r) => { const data = await r.json().catch(() => ({})); respond({ ok: r.ok, site: !!data.site }); })
      .catch(() => respond({ ok: false, site: false }));
    return true;
  }
  if (message.type === 'SITE_READ') {
    // The Apify token lives only on the local Access server; the extension relays the address and gets plain site data back.
    fetch(`${SERVER}/api/site`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Access': '1' }, body: JSON.stringify(message.payload) })
      .then(async (r) => { const data = await r.json().catch(() => ({})); respond(r.ok ? { ok: true, site: data.site } : { ok: false, error: data.error || 'Could not read this site.' }); })
      .catch(() => respond({ ok: false, error: 'The Access server is not running. Start it with "node server.mjs" in the Access folder.' }));
    return true;
  }  if (message.type === 'AI_DESCRIBE') {
    // The local server downloads the images and asks Claude to describe them; nothing is cached in the extension.
    fetch(`${SERVER}/api/describe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Access': '1' }, body: JSON.stringify(message.payload) })
      .then(async (r) => { const data = await r.json().catch(() => ({})); respond(r.ok ? { ok: true, result: data } : { ok: false, error: data.error || 'Image descriptions failed.' }); })
      .catch(() => respond({ ok: false, error: 'The Access server is not running. Start it with "node server.mjs" in the Access folder.' }));
    return true;
  }
});
