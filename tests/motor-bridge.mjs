import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createMotorBridge } from '../server/motor.mjs';
import { redesign } from '../server/redesign.mjs';
let launched = 0, child, writes = '';
const bridge = createMotorBridge({ launch(_exe, args, options) {
  launched++; assert(args.includes('--bridge')); assert.equal(options.windowsHide, true); assert.equal(options.shell, undefined);
  child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin.on('data', c => writes += c); return child;
} });
const client = 'motor-test-client-123456';
try {
  bridge.command({ command: 'head', client, sequence: 1 }); assert.equal(launched, 1);
  child.stdout.write(JSON.stringify({ type: 'status', enabled: true, pending: false, message: 'ON' }) + '\n');
  assert(bridge.command({ command: 'heartbeat', client, sequence: 2 }).enabled);
  assert.equal(bridge.command({ command: 'manual', client: 'another-client-123456', sequence: 1 }).owned, false);
  assert.equal(writes.includes('manual'), false, 'another tab cannot stop the owner');
  bridge.command({ command: 'manual', client, sequence: 4 });
  const count = writes.length;
  bridge.command({ command: 'head', client, sequence: 3 }); assert.equal(writes.length, count, 'late start cannot undo pause');
  assert.throws(() => bridge.command({ command: 'shell', client, sequence: 5 }), /Invalid/);
  bridge.command({ command: 'head', client, sequence: 6 }); assert.equal(launched, 1, 'singleton');
  await new Promise(r => setTimeout(r, 7200));
  assert.equal(bridge.command({ command: 'status', client, sequence: 7 }).owned, false, 'lease expired');
  assert(writes.trim().endsWith('{"command":"manual"}'));
} finally { bridge.close(); }
let sent;
const plan = await redesign({ purpose: 'motor', items: [
  { id: 'a', kind: 'action', link: true, label: 'Pay' },
  { id: 'b', kind: 'field', label: 'Name', value: 'PRIVATE' },
  { id: 'c', kind: 'text', label: 'Legal', words: 100 },
] }, { messages: { parse: async req => {
  sent = req; return { parsed_output: { summary: 'Test', main: [{ from: 'a', to: 'c' }], hide: [{ id: 'c', reason: 'other' }], collapse: [{ label: 'Hidden', ids: ['a'] }], chunks: [{ startId: 'b', title: 'Your details' }], gists: [{ id: 'c', text: 'Short legal' }] } };
} } });
assert(sent.system.includes('Motor impairment')); assert(!JSON.stringify(sent.messages).includes('PRIVATE'));
for (const k of ['hide', 'collapse', 'main', 'gists']) assert.deepEqual(plan[k], []);
assert.equal(plan.chunks.length, 1);
console.log('Bridge/policy passed: singleton, scoped owner, stale-request rejection, watchdog, fixed spawn, motor policy and value privacy.');
