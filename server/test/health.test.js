const test = require('node:test');
const assert = require('node:assert/strict');
const HealthMonitor = require('../src/healthMonitor');

function monitor(endpoints, probe) {
  const m = new HealthMonitor({ state: { monitoring: { endpoints } } }, 20000);
  m.probe = probe;
  return m;
}

test('remote http endpoint: one failure is degraded, two in a row is down, and it is not re-probed every sweep', async () => {
  let calls = 0;
  const m = monitor([{ id: 'EP-1', name: 'Render', url: 'https://example.onrender.com/api/health' }], async () => { calls++; throw new Error('timeout'); });

  await m.checkAll();
  assert.equal(m.metrics['EP-1'].currentStatus, 'degraded');

  await m.checkAll(); // timer sweep 20s later: not due yet (5 min interval)
  assert.equal(calls, 1);

  await m.checkAll(true); // manual sweep forces a probe
  assert.equal(calls, 2);
  assert.equal(m.metrics['EP-1'].currentStatus, 'down');
});

test('local/tcp endpoints go down immediately and are probed every sweep', async () => {
  let calls = 0;
  const m = monitor([{ id: 'EP-2', name: 'Redis', url: 'redis://127.0.0.1:6379' }], async () => { calls++; throw new Error('refused'); });

  await m.checkAll();
  assert.equal(m.metrics['EP-2'].currentStatus, 'down');
  m.metrics['EP-2'].lastCheckedMs -= 20000; // 20s later
  await m.checkAll();
  assert.equal(calls, 2);
});

test('recovery resets the failure streak', async () => {
  let fail = true;
  const m = monitor([{ id: 'EP-3', name: 'Web', url: 'https://example.com/' }], async () => { if (fail) throw new Error('x'); return 200; });
  await m.checkAll(true);
  fail = false;
  await m.checkAll(true);
  assert.equal(m.metrics['EP-3'].currentStatus, 'operational');
  assert.equal(m.metrics['EP-3'].failStreak, 0);
});

test('after start() sweeps still run (scheduler flag must not block checkAll)', async () => {
  let calls = 0;
  const m = monitor([{ id: 'EP-4', name: 'Local', url: 'http://127.0.0.1:9/' }], async () => { calls++; return 200; });
  m.start();
  await new Promise((r) => setTimeout(r, 50)); // start() probes immediately
  assert.equal(calls, 1);
  await m.checkAll(true); // manual sweep works while the scheduler is on
  assert.equal(calls, 2);
  m.stop();
});
