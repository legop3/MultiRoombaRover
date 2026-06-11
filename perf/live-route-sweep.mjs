import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || 'https://rover.otter.land';
const outDir = process.argv[3] || path.resolve('perf/results');
const cpuThrottle = Number(process.env.CPU_THROTTLE || 6);
const viewport = (process.env.VIEWPORT || '390x844').split('x').map((part) => Number(part));
const isMobile = process.env.MOBILE !== '0';
const sampleMs = Number(process.env.SAMPLE_MS || 22000);
const routes = (process.env.ROUTES || '/,/spectate,/mini,/display,/scanner')
  .split(',')
  .map((route) => route.trim())
  .filter(Boolean);
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-route-sweep`;
const runDir = path.join(outDir, runId);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function interestingMetrics(metrics) {
  const wanted = [
    'Documents',
    'JSEventListeners',
    'Nodes',
    'LayoutCount',
    'RecalcStyleCount',
    'LayoutDuration',
    'RecalcStyleDuration',
    'ScriptDuration',
    'TaskDuration',
    'JSHeapUsedSize',
    'JSHeapTotalSize',
  ];
  return Object.fromEntries(
    metrics.metrics
      .filter((metric) => wanted.includes(metric.name))
      .map((metric) => [metric.name, metric.value]),
  );
}

function summarizeCpuProfile(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const totals = new Map();
  let totalUs = 0;
  for (let i = 0; i < (profile.samples || []).length; i += 1) {
    const delta = profile.timeDeltas?.[i] || 0;
    totalUs += delta;
    const frame = nodes.get(profile.samples[i])?.callFrame || {};
    const key = `${frame.url || '(browser)'}::${frame.functionName || '(anonymous)'}:${frame.lineNumber}:${frame.columnNumber}`;
    const row = totals.get(key) || {
      url: frame.url || '',
      functionName: frame.functionName || '(anonymous)',
      lineNumber: frame.lineNumber,
      columnNumber: frame.columnNumber,
      selfMs: 0,
      samples: 0,
    };
    row.selfMs += delta / 1000;
    row.samples += 1;
    totals.set(key, row);
  }
  return {
    totalProfileMs: totalUs / 1000,
    topSelfTime: [...totals.values()].sort((a, b) => b.selfMs - a.selfMs).slice(0, 15),
  };
}

async function installProbe(context) {
  await context.addInitScript(() => {
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const listenerRows = new Map();

    function targetName(target) {
      if (target === window) return 'window';
      if (target === document) return 'document';
      if (target?.nodeType === Node.ELEMENT_NODE) {
        const tag = target.tagName?.toLowerCase() || 'element';
        return target.id ? `${tag}#${target.id}` : tag;
      }
      return target?.constructor?.name || String(target);
    }

    function stack() {
      return String(new Error().stack || '')
        .split('\n')
        .slice(3, 7)
        .map((line) => line.trim().replace(location.origin, ''))
        .join('\n');
    }

    function note(kind, target, type) {
      const key = `${targetName(target)}::${type}::${stack()}`;
      const row = listenerRows.get(key) || {
        target: targetName(target),
        type: String(type),
        stack: stack(),
        adds: 0,
        removes: 0,
      };
      row[kind] += 1;
      listenerRows.set(key, row);
    }

    EventTarget.prototype.addEventListener = function patchedAdd(type, listener, options) {
      note('adds', this, type);
      return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function patchedRemove(type, listener, options) {
      note('removes', this, type);
      return originalRemove.call(this, type, listener, options);
    };

    window.__sweepProbe = {
      longTasks: [],
      frames: [],
      intervalDrifts: [],
      listenerSnapshot() {
        return [...listenerRows.values()]
          .map((row) => ({ ...row, churn: row.adds + row.removes }))
          .sort((a, b) => b.churn - a.churn)
          .slice(0, 20);
      },
    };

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__sweepProbe.longTasks.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {}

    let lastFrame = performance.now();
    const frameLoop = (now) => {
      window.__sweepProbe.frames.push(now - lastFrame);
      lastFrame = now;
      requestAnimationFrame(frameLoop);
    };
    requestAnimationFrame(frameLoop);

    let lastTick = performance.now();
    setInterval(() => {
      const now = performance.now();
      window.__sweepProbe.intervalDrifts.push(now - lastTick - 250);
      lastTick = now;
    }, 250);
  });
}

