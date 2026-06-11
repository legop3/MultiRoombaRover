import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://rover.otter.land';
const outDir = process.argv[3] || path.resolve('perf/results');
const cpuThrottle = Number(process.env.CPU_THROTTLE || 1);
const viewport = (process.env.VIEWPORT || '1440x950').split('x').map((part) => Number(part));
const isMobile = process.env.MOBILE === '1';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(outDir, runId);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function summarizeCpuProfile(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const totals = new Map();
  const samples = profile.samples || [];
  const deltas = profile.timeDeltas || [];
  let totalUs = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const delta = deltas[i] || 0;
    totalUs += delta;
    const node = nodes.get(samples[i]);
    if (!node) continue;
    const frame = node.callFrame || {};
    const key = `${frame.url || '(anonymous)'}::${frame.functionName || '(anonymous)'}`;
    const prev = totals.get(key) || {
      url: frame.url || '',
      functionName: frame.functionName || '(anonymous)',
      lineNumber: frame.lineNumber,
      columnNumber: frame.columnNumber,
      selfMs: 0,
      samples: 0,
    };
    prev.selfMs += delta / 1000;
    prev.samples += 1;
    totals.set(key, prev);
  }

  return {
    totalProfileMs: totalUs / 1000,
    sampleCount: samples.length,
    topSelfTime: [...totals.values()]
      .sort((a, b) => b.selfMs - a.selfMs)
      .slice(0, 30),
  };
}

function interestingMetrics(metrics) {
  const wanted = [
    'Timestamp',
    'Documents',
    'Frames',
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

async function performInteractions(page) {
  await page.mouse.wheel(0, 1400);
  await sleep(800);
  await page.mouse.wheel(0, -900);
  await sleep(800);
  await page.keyboard.press('Tab');
  await sleep(300);
  await page.keyboard.press('Tab');
  await sleep(300);

  const buttons = await page.locator('button:visible').elementHandles();
  for (const button of buttons.slice(0, 3)) {
    const box = await button.boundingBox();
    if (!box || box.width < 8 || box.height < 8) continue;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(150);
  }
}

async function run() {
  await fs.mkdir(runDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: viewport[0] || 1440, height: viewport[1] || 950 },
    deviceScaleFactor: 1,
    isMobile,
    hasTouch: isMobile,
    ignoreHTTPSErrors: true,
  });

  await context.addInitScript(() => {
    window.__perfProbe = {
      longTasks: [],
      frames: [],
      intervalDrifts: [],
    };

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__perfProbe.longTasks.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {}

    let lastFrame = performance.now();
    const frameLoop = (now) => {
      window.__perfProbe.frames.push(now - lastFrame);
      lastFrame = now;
      requestAnimationFrame(frameLoop);
    };
    requestAnimationFrame(frameLoop);

    let lastTick = performance.now();
    setInterval(() => {
      const now = performance.now();
      window.__perfProbe.intervalDrifts.push(now - lastTick - 250);
      lastTick = now;
    }, 250);
  });

  const page = await context.newPage();
  const consoleMessages = [];
  const failedRequests = [];
  const responses = [];

  page.on('console', (message) => {
    consoleMessages.push({
      type: message.type(),
      text: message.text().slice(0, 1000),
      location: message.location(),
    });
  });
  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText,
    });
  });
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) responses.push({ url: response.url(), status });
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  if (cpuThrottle > 1) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
  }

  const start = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('load', { timeout: 60000 }).catch(() => {});
  await sleep(5000);
  const afterLoadMetrics = interestingMetrics(await cdp.send('Performance.getMetrics'));
  await page.screenshot({ path: path.join(runDir, 'loaded.png'), fullPage: true });

  await cdp.send('Profiler.start');
  await sleep(15000);
  await performInteractions(page);
  await sleep(15000);
  const { profile } = await cdp.send('Profiler.stop');
  const endMetrics = interestingMetrics(await cdp.send('Performance.getMetrics'));

  const perfProbe = await page.evaluate(() => window.__perfProbe);
  await page.screenshot({ path: path.join(runDir, 'after-profile.png'), fullPage: true });

  const cpuSummary = summarizeCpuProfile(profile);
  const frameDeltas = perfProbe.frames.slice(5);
  const longTasks = perfProbe.longTasks.sort((a, b) => b.duration - a.duration);
  const intervalDrifts = perfProbe.intervalDrifts;
  const percentile = (values, p) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  };

  const report = {
    url,
    runDir,
    elapsedMs: Date.now() - start,
    userAgent: await page.evaluate(() => navigator.userAgent),
    title: await page.title(),
    finalUrl: page.url(),
    environment: {
      cpuThrottle,
      viewport: { width: viewport[0] || 1440, height: viewport[1] || 950 },
      isMobile,
    },
    metrics: {
      afterLoad: afterLoadMetrics,
      end: endMetrics,
      delta: Object.fromEntries(
        Object.keys(endMetrics).map((key) => [key, endMetrics[key] - (afterLoadMetrics[key] || 0)]),
      ),
    },
    cpuSummary,
    responsiveness: {
      longTaskCount: longTasks.length,
      topLongTasks: longTasks.slice(0, 20),
      frameCount: frameDeltas.length,
      averageFrameMs: frameDeltas.reduce((sum, value) => sum + value, 0) / frameDeltas.length,
      p95FrameMs: percentile(frameDeltas, 0.95),
      p99FrameMs: percentile(frameDeltas, 0.99),
      intervalDriftCount: intervalDrifts.length,
      averageIntervalDriftMs:
        intervalDrifts.reduce((sum, value) => sum + value, 0) / intervalDrifts.length,
      p95IntervalDriftMs: percentile(intervalDrifts, 0.95),
      p99IntervalDriftMs: percentile(intervalDrifts, 0.99),
    },
    consoleMessages,
    failedRequests,
    errorResponses: responses,
  };

  await fs.writeFile(path.join(runDir, 'cpu-profile.cpuprofile'), JSON.stringify(profile));
  await fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
