const button = document.querySelector('#open');
const status = document.querySelector('#status');

button.onclick = async () => {
  button.disabled = true;
  button.textContent = 'Working\u2026';
  status.hidden = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'OPEN_ACCESS' });
    if (result?.ok) { window.close(); return; }
    throw new Error(result?.error || 'Could not open this page.');
  } catch (error) {
    status.textContent = error.message;
    status.hidden = false;
    button.disabled = false;
    button.textContent = 'Redesign page';
  }
};