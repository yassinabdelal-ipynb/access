// Local controller bridge. No shell, arbitrary commands, coordinates or camera frames.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function createMotorBridge({ launch = spawn, python = process.env.ACCESS_PYTHON || process.env.ACCESS_ML_PYTHON || (process.platform === 'win32' ? 'python' : 'python3') } = {}) {
  let child, owner, lastSeen = 0, buffer = '', revision = 0, face = null;
  const sequences = new Map();
  let state = { enabled: false, pending: false, message: 'Mouse / trackpad mode.' };
  const script = fileURLToPath(new URL('../eye-tracking/head-mouse/head_blink_mouse.py', import.meta.url));
  const send = (command) => { if (child?.stdin.writable) child.stdin.write(JSON.stringify({ command }) + '\n'); };
  function start() {
    if (child) return;
    state = { enabled: false, pending: true, message: 'Loading camera and saved head-mouse settings...' };
    const proc = launch(python, [script, '--bridge'], { cwd: path.dirname(script), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child = proc; buffer = '';
    proc.stdin.on('error', () => {});
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 65536) buffer = '';
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        try {
          const v = JSON.parse(line);
          if (v.type === 'status' && child === proc) state = v;
          // Schematic face landmarks for the on-screen mask: numbers only, never camera images.
          else if (v.type === 'face' && child === proc && Array.isArray(v.pts) && v.pts.length === 276 && v.pts.every((n) => Number.isFinite(n) && n > -1 && n < 2)) {
            face = { pts: v.pts, b: Array.isArray(v.b) ? v.b.slice(0, 6).map((n) => (Number.isFinite(n) ? n : 0)) : [], at: Date.now() };
          }
        } catch { /* libraries may print startup messages */ }
      }
    });
    // Drain model logs; don't expose local paths or raw exception details to sites.
    proc.stderr.on('data', () => {});
    const ended = () => {
      if (child !== proc) return;
      child = null; owner = null; face = null;
      state = { enabled: false, pending: false, message: 'Controller stopped. Close other head-mouse windows and camera apps, then choose Head control again.' };
    };
    proc.on('error', ended); proc.on('exit', ended);
  }
  const timer = setInterval(() => {
    if (owner && Date.now() - lastSeen > 6000) {
      send('manual'); owner = null; revision++;
      state = { ...state, enabled: false, pending: false, message: 'Browser disconnected. Head control paused.' };
    }
  }, 1000);
  timer.unref();
  return {
    command({ command, client, sequence, face: wantFace }) {
      if (!['head', 'manual', 'heartbeat', 'status', 'recenter'].includes(command) || !/^[a-zA-Z0-9-]{16,80}$/.test(client || '') || !Number.isSafeInteger(sequence) || sequence < 1) {
        throw Object.assign(new Error('Invalid motor-control request.'), { status: 400 });
      }
      // A delayed "head" request must never undo a newer manual/pause request.
      if (sequence <= (sequences.get(client) || 0)) return { ...state, owned: owner === client, revision };
      sequences.set(client, sequence);
      if (sequences.size > 500) sequences.delete(sequences.keys().next().value);
      if (command === 'head') {
        start(); owner = client; lastSeen = Date.now(); revision++;
        send('head');
      } else if (owner === client) {
        if (command === 'manual') {
          send('manual'); owner = null; revision++;
          state = { ...state, enabled: false, pending: false, message: 'Mouse / trackpad mode.' };
        } else if (command === 'heartbeat') { lastSeen = Date.now(); send('heartbeat'); }
        else if (command === 'recenter') send('recenter');
      }
      const mine = owner === client;
      // The face landmarks go only to the page that owns head control, and only when asked for.
      return { ...state, owned: mine, revision, ...(wantFace === true ? { face: mine && face && Date.now() - face.at < 600 ? { pts: face.pts, b: face.b } : null } : {}) };
    },
    close() { clearInterval(timer); send('quit'); child?.stdin.end(); owner = null; },
  };
}
