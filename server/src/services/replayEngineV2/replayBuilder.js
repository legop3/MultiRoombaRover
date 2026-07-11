// Replay Builder Pipeline
// Purpose: Assembles selected buffered segments into final replay output video with optional sidebar.
// Scope: Owns concat/probe/layout/transcode pipeline and returns replay buffer plus source usage metadata.
const os = require('os');
const path = require('path');
const { getActiveDrivers } = require('../turnService');
const { getNickname } = require('../nicknameService');
const { getRecentMessages } = require('../chatService');
const io = require('../../globals/io');
const roverManager = require('../roverManager');
const { FFMPEG_BIN, BUILD_DURATION_MS, BUILD_GUARD_MS, TARGET_FPS, MAX_WIDTH, MAX_HEIGHT, MAX_BYTES } = require('./constants');

function buildGridLayout(count) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}
function clampEven(value) { return Math.max(2, Math.floor(value / 2) * 2); }
function escapeDrawtext(text) { return String(text || '').replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/%/g, '\\%'); }
function scalePadFilter(tileWidth, tileHeight, titleText = '') {
  const safeTitle = escapeDrawtext(titleText);
  return `scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${tileWidth}:${tileHeight}:(ow-iw)/2:(oh-ih)/2:color=black,drawtext=text='${safeTitle}':x=(w-text_w)/2:y=7:fontsize=14:fontcolor=white:borderw=1:bordercolor=black@0.7:box=1:boxcolor=black@0.52:boxborderw=4,setsar=1`;
}
function sanitizeReplayTitle(title, fallback = 'Replay') { const value = String(title || '').trim(); return value ? value.slice(0, 120) : fallback; }
function resolveDefaultReplayTitle(requester = '', sources = []) {
  const requesterLabel = String(requester || 'Someone').trim() || 'Someone';
  const rover = (Array.isArray(sources) ? sources : []).find((entry) => entry?.type === 'rover');
  return `${requesterLabel} driving ${rover?.label || rover?.id || 'a rover'}`;
}
function buildDriverBatterySnapshot(selectedRoverIds = []) {
  const activeDrivers = getActiveDrivers();
  const byId = new Map(roverManager.getRoster().map((rover) => [String(rover.id), rover]));
  const lines = [];
  for (const roverId of selectedRoverIds) {
    const socketId = activeDrivers[String(roverId)];
    if (!socketId) continue;
    const socket = io.sockets.sockets.get(socketId);
    const nickname = getNickname(socket) || socket?.data?.user?.username || String(socketId);
    const rover = byId.get(String(roverId));
    const roverName = rover?.name || roverId;
    const percent = rover?.batteryState?.percentDisplay;
    lines.push(`${nickname} driving ${roverName} (${Number.isFinite(percent) ? `${percent}%` : '--%'})`);
  }
  return lines;
}
function buildChatEventsForWindow(startMs, endMs, limit = 22, preWindowCount = 10) {
  const all = getRecentMessages(300, { includeSystem: false });
  const normalized = all.filter((msg) => Number.isFinite(msg?.ts)).map((msg) => ({ ts: Number(msg.ts), nickname: String(msg?.nickname || msg?.discordUserName || 'user').trim().slice(0, 32) || 'user', text: String(msg?.text || '').replace(/\s+/g, ' ').trim().slice(0, 120), role: String(msg?.role || ''), fromDiscord: Boolean(msg?.fromDiscord), roverId: msg?.roverId ? String(msg.roverId) : '', roverColor: msg?.roverColor ? String(msg.roverColor) : '' }));
  const beforeWindow = normalized.filter((msg) => msg.ts < startMs).slice(-preWindowCount);
  const inWindow = normalized.filter((msg) => msg.ts >= startMs && msg.ts <= endMs).slice(-limit);
  return [...beforeWindow, ...inWindow].sort((a, b) => a.ts - b.ts);
}

