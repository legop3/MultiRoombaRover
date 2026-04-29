// Replay Sidebar Renderer
// Purpose: Renders replay sidebar visuals (title, drivers, chat) and encodes them as a video stream.
// Scope: Owns SVG/frame synthesis and ffmpeg encoding for optional replay sidebars.
const path = require('path');
const sharp = require('sharp');
const { FFMPEG_BIN, TARGET_FPS, SIDEBAR_WIDTH } = require('./constants');

function createSidebarRenderer({ execFileAsync, ensureDir }) {
  function escapeXml(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function wrapTextLines(text, maxChars = 24) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines.slice(0, 4);
  }

  function hexToRgb(hex) {
    const value = String(hex || '').trim();
    const match = /^#([0-9A-Fa-f]{6})$/.exec(value);
    if (!match) return null;
    const raw = match[1];
    return { r: parseInt(raw.slice(0, 2), 16), g: parseInt(raw.slice(2, 4), 16), b: parseInt(raw.slice(4, 6), 16) };
  }

  function roleColor(role = '') {
    switch (String(role)) {
      case 'admin':
      case 'lockdown':
      case 'lockdown-admin':
        return '#FCD34D';
      case 'spectator':
        return '#94A3B8';
      default:
        return '#7DD3FC';
    }
  }

  function renderSidebarSvg({ width, height, title, driverBatteryLines, chatLines }) {
    const textCols = Math.max(24, Math.floor((width - 16) / 6));
    const titleParts = wrapTextLines(title, Math.max(26, textCols)).slice(0, 4).map((line) => escapeXml(line));
    const statLines = driverBatteryLines.slice(0, 8).map((line) => escapeXml(line));
    const normalizedChats = chatLines.slice(-12).map((entry) => {
      const wrapped = wrapTextLines(entry.text || '', Math.max(24, textCols)).slice(0, 4).map((line) => escapeXml(line));
      const nick = escapeXml(entry.nickname || 'user');
      const roverId = escapeXml(entry.roverId || '');
      const roverRgb = hexToRgb(entry.roverColor || '');
      const roverBadgeBg = roverRgb ? `rgba(${roverRgb.r},${roverRgb.g},${roverRgb.b},0.18)` : 'rgba(30,41,59,0.70)';
      const roverBadgeBorder = roverRgb ? `rgba(${roverRgb.r},${roverRgb.g},${roverRgb.b},0.60)` : 'rgba(71,85,105,0.75)';
      return { nick, wrapped, nameColor: roleColor(entry.role), fromDiscord: Boolean(entry.fromDiscord), roverId, roverBadgeBg, roverBadgeBorder, bubbleTone: entry.fromDiscord ? 'discordBubble' : 'chatBubble' };
    });

    const shapes = [];
    const textRows = [];
    const pad = 3;
    const cardX = pad;
    const cardW = width - pad * 2;
    let y = pad;

    const titleCardH = Math.max(26, pad * 2 + titleParts.length * 15);
    shapes.push(`<rect x="${cardX}" y="${y}" width="${cardW}" height="${titleCardH}" rx="4" class="card"/>`);
    let ty = y + pad + 11;
    for (const part of titleParts) {
      textRows.push(`<text x="${cardX + pad}" y="${ty}" class="title">${part}</text>`);
      ty += 15;
    }
    y += titleCardH + pad;

    const driverLines = statLines.length ? statLines : ['No active drivers'];
    const driversCardH = pad * 2 + 11 + driverLines.length * 13;
    shapes.push(`<rect x="${cardX}" y="${y}" width="${cardW}" height="${driversCardH}" rx="4" class="card"/>`);
    textRows.push(`<text x="${cardX + pad}" y="${y + pad + 9}" class="section">Drivers</text>`);
    let dy = y + pad + 19;
    for (const line of driverLines) {
      textRows.push(`<text x="${cardX + pad}" y="${dy}" class="${statLines.length ? 'body' : 'muted'}">${line}</text>`);
      dy += 13;
    }
    y += driversCardH + pad;

    const chatCardH = Math.max(80, height - y - pad);
    shapes.push(`<rect x="${cardX}" y="${y}" width="${cardW}" height="${chatCardH}" rx="4" class="card"/>`);
    textRows.push(`<text x="${cardX + pad}" y="${y + pad + 9}" class="section">Chat</text>`);

    let cy = y + pad + 12;
    const bubbleX = cardX + pad;
    const bubbleW = cardW - pad * 2;
    if (!normalizedChats.length) {
      textRows.push(`<text x="${cardX + pad}" y="${cy + 14}" class="muted">No chat in replay window</text>`);
    } else {
      for (let i = 0; i < normalizedChats.length; i += 1) {
        const block = normalizedChats[i];
        const nameW = Math.min(72, block.nick.length * 5.2);
        const badgeW = block.roverId ? Math.min(46, Math.max(18, block.roverId.length * 5 + 6)) : 0;
        const badgeGap = block.roverId ? 3 : 0;
        const prefixChars = Math.ceil((nameW + badgeW + badgeGap + 10) / 5.8);
        const firstLineRaw = String(block.wrapped[0] || '').trim();
        const remainingRaw = block.wrapped.slice(firstLineRaw ? 1 : 0).map((line) => String(line || '').trim()).filter(Boolean);
        const fullText = (firstLineRaw ? [firstLineRaw, ...remainingRaw] : remainingRaw).join(' ');
        const inlineWrapped = wrapTextLines(fullText, Math.max(16, textCols - prefixChars)).slice(0, 4).map((line) => escapeXml(line));
        const bubbleH = pad * 2 + Math.max(1, inlineWrapped.length) * 12;
        if (cy + bubbleH + pad > y + chatCardH - pad) break;
        shapes.push(`<rect x="${bubbleX}" y="${cy}" width="${bubbleW}" height="${bubbleH}" rx="4" class="${block.bubbleTone}"/>`);
        const nameX = bubbleX + pad;
        const textStartX = nameX + nameW + 3 + (block.roverId ? badgeW + badgeGap : 0);
        textRows.push(`<text x="${nameX}" y="${cy + pad + 8}" class="chatName" fill="${block.nameColor}">${block.nick}</text>`);
        if (block.fromDiscord) textRows.push(`<text x="${nameX + nameW + 2}" y="${cy + pad + 8}" class="discordTag">◈</text>`);
        if (block.roverId) {
          const badgeX = nameX + nameW + 3;
          const badgeTextX = badgeX + 3;
          shapes.push(`<rect x="${badgeX}" y="${cy + pad - 1}" width="${badgeW}" height="12" rx="3" fill="${block.roverBadgeBg}" stroke="${block.roverBadgeBorder}" stroke-width="0.8"/>`);
          textRows.push(`<text x="${badgeTextX}" y="${cy + pad + 8}" class="roverTag">${block.roverId}</text>`);
        }
        let by = cy + pad + 8;
        for (let lineIdx = 0; lineIdx < inlineWrapped.length; lineIdx += 1) {
          const line = inlineWrapped[lineIdx];
          const lineX = lineIdx === 0 ? textStartX : bubbleX + pad;
          textRows.push(`<text x="${lineX}" y="${by}" class="chat">${line}</text>`);
          by += 12;
        }
        cy += bubbleH + pad;
      }
    }

    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">\n  <rect width="${width}" height="${height}" fill="#000000"/>\n  <style>.card{fill:#141414;stroke:#262626;stroke-width:.6}.chatBubble{fill:#3f3f46}.discordBubble{fill:#3f3f46}.title{font-family:"DejaVu Sans",sans-serif;font-size:15px;font-weight:700;fill:#f8fafc}.section{font-family:"DejaVu Sans",sans-serif;font-size:11px;font-weight:700;fill:#e2e8f0}.body{font-family:"DejaVu Sans",sans-serif;font-size:11px;fill:#e2e8f0}.chatName{font-family:"DejaVu Sans",sans-serif;font-size:10px;font-weight:700}.chat{font-family:"DejaVu Sans",sans-serif;font-size:10px;fill:#f8fafc}.roverTag{font-family:"DejaVu Sans",sans-serif;font-size:9px;fill:#dbeafe}.discordTag{font-family:"DejaVu Sans",sans-serif;font-size:10px;fill:#c7d2fe}.muted{font-family:"DejaVu Sans",sans-serif;font-size:10px;fill:#94a3b8}</style>\n  ${shapes.join('\n  ')}\n  ${textRows.join('\n  ')}\n</svg>`;
  }

  async function renderSidebarVideo({ tmpDir, title, durationSec, height, windowStartMs, driverBatteryLines = [], chatEvents = [] }) {
    const framesDir = path.join(tmpDir, 'sidebar-frames');
    const sidebarPath = path.join(tmpDir, 'sidebar.mp4');
    await ensureDir(framesDir);
    const secondCount = Math.max(1, Math.ceil(durationSec));
    for (let second = 0; second < secondCount; second += 1) {
      const sliceEndMs = windowStartMs + (second + 1) * 1000;
      const visibleChat = chatEvents.filter((entry) => entry.ts <= sliceEndMs).slice(-10);
      const svg = renderSidebarSvg({ width: SIDEBAR_WIDTH, height, title, driverBatteryLines, chatLines: visibleChat });
      const framePath = path.join(framesDir, `frame-${String(second + 1).padStart(4, '0')}.png`);
      await sharp(Buffer.from(svg, 'utf8')).png().toFile(framePath);
    }

    await execFileAsync(FFMPEG_BIN, [
      '-y','-hide_banner','-loglevel','error','-framerate','1','-i',path.join(framesDir, 'frame-%04d.png'),
      '-vf',`fps=${TARGET_FPS},format=yuv420p`,'-t',durationSec.toFixed(3),'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p',sidebarPath,
    ]);
    return sidebarPath;
  }

  return { renderSidebarVideo };
}

module.exports = { createSidebarRenderer };