async function runRoute(browser, route) {
  const context = await browser.newContext({
    viewport: { width: viewport[0] || 390, height: viewport[1] || 844 },
    deviceScaleFactor: isMobile ? 3 : 1,
    isMobile,
    hasTouch: isMobile,
    ignoreHTTPSErrors: true,
  });
  await installProbe(context);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  if (cpuThrottle > 1) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
  }

  const consoleErrors = [];
  const errorResponses = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      consoleErrors.push({ type: message.type(), text: message.text().slice(0, 500) });
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      errorResponses.push({ url: response.url(), status: response.status() });
    }
  });

  const url = new URL(route, baseUrl).toString();
  const startWall = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('load', { timeout: 90000 }).catch(() => {});
  await sleep(4000);
  const startMetrics = interestingMetrics(await cdp.send('Performance.getMetrics'));
  await cdp.send('Profiler.start');
  await sleep(sampleMs / 2);
  await page.mouse.wheel(0, 900).catch(() => {});
  await sleep(sampleMs / 2);
  const { profile } = await cdp.send('Profiler.stop');
  const endMetrics = interestingMetrics(await cdp.send('Performance.getMetrics'));
  const probe = await page.evaluate(() => ({
    longTasks: window.__sweepProbe.longTasks,
    frames: window.__sweepProbe.frames.slice(5),
    intervalDrifts: window.__sweepProbe.intervalDrifts,
    listeners: window.__sweepProbe.listenerSnapshot(),
  }));
  const screenshotName = route === '/' ? 'root' : route.replace(/^\//, '').replace(/\W+/g, '-');
  await page.screenshot({ path: path.join(runDir, `${screenshotName || 'root'}.png`), fullPage: true });
  await context.close();

  const delta = Object.fromEntries(
    Object.keys(endMetrics).map((key) => [key, endMetrics[key] - (startMetrics[key] || 0)]),
  );
  const frames = probe.frames;
  const longTasks = probe.longTasks.sort((a, b) => b.duration - a.duration);
  return {
    route,
    finalUrl: page.url(),
    elapsedMs: Date.now() - startWall,
    metrics: { start: startMetrics, end: endMetrics, delta },
    cpu: summarizeCpuProfile(profile),
    responsiveness: {
      longTaskCount: longTasks.length,
      worstLongTaskMs: longTasks[0]?.duration || 0,
      topLongTasks: longTasks.slice(0, 8),
      frameCount: frames.length,
      averageFrameMs: frames.reduce((sum, value) => sum + value, 0) / frames.length,
      p95FrameMs: percentile(frames, 0.95),
      p99FrameMs: percentile(frames, 0.99),
      intervalDriftP95Ms: percentile(probe.intervalDrifts, 0.95),
      intervalDriftP99Ms: percentile(probe.intervalDrifts, 0.99),
    },
    listenerChurn: probe.listeners,
    consoleErrors,
    errorResponses,
  };
}

async function main() {
  await fs.mkdir(runDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const results = [];
  for (const route of routes) {
    console.error(`profiling ${route} at ${cpuThrottle}x`);
    results.push(await runRoute(browser, route));
  }
  await browser.close();

  const report = {
    baseUrl,
    runDir,
    environment: {
      cpuThrottle,
      viewport: { width: viewport[0] || 390, height: viewport[1] || 844 },
      isMobile,
      sampleMs,
      routes,
    },
    results,
    rankedByAverageFrame: [...results].sort(
      (a, b) => b.responsiveness.averageFrameMs - a.responsiveness.averageFrameMs,
    ),
    rankedByTaskDuration: [...results].sort(
      (a, b) => b.metrics.delta.TaskDuration - a.metrics.delta.TaskDuration,
    ),
    rankedByListenerChurn: [...results].sort((a, b) => {
      const churnA = a.listenerChurn.reduce((sum, row) => sum + row.churn, 0);
      const churnB = b.listenerChurn.reduce((sum, row) => sum + row.churn, 0);
      return churnB - churnA;
    }),
  };
  await fs.writeFile(path.join(runDir, 'route-sweep-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
