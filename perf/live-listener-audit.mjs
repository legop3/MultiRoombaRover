import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://rover.otter.land';
const outDir = process.argv[3] || path.resolve('perf/results');
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-listeners`;
const runDir = path.join(outDir, runId);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  await fs.mkdir(runDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    ignoreHTTPSErrors: true,
  });

  await context.addInitScript(() => {
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const listenerIds = new WeakMap();
    let nextListenerId = 1;
    const rows = new Map();

    function listenerId(listener) {
      if ((typeof listener !== 'function' && typeof listener !== 'object') || listener === null) {
        return String(listener);
      }
      let id = listenerIds.get(listener);
      if (!id) {
        id = nextListenerId++;
        listenerIds.set(listener, id);
      }
      return id;
    }

    function targetName(target) {
      if (target === window) return 'window';
      if (target === document) return 'document';
      if (target?.nodeType === Node.DOCUMENT_NODE) return 'document';
      if (target?.nodeType === Node.ELEMENT_NODE) {
        const tag = target.tagName?.toLowerCase() || 'element';
        const id = target.id ? `#${target.id}` : '';
        const className = String(target.className || '').trim().split(/\s+/).slice(0, 3).join('.');
        return `${tag}${id}${className ? `.${className}` : ''}`;
      }
      if (target?.constructor?.name) return target.constructor.name;
      return String(target);
    }

    function shortStack() {
      return String(new Error().stack || '')
        .split('\n')
        .slice(3, 9)
        .map((line) => line.trim().replace(location.origin, ''))
        .join('\n');
    }

    function note(kind, target, type, listener) {
      const stack = shortStack();
      const key = `${targetName(target)}::${type}::${stack}`;
      const row = rows.get(key) || {
        target: targetName(target),
        type: String(type),
        stack,
        adds: 0,
        removes: 0,
        activeApprox: 0,
        firstSeen: performance.now(),
        lastSeen: 0,
      };
      row[kind] += 1;
      row.activeApprox += kind === 'adds' ? 1 : -1;
      row.lastSeen = performance.now();
      row.exampleListener = String(listener).slice(0, 180);
      rows.set(key, row);
    }

    EventTarget.prototype.addEventListener = function patchedAdd(type, listener, options) {
      note('adds', this, type, listener);
      return originalAdd.call(this, type, listener, options);
    };

    EventTarget.prototype.removeEventListener = function patchedRemove(type, listener, options) {
      note('removes', this, type, listener);
      return originalRemove.call(this, type, listener, options);
    };

    window.__listenerAudit = {
      snapshot() {
        return [...rows.values()]
          .sort((a, b) => Math.abs(b.activeApprox) - Math.abs(a.activeApprox) || b.adds - a.adds)
          .slice(0, 100);
      },
    };
  });

  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('load', { timeout: 60000 }).catch(() => {});
  await sleep(10000);
  const first = await page.evaluate(() => window.__listenerAudit.snapshot());
  await page.mouse.wheel(0, 1500);
  await sleep(1000);
  await page.mouse.wheel(0, -900);
  await sleep(20000);
  const second = await page.evaluate(() => window.__listenerAudit.snapshot());

  const report = { url, finalUrl: page.url(), first, second };
  await fs.writeFile(path.join(runDir, 'listener-report.json'), JSON.stringify(report, null, 2));
  await page.screenshot({ path: path.join(runDir, 'listener-audit.png'), fullPage: true });
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
