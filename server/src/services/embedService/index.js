// embed Service
// Purpose: Defines the embed Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const sharp = require('sharp');

const logger = require('../../globals/logger').child('embedService');
const { getMode } = require('../modeManager');
const roverManager = require('../roverManager');
const { getActiveDrivers, getTurnQueues } = require('../turnService');
const { getRoomCameras } = require('../roomCameraService');
const { getRoomCameraState } = require('../roomCameraService');
const { resolveDataPath } = require('../../helpers/dataPaths');
const { resolveSiteMetadata } = require('../../helpers/siteMetadata');

const INDEX_HTML_PATH = path.join(__dirname, '..', '..', '..', 'public', 'index.html');
const BITMAP_PATH = path.join(__dirname, '..', '..', '..', 'public', 'bitmap.png');
const ANALYTICS_HTML_PATH = resolveDataPath('analytics.html');
const ANALYTICS_PLACEHOLDER = '<!-- analytics:inject -->';
const SITE_METADATA_PLACEHOLDER = '<!-- site-metadata:inject -->';

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

let cachedIndexHtml = null;
let cachedIndexMtimeMs = 0;

/*
  Analytics provider markup belongs to the server operator, not to the shared
  web build. Loading the snippet once at process startup makes deployment
  behavior predictable: replacing analytics.html takes effect on the next
  normal server restart, and no analytics configuration needs to travel over
  Socket.IO or be exposed through a JSON endpoint.

  This file is intentionally trusted as raw HTML. Anyone able to write files in
  the server data directory already controls the deployment, and allowing a
  complete head snippet is what keeps this integration compatible with Umami,
  Plausible, Matomo, or a custom provider without provider-specific server code.
*/
function loadAnalyticsHeadHtml() {
  if (!fs.existsSync(ANALYTICS_HTML_PATH)) return '';

  try {
    return fs.readFileSync(ANALYTICS_HTML_PATH, 'utf8').trim();
  } catch (err) {
    /*
      Analytics is observability-only, so a permissions or read error must not
      prevent operators and drivers from loading the rover controls.
    */
    logger.warn('Unable to read analytics head HTML; continuing without analytics', err.message);
    return '';
  }
}

const analyticsHeadHtml = loadAnalyticsHeadHtml();

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

function getPagePath(req) {
  /*
    Canonical URLs should describe the page rather than a tracking/query
    variant of it. Express's path value excludes the query string and is safe
    to combine with either the configured public URL or the current request.
  */
  return req.path || '/';
}

