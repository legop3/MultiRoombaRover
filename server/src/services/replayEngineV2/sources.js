// Replay Source Catalog
// Purpose: Resolves replay-capable media sources and ffmpeg worker arguments.
// Scope: Converts live rover/room state into stable source descriptors and stream worker config.
const path = require('path');
const roverManager = require('../roverManager');
const { getRoomCameras } = require('../roomCameraService');
const ptzCameraService = require('../ptzCameraService');
const { FFMPEG_BIN, SEGMENT_SECONDS, TARGET_FPS } = require('./constants');

function sourceKey(source) {
  return `${source.sourceType}__${source.kind}__${source.id}`;
}

function sourceDirForKey(activeSegmentRoot, key) {
  return path.join(activeSegmentRoot, key);
}

function toSrtReadPath(streamId) {
  return `srt://127.0.0.1:9000?streamid=read:${encodeURIComponent(streamId)}`;
}

function getRoomCameraStream(camera) {
  if (camera?.streamUrl) return camera.streamUrl;
  const url = String(camera?.url || '');
  if (url.includes('.mjpg') || url.includes('mjpeg') || url.includes('stream')) return url;
  return null;
}

function hasRoverAudioCapture(rover) {
  // The replay worker only records a rover microphone stream when roverd says
  // capture is both enabled and publishable. That mirrors the media publisher
  // contract instead of guessing from stream naming conventions alone.
  return Boolean(rover?.media?.audioCapture?.enabled && rover?.media?.audioCapture?.publishUrl);
}

function listDesiredSources() {
  const sources = [];
  for (const rover of roverManager.getRoster()) {
    const roverId = String(rover.id);
    sources.push({ id: roverId, sourceType: 'rover', kind: 'video', label: rover.name || roverId, inputUrl: toSrtReadPath(roverId) });
    if (hasRoverAudioCapture(rover)) {
      sources.push({ id: `${roverId}-audio`, sourceType: 'rover', roverId, kind: 'audio', label: `${rover.name || roverId} audio`, inputUrl: toSrtReadPath(`${roverId}-audio`) });
    }
  }
  for (const camera of getRoomCameras()) {
    const streamUrl = getRoomCameraStream(camera);
    if (!streamUrl) continue;
    sources.push({ id: String(camera.id), sourceType: 'room', kind: 'video', label: camera.name || camera.id, inputUrl: streamUrl });
  }
  // The PTZ service owns its own worker list because video and microphone audio
  // both come from the same live MediaMTX path, unlike rovers where audio is a
  // separate published stream.
  sources.push(...ptzCameraService.getReplayWorkerSources());
  return sources;
}

function buildWorkerArgs(activeSegmentRoot, source) {
  const dir = sourceDirForKey(activeSegmentRoot, sourceKey(source));
  const pattern = path.join(dir, 'seg-%06d.mp4');
  const common = ['-hide_banner', '-loglevel', 'warning', '-y', '-fflags', '+genpts', '-use_wallclock_as_timestamps', '1', '-i', source.inputUrl];

  if (source.kind === 'audio') {
    return [
      ...common,
      '-vn','-ac','1','-ar','48000','-af','aresample=async=1:first_pts=0:min_hard_comp=0.100000,asetpts=N/SR/TB',
      '-c:a','aac','-b:a','96k','-f','segment','-segment_time',String(SEGMENT_SECONDS),'-segment_atclocktime','1','-reset_timestamps','1',pattern,
    ];
  }

  return [
    ...common,
    '-an','-vf',`fps=${TARGET_FPS}`,'-c:v','libx264','-preset','veryfast','-tune','zerolatency','-pix_fmt','yuv420p','-g',String(TARGET_FPS * SEGMENT_SECONDS),'-keyint_min',String(TARGET_FPS * SEGMENT_SECONDS),'-sc_threshold','0','-f','segment','-segment_time',String(SEGMENT_SECONDS),'-segment_atclocktime','1','-reset_timestamps','1',pattern,
  ];
}

module.exports = {
  FFMPEG_BIN,
  sourceKey,
  sourceDirForKey,
  listDesiredSources,
  buildWorkerArgs,
};
