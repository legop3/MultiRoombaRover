import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://rover.otter.land/';
const outDir = process.argv[3] || path.resolve('perf/results');
const cpuThrottle = Number(process.env.CPU_THROTTLE || 6);
const viewport = (process.env.VIEWPORT || '390x844').split('x').map((part) => Number(part));
const isMobile = process.env.MOBILE !== '0';
const sampleMs = Number(process.env.SAMPLE_MS || 45000);
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-root-runtime`;
const runDir = path.join(outDir, runId);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function main() {
  await fs.mkdir(runDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: viewport[0] || 390, height: viewport[1] || 844 },
    deviceScaleFactor: isMobile ? 3 : 1,
    isMobile,
    hasTouch: isMobile,
    ignoreHTTPSErrors: true,
  });

  await context.addInitScript(() => {
    const data = {
      startedAt: performance.now(),
      listeners: new Map(),
      timers: new Map(),
      timeouts: 0,
      intervals: 0,
      intervalFires: 0,
      timeoutFires: 0,
      webSocketMessages: [],
      webSocketCounts: new Map(),
      webSocketBytesByEvent: new Map(),
      mutations: [],
      mutationTargets: new Map(),
      frames: [],
      longTasks: [],
      consoleErrors: [],
    };

    function localPercentile(values, p) {
      if (!values.length) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    }

    function targetName(target) {
      if (target === window) return 'window';
      if (target === document) return 'document';
      if (target?.nodeType === Node.ELEMENT_NODE) {
        const tag = target.tagName?.toLowerCase() || 'element';
        const id = target.id ? `#${target.id}` : '';
        const classes = String(target.className || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
        return `${tag}${id}${classes ? `.${classes}` : ''}`;
      }
      return target?.constructor?.name || String(target);
    }

    function listenerKey(target, type, kind) {
      return `${kind}:${targetName(target)}:${String(type)}`;
    }

    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function add(type, listener, options) {
      const key = listenerKey(this, type, 'add');
      data.listeners.set(key, (data.listeners.get(key) || 0) + 1);
      return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function remove(type, listener, options) {
      const key = listenerKey(this, type, 'remove');
      data.listeners.set(key, (data.listeners.get(key) || 0) + 1);
      return originalRemove.call(this, type, listener, options);
    };

    const originalSetInterval = window.setInterval;
    const originalSetTimeout = window.setTimeout;
    window.setInterval = function patchedSetInterval(fn, delay, ...args) {
      data.intervals += 1;
      const key = `interval:${delay}`;
      data.timers.set(key, (data.timers.get(key) || 0) + 1);
      return originalSetInterval.call(this, (...innerArgs) => {
        data.intervalFires += 1;
        return typeof fn === 'function' ? fn(...innerArgs) : eval(fn);
      }, delay, ...args);
    };
    window.setTimeout = function patchedSetTimeout(fn, delay, ...args) {
      data.timeouts += 1;
      const key = `timeout:${delay}`;
      data.timers.set(key, (data.timers.get(key) || 0) + 1);
      return originalSetTimeout.call(this, (...innerArgs) => {
        data.timeoutFires += 1;
        return typeof fn === 'function' ? fn(...innerArgs) : eval(fn);
      }, delay, ...args);
    };

    const OriginalWebSocket = window.WebSocket;
    if (OriginalWebSocket) {
      window.WebSocket = function PatchedWebSocket(...args) {
        const ws = new OriginalWebSocket(...args);
        ws.addEventListener('message', (event) => {
          const raw = event.data;
          const text = typeof raw === 'string' ? raw : '';
          const match = text.slice(0, 120).match(/\["([^"\]]+)/);
          const eventName = match?.[1] || text.slice(0, 12);
          data.webSocketCounts.set(eventName, (data.webSocketCounts.get(eventName) || 0) + 1);
          data.webSocketBytesByEvent.set(
            eventName,
            (data.webSocketBytesByEvent.get(eventName) || 0) + (typeof raw === 'string' ? raw.length : raw?.byteLength || raw?.size || 0),
          );
          data.webSocketMessages.push({
            at: Math.round(performance.now()),
            size: typeof raw === 'string' ? raw.length : raw?.byteLength || raw?.size || 0,
            prefix: text.slice(0, 80),
          });
          if (data.webSocketMessages.length > 1000) data.webSocketMessages.shift();
        });
        return ws;
      };
      window.WebSocket.prototype = OriginalWebSocket.prototype;
      Object.assign(window.WebSocket, OriginalWebSocket);
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          data.longTasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {}

    let lastFrame = performance.now();
    requestAnimationFrame(function frame(now) {
      data.frames.push(now - lastFrame);
      lastFrame = now;
      requestAnimationFrame(frame);
    });

    new MutationObserver((records) => {
      let added = 0;
      let removed = 0;
      let attrs = 0;
      let text = 0;
      for (const record of records) {
        added += record.addedNodes?.length || 0;
        removed += record.removedNodes?.length || 0;
        if (record.type === 'attributes') attrs += 1;
        if (record.type === 'characterData') text += 1;
        if (record.type === 'attributes' || record.type === 'characterData') {
          const key = `${targetName(record.target)}:${record.type}:${record.attributeName || ''}`;
          data.mutationTargets.set(key, (data.mutationTargets.get(key) || 0) + 1);
        }
      }
      data.mutations.push({ at: Math.round(performance.now()), records: records.length, added, removed, attrs, text });
      if (data.mutations.length > 1000) data.mutations.shift();
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });

    const originalConsoleError = console.error;
    console.error = (...args) => {
      data.consoleErrors.push(args.map((arg) => String(arg)).join(' ').slice(0, 500));
      return originalConsoleError.apply(console, args);
    };

    window.__rootAudit = {
      snapshot() {
        const frames = data.frames.slice(5);
        const messages = data.webSocketMessages;
        const socketBuckets = new Map(
          [...data.webSocketCounts.entries()].map(([event, count]) => [
            event,
            { event, count, bytes: data.webSocketBytesByEvent.get(event) || 0 },
          ]),
        );
        return {
          elapsedMs: performance.now() - data.startedAt,
          listeners: [...data.listeners.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 40),
          timers: [...data.timers.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 40),
          timeouts: data.timeouts,
          intervals: data.intervals,
          timeoutFires: data.timeoutFires,
          intervalFires: data.intervalFires,
          webSocketMessageCount: messages.length,
          webSocketBytes: messages.reduce((sum, message) => sum + message.size, 0),
          webSocketEvents: [...socketBuckets.values()].sort((a, b) => b.count - a.count),
          mutationsTotal: data.mutations.reduce((acc, row) => ({
            records: acc.records + row.records,
            added: acc.added + row.added,
            removed: acc.removed + row.removed,
            attrs: acc.attrs + row.attrs,
            text: acc.text + row.text,
          }), { records: 0, added: 0, removed: 0, attrs: 0, text: 0 }),
          mutationTargets: [...data.mutationTargets.entries()]
            .map(([key, count]) => ({ key, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 50),
          mutationBursts: [...data.mutations].sort((a, b) => b.records - a.records).slice(0, 20),
          frames: {
            count: frames.length,
            average: frames.reduce((sum, value) => sum + value, 0) / frames.length,
            p95: localPercentile(frames, 0.95),
            p99: localPercentile(frames, 0.99),
          },
          longTasks: {
            count: data.longTasks.length,
            top: [...data.longTasks].sort((a, b) => b.duration - a.duration).slice(0, 20),
          },
          consoleErrors: data.consoleErrors,
        };
      },
    };
  });

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (cpuThrottle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('load', { timeout: 90000 }).catch(() => {});
  await sleep(sampleMs);
  const metrics = await cdp.send('Performance.getMetrics');
  const snapshot = await page.evaluate(() => window.__rootAudit.snapshot());
  const report = {
    url,
    runDir,
    environment: { cpuThrottle, viewport: { width: viewport[0] || 390, height: viewport[1] || 844 }, isMobile, sampleMs },
    metrics: Object.fromEntries(metrics.metrics.map((metric) => [metric.name, metric.value])),
    snapshot,
  };
  await page.screenshot({ path: path.join(runDir, 'root-runtime.png'), fullPage: true });
  await fs.writeFile(path.join(runDir, 'root-runtime-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
