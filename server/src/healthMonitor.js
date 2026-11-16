const axios = require('axios');
const net = require('net');
const { EventEmitter } = require('events');

const LOCAL_TIMEOUT_MS = 5000;
const REMOTE_TIMEOUT_MS = 30000; // free Render/Aiven can take ~30s to wake from sleep
const REMOTE_INTERVAL_MS = 5 * 60 * 1000; // each /api/health hit runs a DB query on the free tier
const REMOTE_DOWN_AFTER_FAILURES = 2; // one failed probe = degraded, two in a row = down
const LOCAL_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|\[::1\])/i;
const TCP_TIMEOUT_MS = 4000;
const HISTORY_LIMIT = 20;
const DEFAULT_PORTS = { 'redis:': 6379, 'rediss:': 6379, 'postgresql:': 5432, 'postgres:': 5432, 'sftp:': 22, 'ssh:': 22, 'mysql:': 3306 };

function tcpProbe(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(TCP_TIMEOUT_MS);
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('TCP connect timeout')); });
    socket.once('error', reject);
  });
}

// Remote = public http(s) endpoint (free-tier hosted); everything else is cheap to probe often.
function isRemoteHttp(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !LOCAL_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

class HealthMonitor extends EventEmitter {
  constructor(vaultManager, intervalMs = 30000) {
    super();
    this.vaultManager = vaultManager;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.active = false; // scheduler on/off
    this.sweeping = false; // a sweep is in progress (prevents overlap)
    this.metrics = {}; // { [endpointId]: { history, currentStatus, lastLatency, lastChecked, checks, successes } }
  }

  start() {
    this.active = true;
    this.checkAll().finally(() => this.scheduleNext());
  }

  // Chained timers: the next sweep is scheduled only after the previous one finished.
  scheduleNext() {
    if (!this.active) return;
    this.timer = setTimeout(async () => {
      await this.checkAll();
      this.scheduleNext();
    }, this.intervalMs);
  }

  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.timer = null;
  }

  isDue(endpoint) {
    const m = this.metrics[endpoint.id || endpoint.name];
    if (!m?.lastCheckedMs) return true;
    const every = isRemoteHttp(endpoint.url) ? REMOTE_INTERVAL_MS : this.intervalMs;
    return Date.now() - m.lastCheckedMs >= every - 1000;
  }

  // `force` (manual sweep) probes everything; the timer only probes endpoints that are due.
  async checkAll(force = false) {
    if (this.sweeping) return Object.values(this.metrics);
    this.sweeping = true;
    try {
      const endpoints = this.vaultManager.state.monitoring?.endpoints || [];
      const ids = new Set(endpoints.map((ep) => ep.id || ep.name));
      Object.keys(this.metrics).forEach((id) => { if (!ids.has(id)) delete this.metrics[id]; });

      const due = endpoints.filter((ep) => force || this.isDue(ep));
      const results = await Promise.all(due.map((ep) => this.checkSingle(ep)));
      this.emit('update', { timestamp: new Date().toISOString(), results, metrics: this.metrics });
      return results;
    } finally {
      this.sweeping = false;
    }
  }

  async probe(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid URL');
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const timeout = isRemoteHttp(url) ? REMOTE_TIMEOUT_MS : LOCAL_TIMEOUT_MS;
      const resp = await axios.get(url, { timeout, validateStatus: () => true });
      return resp.status;
    }
    const port = Number(parsed.port) || DEFAULT_PORTS[parsed.protocol];
    if (!port) throw new Error(`No port for ${parsed.protocol}`);
    await tcpProbe(parsed.hostname, port);
    return null; // reachable, no HTTP status
  }

  async checkSingle(endpoint) {
    const id = endpoint.id || endpoint.name;
    const url = endpoint.url || '';

    const metric = this.metrics[id] || (this.metrics[id] = {
      id, history: [], currentStatus: 'unknown', lastLatency: 0, checks: 0, successes: 0
    });
    Object.assign(metric, { name: endpoint.name, project: endpoint.project, url });

    const startedAt = Date.now();
    let status = 'down';
    let statusCode = null;
    let error = null;

    try {
      if (!url) throw new Error('No URL provided');
      statusCode = await this.probe(url);
      status = statusCode === null || (statusCode >= 200 && statusCode < 400) ? 'operational' : 'degraded';
    } catch (err) {
      error = err.message;
    }

    metric.failStreak = status === 'operational' ? 0 : (metric.failStreak || 0) + 1;
    if (status === 'down' && isRemoteHttp(url) && metric.failStreak < REMOTE_DOWN_AFTER_FAILURES) {
      status = 'degraded'; // may just be a cold start; confirm on the next probe
    }

    metric.lastCheckedMs = Date.now();
    metric.lastLatency = Date.now() - startedAt;
    metric.currentStatus = status;
    metric.statusCode = statusCode;
    metric.error = error;
    metric.lastChecked = new Date().toISOString();
    metric.checks += 1;
    if (status === 'operational') metric.successes += 1;
    metric.uptimePct = Number(((metric.successes / metric.checks) * 100).toFixed(2));

    metric.history.push({ time: new Date().toLocaleTimeString(), latency: status === 'down' ? null : metric.lastLatency });
    if (metric.history.length > HISTORY_LIMIT) metric.history.shift();
    return metric;
  }

  getMetrics() {
    return this.metrics;
  }
}

module.exports = HealthMonitor;
