// Video Auth Stream Parsing
// Purpose: Parses MediaMTX path/body payloads into normalized stream targets for rover and room media checks.
// Scope: Handles WHEP/WHP path-prefix trimming and SRT streamid extraction without performing auth decisions.
const { loadConfig } = require('../../helpers/configLoader');

const config = loadConfig();
const mediaConfig = config.media || {};

function getPathPrefix() {
  const base = mediaConfig.whepBaseUrl;
  if (!base) return '';
  try {
    const parsed = new URL(base);
    return parsed.pathname || '';
  } catch {
    return base.replace(/^[^/]*:\/\//, '').replace(/^[^/]+/, '');
  }
}

const whepPathPrefix = getPathPrefix().replace(/\/+$/, '').replace(/^\/+/, '');
const whepPrefixSegments = whepPathPrefix ? whepPathPrefix.split('/').filter(Boolean) : [];

function extractStreamInfo(path) {
  const segments = (path || '').split('/').filter(Boolean);
  if (!segments.length) return null;

  let start = 0;
  if (whepPrefixSegments.length && whepPrefixSegments.every((segment, idx) => segments[idx] === segment)) {
    start = whepPrefixSegments.length;
  }

  let end = segments.length;
  if (segments[end - 1] === 'whep' || segments[end - 1] === 'whip') {
    end -= 1;
  }

  const remaining = segments.slice(start, end);
  if (remaining.length === 1) {
    const rawId = remaining[0] || '';
    if (rawId.endsWith('-fwd')) {
      return { type: 'rover', id: rawId, baseId: rawId.slice(0, -4) };
    }
    const baseId = rawId.endsWith('-audio') ? rawId.slice(0, -6) : rawId;
    return { type: 'rover', id: rawId, baseId };
  }

  if (remaining.length === 2 && remaining[0] === 'room') {
    return { type: 'room', id: remaining[1] || '' };
  }

  if (remaining.length === 2 && remaining[0] === 'ptz') {
    return { type: 'ptz', id: remaining[1] || '' };
  }

  return null;
}

function extractSrtStreamId(rawValue) {
  const value = decodeURIComponent(String(rawValue || '').trim());
  if (!value) return '';

  const match = value.match(/(?:^|[?&]|,|#!::)r=([^,&]+)/);
  if (match?.[1]) {
    return match[1];
  }

  if (!/[?&=,:]/.test(value)) {
    return value;
  }

  return '';
}

function extractStreamInfoFromBody(body = {}) {
  const fromPath = extractStreamInfo((body.path || '').replace(/^\//, ''));
  if (fromPath) return fromPath;

  const srtId =
    extractSrtStreamId(body.streamid) ||
    extractSrtStreamId(body.streamId) ||
    extractSrtStreamId(body.query);
  if (!srtId) return null;

  if (srtId.endsWith('-fwd')) {
    return { type: 'rover', id: srtId, baseId: srtId.slice(0, -4) };
  }

  const baseId = srtId.endsWith('-audio') ? srtId.slice(0, -6) : srtId;
  return { type: 'rover', id: srtId, baseId };
}

module.exports = {
  extractStreamInfoFromBody,
};
