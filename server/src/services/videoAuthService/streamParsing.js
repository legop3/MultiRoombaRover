// Video Auth Stream Parsing
// Purpose: Parses MediaMTX path/body payloads into normalized stream targets for rover and room media checks.
// Scope: Handles native MediaMTX path forms without performing auth decisions.

const PTZ_STREAM_PATH = 'ptz-camera';

function extractStreamInfo(path) {
  // Node removes its public /video mount before proxying, so MediaMTX reports
  // only its native stream path to this authorization callback.
  const segments = (path || '').split('/').filter(Boolean);
  if (!segments.length) return null;

  let end = segments.length;
  if (segments[end - 1] === 'whep' || segments[end - 1] === 'whip') {
    end -= 1;
  }

  const remaining = segments.slice(0, end);
  if (remaining.length === 1) {
    const rawId = remaining[0] || '';
    /*
      PTZ is intentionally published as a flat MediaMTX path so WHEP requests
      line up with the real stream name. Treat that one reserved path as PTZ
      before falling back to the normal one-segment rover parsing rules.
    */
    if (rawId === PTZ_STREAM_PATH) {
      return { type: 'ptz', id: rawId };
    }
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

function extractStreamInfoFromBody(body = {}) {
  // All enabled MediaMTX protocols now report the canonical path directly;
  // there is no second SRT stream-id syntax to normalize or authorize.
  return extractStreamInfo((body.path || '').replace(/^\//, ''));
}

module.exports = {
  extractStreamInfoFromBody,
};