function createReplayBuilder({ execFileAsync, fsp, ensureDir, renderSidebarVideo, getVideoEntriesForSource, getAudioEntriesForSource, overlapping }) {
  function resolveReplayWindow({ sources = [], nowMs, guardMs, durationMs }) {
    const tentativeEnd = nowMs - guardMs;
    const sourceEnds = [];
    for (const source of sources) {
      const sourceId = String(source.id);
      const allEntries = getVideoEntriesForSource({ type: String(source.type), id: sourceId });
      if (!Array.isArray(allEntries) || !allEntries.length) continue;
      const bounded = allEntries.filter((entry) => Number.isFinite(entry?.endMs) && entry.endMs <= tentativeEnd);
      if (!bounded.length) continue;
      const latest = bounded.reduce((best, entry) => (entry.endMs > best.endMs ? entry : best), bounded[0]);
      sourceEnds.push(latest.endMs);
    }
    const alignedEnd = sourceEnds.length ? Math.min(...sourceEnds) : tentativeEnd;
    return { tEnd: alignedEnd, tStart: alignedEnd - durationMs };
  }

  async function concatFiles(inputPaths, outPath) {
    const listPath = `${outPath}.concat.txt`;
    const body = inputPaths.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n');
    await fsp.writeFile(listPath, `${body}\n`, 'utf8');
    await execFileAsync(FFMPEG_BIN, ['-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',listPath,'-c','copy',outPath]);
  }

  async function probeMaxFrameSize(paths) {
    let maxWidth = 0, maxHeight = 0;
    for (const filePath of paths) {
      try {
        const { stdout } = await execFileAsync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0',filePath]);
        const [wRaw, hRaw] = stdout.trim().split(',');
        const w = Number(wRaw), h = Number(hRaw);
        if (Number.isFinite(w) && Number.isFinite(h)) { maxWidth = Math.max(maxWidth, w); maxHeight = Math.max(maxHeight, h); }
      } catch {}
    }
    return { maxWidth, maxHeight };
  }

  async function buildReplayVideo({ sources = [], title = '', requester = '', includeSidebar = true } = {}) {
    if (!Array.isArray(sources) || !sources.length) throw new Error('No replay sources selected');
    const { tEnd, tStart } = resolveReplayWindow({
      sources,
      nowMs: Date.now(),
      guardMs: BUILD_GUARD_MS,
      durationMs: BUILD_DURATION_MS,
    });
    const resolvedTitle = sanitizeReplayTitle(title, resolveDefaultReplayTitle(requester, sources));
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mrr-replay-v2-'));

    try {
      const usedSources = [];
      const missingSources = [];
      const normalizedVideos = [];
      const normalizedAudios = [];

      for (let i = 0; i < sources.length; i += 1) {
        const source = sources[i];
        const sourceId = String(source.id);
        const videoEntries = overlapping(getVideoEntriesForSource({ type: String(source.type), id: sourceId }), tStart, tEnd);
        if (!videoEntries.length) { missingSources.push({ ...source, reason: 'no video coverage in replay window' }); continue; }

        const videoConcat = path.join(tmpDir, `video-${i}.mp4`);
        await concatFiles(videoEntries.map((entry) => entry.filePath), videoConcat);
        const videoTrimmed = path.join(tmpDir, `video-${i}.trim.mp4`);
        const firstStartMs = videoEntries[0].startMs;
        const ss = Math.max(0, (tStart - firstStartMs) / 1000);
        const to = Math.max(ss + 0.1, (tEnd - firstStartMs) / 1000);
        await execFileAsync(FFMPEG_BIN, ['-y','-hide_banner','-loglevel','error','-ss',ss.toFixed(3),'-to',to.toFixed(3),'-i',videoConcat,'-an','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-r',String(TARGET_FPS),videoTrimmed]);

        normalizedVideos.push({ path: videoTrimmed, source });
        usedSources.push(source);

        const audioEntries = overlapping(getAudioEntriesForSource(source), tStart, tEnd);
        if (audioEntries.length) {
          /*
            Audio workers are separate from selected video sources, even for PTZ
            where the live camera path carries inline Opus. Trim the matching
            source-owned audio window here and let the final graph mix every
            selected source's audio together.
          */
          const audioConcat = path.join(tmpDir, `audio-${i}.m4a`);
          await concatFiles(audioEntries.map((entry) => entry.filePath), audioConcat);
          const audioTrimmed = path.join(tmpDir, `audio-${i}.trim.m4a`);
          const firstAudioStartMs = audioEntries[0].startMs;
          const ass = Math.max(0, (tStart - firstAudioStartMs) / 1000);
          const ato = Math.max(ass + 0.1, (tEnd - firstAudioStartMs) / 1000);
          await execFileAsync(FFMPEG_BIN, ['-y','-hide_banner','-loglevel','error','-ss',ass.toFixed(3),'-to',ato.toFixed(3),'-i',audioConcat,'-vn','-ac','1','-ar','48000','-c:a','aac','-b:a','96k',audioTrimmed]);
          normalizedAudios.push(audioTrimmed);
        }
      }

      if (!normalizedVideos.length) throw new Error('No replay segments available for selected sources');

      const layout = buildGridLayout(normalizedVideos.length);
      const { maxWidth, maxHeight } = await probeMaxFrameSize(normalizedVideos.map((v) => v.path));
      let tileWidth = maxWidth || 640;
      let tileHeight = maxHeight || 360;
      let outWidth = tileWidth * layout.cols;
      let outHeight = tileHeight * layout.rows;
      if (outWidth > MAX_WIDTH || outHeight > MAX_HEIGHT) {
        const scale = Math.min(MAX_WIDTH / outWidth, MAX_HEIGHT / outHeight);
        tileWidth *= scale; tileHeight *= scale; outWidth = tileWidth * layout.cols; outHeight = tileHeight * layout.rows;
      }
      tileWidth = clampEven(tileWidth);
      tileHeight = clampEven(tileHeight);
      const durationSec = BUILD_DURATION_MS / 1000;

      const inputArgs = [];
      const filterParts = [];
      const layoutParts = [];
      for (let i = 0; i < normalizedVideos.length; i += 1) {
        inputArgs.push('-i', normalizedVideos[i].path);
        const sourceTitle = normalizedVideos[i]?.source?.label || normalizedVideos[i]?.source?.id || `Source ${i + 1}`;
        filterParts.push(`[${i}:v]${scalePadFilter(tileWidth, tileHeight, sourceTitle)}[v${i}]`);
        const x = (i % layout.cols) * tileWidth;
        const y = Math.floor(i / layout.cols) * tileHeight;
        layoutParts.push(`${x}_${y}`);
      }

      let audioInputStart = normalizedVideos.length;
      let sidebarInputIndex = -1;
      if (includeSidebar) {
        const selectedRoverIds = usedSources.filter((entry) => entry?.type === 'rover').map((entry) => String(entry.id));
        const sidebarPath = await renderSidebarVideo({ tmpDir, title: resolvedTitle, durationSec, height: clampEven(tileHeight * layout.rows), windowStartMs: tStart, driverBatteryLines: buildDriverBatterySnapshot(selectedRoverIds), chatEvents: buildChatEventsForWindow(tStart, tEnd) });
        inputArgs.push('-i', sidebarPath);
        sidebarInputIndex = normalizedVideos.length;
        audioInputStart = normalizedVideos.length + 1;
      }

      for (const audioPath of normalizedAudios) inputArgs.push('-i', audioPath);
      if (normalizedVideos.length === 1) filterParts.push('[v0]null[vgrid]');
      else filterParts.push(`${normalizedVideos.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${normalizedVideos.length}:layout=${layoutParts.join('|')}:fill=black[vgrid]`);
      if (includeSidebar) filterParts.push(`[vgrid][${sidebarInputIndex}:v]hstack=inputs=2[vout]`);
      else filterParts.push('[vgrid]null[vout]');

      if (normalizedAudios.length) {
        const audioRefs = normalizedAudios.map((_, idx) => `[${audioInputStart + idx}:a]`).join('');
        filterParts.push(`${audioRefs}amix=inputs=${normalizedAudios.length}:normalize=0,alimiter=limit=0.9[aout]`);
      }

      const targetBitrateKbps = Math.max(400, Math.floor((MAX_BYTES * 8) / durationSec / 1000));
      const outPath = path.join(tmpDir, 'replay.mp4');
      const args = ['-y','-hide_banner','-loglevel','error',...inputArgs,'-filter_complex',filterParts.join(';'),'-map','[vout]','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-r',String(TARGET_FPS),'-b:v',`${targetBitrateKbps}k`,'-maxrate',`${Math.floor(targetBitrateKbps * 1.15)}k`,'-bufsize',`${Math.floor(targetBitrateKbps * 2)}k`];
      if (normalizedAudios.length) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '128k');
      args.push(outPath);
      await execFileAsync(FFMPEG_BIN, args);
      const buffer = await fsp.readFile(outPath);
      return { buffer, usedSources, missingSources, title: resolvedTitle };
    } finally {
      try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  return { buildReplayVideo };
}

module.exports = { createReplayBuilder };
