const path = require('path');
const fsp = require('fs/promises');
const sharp = require('sharp');

const { getMode } = require('./modeManager');
const roverManager = require('./roverManager');
const { getActiveDrivers, getTurnQueues } = require('./turnService');
const { getRoomCameras } = require('./roomCameraService');
const { getRoomCameraState } = require('./roomCameraSnapshotService');
const { loadConfig } = require('../helpers/configLoader');

const INDEX_HTML_PATH = path.join(__dirname, '..', '..', 'public', 'index.html');
const BITMAP_PATH = path.join(__dirname, '..', '..', 'public', 'bitmap.png');

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const BASE_BG = { r: 8, g: 12, b: 22 };

let cachedIndexHtml = null;
let cachedIndexMtimeMs = 0;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value) {
  return escapeHtml(value);
}

async function loadIndexHtml() {
  const stat = await fsp.stat(INDEX_HTML_PATH);
  if (!cachedIndexHtml || stat.mtimeMs !== cachedIndexMtimeMs) {
    cachedIndexHtml = await fsp.readFile(INDEX_HTML_PATH, 'utf8');
    cachedIndexMtimeMs = stat.mtimeMs;
  }
  return cachedIndexHtml;
}

function getBaseUrl(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'];
  const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol || 'http';
  const host = forwardedHost || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

function getPrimaryRoomCamera() {
  const cameras = getRoomCameras();
  if (!cameras.length) return null;
  return cameras[0];
}

function sumQueueCounts(turnQueues = {}) {
  return Object.values(turnQueues).reduce((sum, entry) => {
    const size = Array.isArray(entry?.queue) ? entry.queue.length : 0;
    return sum + size;
  }, 0);
}

function buildEmbedCopy(state, camera) {
  const roversOnline = state?.rovers?.length || 0;
  const driverCount = Object.keys(state?.activeDrivers || {}).length;
  const mode = state?.mode || 'open';
  const modeLabel = {
    open: 'open drive',
    turns: 'turns mode',
    admin: 'admin mode',
    lockdown: 'locked',
  }[mode] || mode;

  let title = 'Multi Roomba Rover';
  if (mode === 'lockdown') {
    title = 'Private mode is on';
  } else if (roversOnline === 0) {
    title = 'Rovers offline - check back soon';
  } else if (driverCount > 0) {
    title = 'Rover action live - take the controls';
  } else if (mode === 'turns') {
    title = 'Controls open - jump in';
  } else {
    title = 'Controls open - drive a rover';
  }

  const descriptionParts = [];
  descriptionParts.push(`${roversOnline} rover${roversOnline === 1 ? '' : 's'} online`);
  if (driverCount > 0) {
    descriptionParts.push(`${driverCount} driving`);
  } else {
    descriptionParts.push('no active drivers');
  }
  if (mode === 'lockdown') {
    descriptionParts.push('privacy mode');
  } else {
    descriptionParts.push(modeLabel);
  }
  const description = descriptionParts.join(' | ');

  const statsParts = [
    `${roversOnline} online`,
    driverCount > 0 ? `${driverCount} driving` : 'no drivers',
  ];
  if (mode === 'lockdown') {
    statsParts.push('privacy mode');
  } else {
    statsParts.push(modeLabel);
  }

  const cameraLabel = camera?.name || camera?.id || 'room cam';
  return {
    title,
    description,
    subtitle: 'Control a live rover from your browser',
    stats: statsParts.join(' | '),
    cameraLabel: mode === 'lockdown' ? 'Room cams hidden' : `Room cam: ${cameraLabel}`,
  };
}

function buildMetaTags({ title, description, imageUrl, pageUrl }) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeImage = escapeHtml(imageUrl);
  const safeUrl = escapeHtml(pageUrl);
  return [
    '<!-- embed meta -->',
    `<meta name="description" content="${safeDescription}" />`,
    `<meta property="og:title" content="${safeTitle}" />`,
    `<meta property="og:description" content="${safeDescription}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:url" content="${safeUrl}" />`,
    `<meta property="og:image" content="${safeImage}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    `<meta property="og:site_name" content="${safeTitle}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${safeTitle}" />`,
    `<meta name="twitter:description" content="${safeDescription}" />`,
    `<meta name="twitter:image" content="${safeImage}" />`,
    '<!-- /embed meta -->',
  ].join('\n    ');
}

async function renderIndexHtml(req) {
  const baseUrl = getBaseUrl(req);
  const state = {
    mode: getMode(),
    rovers: roverManager.getRoster(),
    activeDrivers: getActiveDrivers(),
    turnQueues: getTurnQueues(),
  };
  const config = loadConfig();
  const pageTitle = config?.site?.title || 'Roomba Rover';
  const camera = getPrimaryRoomCamera();
  const copy = buildEmbedCopy(state, camera);
  const cacheBust = Math.floor(Date.now() / (5 * 60 * 1000));
  const imageUrl = `${baseUrl}/og/preview.png?t=${cacheBust}`;
  const pageUrl = `${baseUrl}${req.originalUrl || '/'}`;

  const metaBlock = buildMetaTags({
    title: pageTitle,
    description: copy.description,
    imageUrl,
    pageUrl,
  });

  let html = await loadIndexHtml();
  html = html.replace(/<title>.*?<\/title>/i, `<title>${escapeHtml(pageTitle)}</title>`);
  if (html.includes('<!-- embed meta -->')) {
    html = html.replace(/<!-- embed meta -->[\s\S]*?<!-- \/embed meta -->/i, metaBlock);
  } else {
    html = html.replace('</head>', `    ${metaBlock}\n  </head>`);
  }
  return html;
}

function buildOverlaySvg({ title, subtitle, stats, cameraLabel, hasFrame }) {
  const titleSize = 64;
  const subtitleSize = 34;
  const statsSize = 30;
  const labelSize = 26;
  const badgeText = hasFrame ? 'Room cam live' : 'Room cam';
  return `
<svg width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,0)" />
      <stop offset="50%" stop-color="rgba(0,0,0,0.35)" />
      <stop offset="100%" stop-color="rgba(0,0,0,0.85)" />
    </linearGradient>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#fade)" />
  <rect x="56" y="48" width="210" height="40" rx="20" fill="rgba(0,0,0,0.55)" />
  <rect x="58" y="50" width="206" height="36" rx="18" fill="#22d3ee" />
  <text x="160" y="75" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="700" text-anchor="middle" fill="#001018">
    ${escapeXml(badgeText)}
  </text>
  <text x="64" y="410" font-family="DejaVu Sans, Arial, sans-serif" font-size="${titleSize}" font-weight="700" fill="#ffffff">
    ${escapeXml(title)}
  </text>
  <text x="64" y="455" font-family="DejaVu Sans, Arial, sans-serif" font-size="${subtitleSize}" font-weight="500" fill="#d6e4ff">
    ${escapeXml(subtitle)}
  </text>
  <text x="64" y="505" font-family="DejaVu Sans, Arial, sans-serif" font-size="${statsSize}" font-weight="600" fill="#7ef9b2">
    ${escapeXml(stats)}
  </text>
  <text x="64" y="552" font-family="DejaVu Sans, Arial, sans-serif" font-size="${labelSize}" font-weight="500" fill="#a7b6d8">
    ${escapeXml(cameraLabel)}
  </text>
</svg>`;
}

async function renderOgImage() {
  const state = {
    mode: getMode(),
    rovers: roverManager.getRoster(),
    activeDrivers: getActiveDrivers(),
    turnQueues: getTurnQueues(),
  };
  const camera = getPrimaryRoomCamera();
  const copy = buildEmbedCopy(state, camera);
  const cameraState = state.mode === 'lockdown' || !camera ? null : getRoomCameraState(camera.id);
  const frame = cameraState?.frame || null;
  const hasFrame = Boolean(frame);

  const base = frame
    ? sharp(frame).resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover' })
    : sharp({
        create: {
          width: OG_WIDTH,
          height: OG_HEIGHT,
          channels: 3,
          background: BASE_BG,
        },
      });

  const overlaySvg = Buffer.from(
    buildOverlaySvg({
      title: copy.title,
      subtitle: copy.subtitle,
      stats: copy.stats,
      cameraLabel: copy.cameraLabel,
      hasFrame,
    }),
  );

  const composite = [{ input: overlaySvg, top: 0, left: 0 }];
  try {
    const logo = await fsp.readFile(BITMAP_PATH);
    const logoPng = await sharp(logo).resize(88, 88).png().toBuffer();
    composite.push({ input: logoPng, top: 42, left: OG_WIDTH - 130 });
  } catch (err) {
    // Optional logo; ignore if missing.
  }

  return base.composite(composite).png().toBuffer();
}

module.exports = {
  renderIndexHtml,
  renderOgImage,
};
