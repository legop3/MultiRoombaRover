// Discord Replay Workflow
// Purpose: Provides the shared replay job, Discord upload, fuzzy source lookup, and user-facing status helpers.
// Scope: Keeps Discord-command and web-triggered replay delivery on the same status pipeline.
const Fuse = require('fuse.js');

const DEFAULT_ALLOWED_MENTIONS = { parse: [], repliedUser: false };
const FUZZY_THRESHOLD = 0.42;
const MAX_SUGGESTIONS = 4;

function nowTs() {
  return Date.now();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeSearchText(value) {
  return normalizeText(value).toLowerCase();
}

function compactJoin(parts, separator = ', ') {
  return (Array.isArray(parts) ? parts : []).map(normalizeText).filter(Boolean).join(separator);
}

function buildReplayJobId(prefix = 'replay') {
  // Replay rendering continues after the initial command/socket acknowledgement.
  // The id is deliberately short but unique enough for correlating UI status, Discord messages, and logs.
  const safePrefix = normalizeText(prefix).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'replay';
  return `${safePrefix}-${nowTs()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sourceKey(source) {
  return `${source?.type}:${source?.id}`;
}

function sourceName(source) {
  return normalizeText(source?.label) || normalizeText(source?.id) || 'unknown source';
}

function describeSource(source) {
  const label = sourceName(source);
  if (source?.type === 'room') return `${label} room camera`;
  return label;
}

function sanitizeReplayTitleForFilename(title) {
  // Discord attachment names should be readable and filesystem-safe.
  // The title may originate from chat/web input, so strip separators and cap length before upload.
  const cleaned = String(title || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96);
  return cleaned || 'replay';
}

function buildReplayTitle({ explicitTitle = '', sources = [] } = {}) {
  const trimmed = normalizeText(explicitTitle).slice(0, 120);
  if (trimmed) return trimmed;

  const list = Array.isArray(sources) ? sources : [];
  if (!list.length) return 'Replay';

  const roomCount = list.filter((entry) => entry?.type === 'room').length;
  const roverCount = list.filter((entry) => entry?.type === 'rover').length;
  if (roomCount && !roverCount) return roomCount === 1 ? `Replay: ${sourceName(list[0])}` : 'Replay: Room Cameras';
  if (roverCount && !roomCount && list.length === 1) return `Replay: ${sourceName(list[0])}`;

  // Multi-source titles identify the replay target without claiming the requester was driving.
  // Actual driver context is put in the caption where it can be based on live server state.
  const shown = list.slice(0, 2).map(sourceName);
  const remaining = list.length - shown.length;
  return `Replay: ${compactJoin(shown)}${remaining > 0 ? ` + ${remaining} more` : ''}`;
}

function buildSourceSummary(sources = []) {
  const list = Array.isArray(sources) ? sources : [];
  if (!list.length) return 'no sources';
  return compactJoin(list.map(describeSource));
}

function normalizeReplaySources(sources = []) {
  return (Array.isArray(sources) ? sources : [])
    .filter((source) => source?.type && source?.id != null)
    .map((source) => ({
      type: source.type,
      id: String(source.id),
      label: source.label || String(source.id),
    }));
}

function normalizeUserError(err) {
  const message = normalizeText(err?.message || err);
  if (!message) return 'Replay failed.';
  if (/No replay segments available/i.test(message)) return 'Replay failed: no recent video coverage was available for the selected source.';
  if (/No replay sources selected/i.test(message)) return 'Replay failed: no replay sources were selected.';
  if (/upload did not return/i.test(message)) return 'Replay failed: Discord did not confirm the video upload.';
  if (/attachment URL/i.test(message)) return 'Replay failed: Discord uploaded the message without a playable video URL.';
  if (/Replay channel not configured/i.test(message)) return 'Replay failed: the Discord replay channel is not configured.';
  return `Replay failed: ${message}`;
}

function firstAttachmentFromMessage(message) {
  if (!message?.attachments) return null;
  if (typeof message.attachments.first === 'function') return message.attachments.first() || null;
  if (typeof message.attachments.values === 'function') return message.attachments.values().next().value || null;
  return null;
}

function buildDiscordReplayMediaPayload({ message, attachment, job }) {
  if (!attachment?.url) return null;
  return {
    jobId: job.id,
    status: 'ready',
    title: job.title,
    requester: job.requester,
    requestedBy: job.requestedBy || null,
    url: attachment.url,
    proxyUrl: attachment.proxyURL || attachment.proxyUrl || null,
    messageUrl: message?.url || null,
    filename: attachment.name || attachment.filename || 'replay.mp4',
    size: Number.isFinite(attachment.size) ? attachment.size : null,
    contentType: attachment.contentType || null,
    discord: {
      channelId: message?.channelId || null,
      messageId: message?.id || null,
      attachmentId: attachment.id || null,
    },
    sources: normalizeReplaySources(job.sources),
    ts: nowTs(),
  };
}

function createReplayJob({ id = null, requester = 'Discord', source = 'discord', title = '', sources = [], includeSidebar = true, requestedBy = null } = {}) {
  const normalizedSources = normalizeReplaySources(sources);
  const resolvedTitle = buildReplayTitle({ explicitTitle: title, sources: normalizedSources });
  return {
    id: id || buildReplayJobId(source),
    source,
    requester: normalizeText(requester) || 'Discord',
    title: resolvedTitle,
    sources: normalizedSources,
    includeSidebar: includeSidebar !== false,
    requestedBy: requestedBy && typeof requestedBy === 'object' ? { ...requestedBy } : null,
    createdAt: nowTs(),
  };
}

function createJobStatusEmitter({ io, logger, sanitizeMentions }) {
  function buildPayload(job, status, extra = {}) {
    return {
      jobId: job.id,
      status,
      title: job.title,
      requester: job.requester,
      requestedBy: job.requestedBy || null,
      sources: normalizeReplaySources(job.sources),
      message: extra.message ? sanitizeMentions(extra.message) : undefined,
      media: extra.media || undefined,
      ts: nowTs(),
    };
  }

  function emit(job, status, extra = {}) {
    const payload = buildPayload(job, status, extra);
    io.emit('replay:status', payload);
    if (status === 'ready' && extra.media) io.emit('replay:ready', extra.media);
    if (status === 'failed') io.emit('replay:failed', payload);
    if (logger?.debug) logger.debug('Replay job status', { jobId: job.id, status });
    return payload;
  }

  return { emit };
}

function createReplaySourceResolver({ rovers, getReplaySources, getDefaultDiscordSources, validateSources }) {
  function buildAllowedCandidates() {
    return getReplaySources().map((source) => ({
      type: source.type,
      id: String(source.id),
      label: source.label || source.id,
      access: 'allowed',
      reason: null,
    }));
  }

  function buildDeniedRoverCandidates(allowedKeys) {
    const denied = [];
    for (const record of rovers.values()) {
      const candidate = {
        type: 'rover',
        id: String(record.id),
        label: record.meta?.name || record.name || record.id,
        access: 'denied',
        reason: record.private?.enabled && !record.privateOpen
          ? 'that rover is private right now'
          : 'that rover is not replayable from Discord right now',
      };
      if (!allowedKeys.has(sourceKey(candidate))) denied.push(candidate);
    }
    return denied;
  }

  function buildCandidates() {
    const allowed = buildAllowedCandidates();
    const allowedKeys = new Set(allowed.map(sourceKey));
    return [...allowed, ...buildDeniedRoverCandidates(allowedKeys)].map((source) => ({
      ...source,
      qualifiedId: `${source.type}:${source.id}`,
      searchLabel: normalizeSearchText(source.label),
      searchId: normalizeSearchText(source.id),
    }));
  }

  function createFuse(candidates) {
    return new Fuse(candidates, {
      includeScore: true,
      threshold: FUZZY_THRESHOLD,
      ignoreLocation: true,
      keys: [
        { name: 'label', weight: 0.52 },
        { name: 'id', weight: 0.26 },
        { name: 'qualifiedId', weight: 0.18 },
        { name: 'type', weight: 0.04 },
      ],
    });
  }

  function suggestions(candidates) {
    const allowed = candidates.filter((entry) => entry.access === 'allowed').slice(0, MAX_SUGGESTIONS);
    if (!allowed.length) return '';
    return ` Did you mean: ${compactJoin(allowed.map(describeSource))}?`;
  }

  function findForToken(token, candidates, fuse) {
    const cleaned = normalizeSearchText(token);
    const [prefix, rest] = cleaned.includes(':') ? cleaned.split(':', 2) : [null, cleaned];
    const exact = candidates.find((entry) => (
      (!prefix || entry.type === prefix) &&
      (entry.searchId === rest || entry.searchLabel === rest || normalizeSearchText(entry.qualifiedId) === cleaned)
    ));
    if (exact) return exact;
    return fuse.search(cleaned).map((entry) => entry.item).find((entry) => !prefix || entry.type === prefix) || null;
  }

  function resolve(query) {
    const cleaned = normalizeSearchText(query);
    if (!cleaned || cleaned === 'all' || cleaned === '*') {
      const sources = getDefaultDiscordSources();
      return sources.length
        ? { sources: normalizeReplaySources(sources), defaulted: true }
        : { error: 'Replay denied: no default Discord replay sources are available.' };
    }

    const candidates = buildCandidates();
    const fuse = createFuse(candidates);
    const selected = [];
    const denied = [];
    const unmatched = [];
    normalizeText(query).split(',').map((token) => token.trim()).filter(Boolean).forEach((token) => {
      const match = findForToken(token, candidates, fuse);
      if (!match) {
        unmatched.push(token);
      } else if (match.access !== 'allowed') {
        denied.push(match);
      } else {
        selected.push({ type: match.type, id: match.id, label: match.label });
      }
    });

    if (denied.length) {
      const deniedText = compactJoin(denied.map((entry) => `${describeSource(entry)} (${entry.reason})`));
      return { error: `Replay denied: ${deniedText}.` };
    }
    if (unmatched.length) return { error: `No replay source matched "${unmatched[0]}".${suggestions(candidates)}` };

    const sources = validateSources(selected);
    return sources.length
      ? { sources: normalizeReplaySources(sources), defaulted: false }
      : { error: `No replay source matched "${normalizeText(query)}".${suggestions(candidates)}` };
  }

  return { resolve };
}

function createReplayCaptionBuilder({ io, rovers, getActiveDrivers, getNickname, sanitizeMentions }) {
  function buildReplayDriverLines(requester, sources = []) {
    const activeDrivers = getActiveDrivers();
    const roverSources = normalizeReplaySources(sources).filter((entry) => entry.type === 'rover');
    const requestedRoverIds = new Set(roverSources.map((entry) => String(entry.id)));
    const lines = [];
    requestedRoverIds.forEach((roverId) => {
      const socketId = activeDrivers?.[roverId];
      if (!socketId) return;
      const socket = io.sockets.sockets.get(socketId);
      const nickname = getNickname(socket) || socket?.data?.user?.username || socketId;
      const record = rovers.get(roverId);
      const roverName = record?.meta?.name || record?.id || roverId;
      const isAuthor = normalizeSearchText(nickname) === normalizeSearchText(requester);
      lines.push(`${nickname} was driving ${roverName}${isAuthor ? ' when they requested this' : ''}`);
    });
    return lines;
  }

  function buildDriverCaption() {
    const activeDrivers = getActiveDrivers();
    const roster = Array.from(rovers.values());
    if (!roster.length) return 'Drivers: no rovers online.';
    const entries = roster.map((record) => {
      const driverId = activeDrivers[record.id];
      if (!driverId) return `${record.meta?.name || record.id}: none`;
      const socket = io.sockets.sockets.get(driverId);
      const nickname = getNickname(socket) || socket?.data?.user?.username || driverId;
      return `${record.meta?.name || record.id}: ${nickname}`;
    });
    return `Drivers: ${entries.join(', ')}`;
  }

  function formatMissingSource(source) {
    const label = source?.label || `${source?.type}:${source?.id}`;
    return source?.reason ? `${label} (${source.reason})` : label;
  }

  function build({ job, usedSources = [], missingSources = [] }) {
    const lines = [`**${job.title}**`, '', `Requested by ${job.requester}.`];
    const driverLines = buildReplayDriverLines(job.requester, usedSources);
    if (driverLines.length) {
      lines.push('', ...driverLines);
    } else {
      lines.push(buildDriverCaption());
    }
    if (missingSources.length) {
      lines.push('', `Missing: ${missingSources.map(formatMissingSource).join(', ')}`);
    }
    return sanitizeMentions(lines.join('\n'));
  }

  return { build };
}

function startDiscordTypingLoop(target, logger, label = 'replay') {
  let stopped = false;
  let intervalId = null;
  async function sendTyping() {
    if (stopped || typeof target?.sendTyping !== 'function') return;
    try {
      await target.sendTyping();
    } catch (err) {
      if (logger?.warn) logger.warn('Failed to send Discord typing indicator', { label, error: err.message });
    }
  }
  // Discord typing indicators expire quickly, so refresh while ffmpeg and upload work is active.
  sendTyping();
  intervalId = setInterval(sendTyping, 6000);
  return () => {
    stopped = true;
    if (intervalId) clearInterval(intervalId);
  };
}

function buildAcceptedMessage(job) {
  return `Replay accepted. Building **${job.title}** from ${buildSourceSummary(job.sources)}.`;
}

function buildStatusMessage(job, status) {
  if (status === 'building') return `Replay building: **${job.title}**`;
  if (status === 'uploading') return `Replay uploading to Discord: **${job.title}**`;
  if (status === 'ready') return `Replay ready: **${job.title}**`;
  return `Replay ${status}: **${job.title}**`;
}

module.exports = {
  DEFAULT_ALLOWED_MENTIONS,
  buildReplayJobId,
  createReplayJob,
  createJobStatusEmitter,
  createReplaySourceResolver,
  createReplayCaptionBuilder,
  startDiscordTypingLoop,
  sanitizeReplayTitleForFilename,
  firstAttachmentFromMessage,
  buildDiscordReplayMediaPayload,
  buildAcceptedMessage,
  buildStatusMessage,
  normalizeUserError,
  buildReplayTitle,
};
