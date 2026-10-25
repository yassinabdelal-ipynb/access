// Head control follows one head: the nearest at first, then the same head, even when someone else steps in.
// Runs the pure-Python unit tests in eye-tracking/head-mouse (no camera needed). Needs Python with numpy.
// Set ACCESS_PYTHON to pick the interpreter; skipped when no Python can be started.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const python = process.env.ACCESS_PYTHON || process.env.ACCESS_ML_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const folder = path.dirname(fileURLToPath(new URL('../eye-tracking/head-mouse/test_face_lock.py', import.meta.url)));
try { execFileSync(python, ['--version'], { stdio: 'ignore' }); } catch {
  console.log('Face lock test skipped: Python not found (set ACCESS_PYTHON).');
  process.exit(0);
}
try {
  const out = execFileSync(python, ['test_face_lock.py'], { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  console.log('Face lock passed:', (out || '').trim() || 'ok');
} catch (error) {
  console.error(String(error.stderr || error.stdout || error.message));
  process.exitCode = 1;
}
