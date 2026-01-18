let cachedAv1Support = null;

function hasAv1CodecCapability() {
  if (typeof RTCRtpReceiver !== 'undefined' && RTCRtpReceiver.getCapabilities) {
    const caps = RTCRtpReceiver.getCapabilities('video');
    const codecs = caps?.codecs || [];
    return codecs.some((codec) => {
      const mime = (codec?.mimeType || '').toLowerCase();
      return mime === 'video/av1' || mime === 'video/av01' || mime === 'video/av1x';
    });
  }
  if (typeof document !== 'undefined') {
    const video = document.createElement('video');
    if (typeof video.canPlayType === 'function') {
      const result = video.canPlayType('video/mp4; codecs="av01.0.05M.08"');
      return result === 'probably' || result === 'maybe';
    }
  }
  return false;
}

export function supportsAv1WebRtc() {
  if (cachedAv1Support != null) {
    return cachedAv1Support;
  }
  cachedAv1Support = hasAv1CodecCapability();
  return cachedAv1Support;
}