function joinPublicUrl(baseUrl, pagePath) {
  const normalizedPath = pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
  return `${baseUrl}${normalizedPath}`;
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

function getPublicRovers() {
  return roverManager
    .getRoster()
    .filter((rover) => roverManager.canReplayRoverId(rover.id));
}

function buildEmbedCopy(state, camera) {
  const roversOnline = state?.rovers?.length || 0;
  const visibleRoverIds = new Set((state?.rovers || []).map((rover) => String(rover.id)));
  const driverCount = Object.entries(state?.activeDrivers || {}).reduce((count, [roverId, socketId]) => {
    if (!socketId) return count;
    return visibleRoverIds.has(String(roverId)) ? count + 1 : count;
  }, 0);
  const mode = state?.mode || 'open';
  const modeLabel = {
    open: 'open drive',
    turns: 'turns mode',
    admin: 'admin mode',
    lockdown: 'locked',
  }[mode] || mode;

  let title = 'Roomba Rover';
  if (mode === 'lockdown') {
    title = 'Private mode is on';
  } else if (roversOnline === 0) {
    title = 'Rovers offline - check back soon';
  } else if (driverCount > 0) {
    title = 'Rovers in use - drive a rover';
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

function buildMetaTags({ title, description, imageUrl, pageUrl, canonicalUrl }) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeImage = escapeHtml(imageUrl);
  const safeUrl = escapeHtml(pageUrl);
  const tags = [
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
  ];

  /*
    Only advertise a canonical address when the operator supplied a valid
    public URL. Guessing from request headers would permanently identify a LAN
    hostname or reverse-proxy hop as the public home of the instance.
  */
  if (canonicalUrl) {
    tags.push(`<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`);
  }
  tags.push('<!-- /embed meta -->');
  return tags.join('\n    ');
}

function buildSiteMetadataTags(siteMetadata) {
  return [
    '<!-- site metadata -->',
    `<meta name="theme-color" content="${escapeHtml(siteMetadata.accentColor)}" />`,
    `<meta name="apple-mobile-web-app-title" content="${escapeHtml(siteMetadata.shortName)}" />`,
    `<title>${escapeHtml(siteMetadata.name)}</title>`,
    '<!-- /site metadata -->',
  ].join('\n    ');
}

async function renderIndexHtml(req) {
  const baseUrl = getBaseUrl(req);
  const state = {
    mode: getMode(),
    rovers: getPublicRovers(),
    activeDrivers: getActiveDrivers(),
    turnQueues: getTurnQueues(),
  };
  const siteMetadata = resolveSiteMetadata();
  const camera = getPrimaryRoomCamera();
  const copy = buildEmbedCopy(state, camera);
  const cacheBust = Math.floor(Date.now() / (5 * 60 * 1000));
  const imageUrl = `${baseUrl}/og/preview.png?t=${cacheBust}`;
  const pagePath = getPagePath(req);
  const canonicalUrl = siteMetadata.publicUrl
    ? joinPublicUrl(siteMetadata.publicUrl, pagePath)
    : null;
  const pageUrl = canonicalUrl || joinPublicUrl(baseUrl, pagePath);

  const metaBlock = buildMetaTags({
    title: siteMetadata.name,
    description: siteMetadata.description,
    imageUrl,
    pageUrl,
    canonicalUrl,
  });
  const siteMetadataBlock = buildSiteMetadataTags(siteMetadata);

  let html = await loadIndexHtml();
  /*
    Prefer the explicit marker so the insertion point remains stable across
    Vite output changes. The closing-head fallback also keeps deployed builds
    made before the marker was introduced compatible with the runtime loader.
  */
  if (html.includes(ANALYTICS_PLACEHOLDER)) {
    html = html.replace(ANALYTICS_PLACEHOLDER, analyticsHeadHtml);
  } else if (analyticsHeadHtml) {
    html = html.replace('</head>', `    ${analyticsHeadHtml}\n  </head>`);
  }
  /*
    Keeping all instance-specific head values behind one marker prevents the
    built index from carrying a second set of hardcoded titles and colors.
    The fallback supports an older built index during a rolling deployment.
  */
  if (html.includes(SITE_METADATA_PLACEHOLDER)) {
    html = html.replace(SITE_METADATA_PLACEHOLDER, siteMetadataBlock);
  } else {
    html = html.replace('</head>', `    ${siteMetadataBlock}\n  </head>`);
  }
  if (html.includes('<!-- embed meta -->')) {
    html = html.replace(/<!-- embed meta -->[\s\S]*?<!-- \/embed meta -->/i, metaBlock);
  } else {
    html = html.replace('</head>', `    ${metaBlock}\n  </head>`);
  }
  return html;
}

function buildOverlaySvg({ title, subtitle, stats, cameraLabel, hasFrame, accentColor, accentTextColor }) {
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
  <rect x="58" y="50" width="206" height="36" rx="18" fill="${accentColor}" />
  <text x="160" y="75" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="700" text-anchor="middle" fill="${accentTextColor}">
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
    rovers: getPublicRovers(),
    activeDrivers: getActiveDrivers(),
    turnQueues: getTurnQueues(),
  };
  const camera = getPrimaryRoomCamera();
  const copy = buildEmbedCopy(state, camera);
  const siteMetadata = resolveSiteMetadata();
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
          background: siteMetadata.backgroundColor,
        },
      });

  const overlaySvg = Buffer.from(
    buildOverlaySvg({
      title: siteMetadata.name,
      subtitle: copy.subtitle,
      stats: copy.stats,
      cameraLabel: copy.cameraLabel,
      hasFrame,
      accentColor: siteMetadata.accentColor,
      accentTextColor: siteMetadata.accentTextColor,
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

function renderWebManifest() {
  const siteMetadata = resolveSiteMetadata();

  /*
    The manifest is generated from the same resolved values as the HTML and
    social image, so browser tabs, installed shortcuts, and launch screens do
    not drift into three separately configured identities.
  */
  return JSON.stringify({
    name: siteMetadata.name,
    short_name: siteMetadata.shortName,
    description: siteMetadata.description,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: siteMetadata.backgroundColor,
    theme_color: siteMetadata.accentColor,
    icons: [
      {
        src: '/bitmap.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  });
}

module.exports = {
  renderIndexHtml,
  renderOgImage,
  renderWebManifest,
};
