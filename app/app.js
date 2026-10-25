const frame = document.querySelector('#demo');
const preview = document.querySelector('#preview');
const adapted = document.querySelector('#adapted');
const reopen = document.querySelector('#reopen');
const expand = document.querySelector('#expand');
const themeButtons = document.querySelectorAll('[data-theme-choice]');
const shadow = preview.attachShadow({ mode: 'open' });
const STORAGE_KEY = 'access-preferences';

let mounted;
let preferences = {};
try { preferences = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { /* storage unavailable */ }

function save(next) {
  preferences = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  showTheme(next.theme || 'auto');
}

function showTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === theme)));
}

function setExpanded(on) {
  adapted.classList.toggle('full', on);
  expand.setAttribute('aria-pressed', String(on));
  expand.textContent = on ? 'Exit full screen' : 'Full screen';
}

function start() {
  mounted?.destroy();
  preview.hidden = false;
  reopen.hidden = true;
  mounted = AccessUI.mount(shadow, AccessEngine.create(frame.contentDocument), {
    preferences,
    cssUrl: '/extension/access.css',
    onPreferences: save,
    onMotorControl: async (payload) => {
      const r = await fetch('/api/motor', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Access': '1' }, body: JSON.stringify(payload) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Head controller unavailable.');
      return data;
    },
    onDescribe: async (payload) => {
      let response;
      try {
        response = await fetch('/api/describe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Access': '1' }, body: JSON.stringify(payload) });
      } catch {
        throw new Error('The Access server is not running.');
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Image descriptions failed.');
      return data;
    },
    onRedesign: async (payload) => {
      let response;
      try {
        response = await fetch('/api/redesign', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Access': '1' }, body: JSON.stringify(payload) });
      } catch {
        throw new Error('The Access server is not running.');
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The AI redesign failed.');
      return data;
    },
    onClose: () => {
      mounted.destroy();
      setExpanded(false);
      preview.hidden = true;
      reopen.hidden = false;
      reopen.focus();
    },
  });
}

themeButtons.forEach((b) => {
  b.onclick = () => {
    save({ ...preferences, theme: b.dataset.themeChoice });
    mounted?.setPreferences({ theme: b.dataset.themeChoice });
  };
});
expand.onclick = () => setExpanded(!adapted.classList.contains('full'));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && adapted.classList.contains('full') && !shadow.querySelector('.sheet:not([hidden])')) setExpanded(false); });
reopen.onclick = start;

showTheme(preferences.theme || 'auto');
frame.addEventListener('load', start);
if (frame.contentDocument?.readyState === 'complete') start();
