import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fieldClass } from './constants.js';
import { useControlSystem } from '../../controls/index.js';
import { useSettingsNamespace } from '../../settings/index.js';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const TARGET_SAMPLE_RATE = 16000;
const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function encodeBase64(value) {
  if (typeof btoa === 'function') return btoa(value);
  return '';
}

function buildAuthHeader(token) {
  if (!token) return {};
  const encoded = encodeBase64(`${token}:${token}`);
  return encoded ? { Authorization: `Basic ${encoded}` } : {};
}

function waitForIceGatheringComplete(pc, timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (!pc || pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    }, timeoutMs);
    function onChange() {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      }
    }
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

function isPeerTransportReady(pc) {
  if (!pc) return false;
  const conn = pc.connectionState;
  const ice = pc.iceConnectionState;
  if (conn === 'connected') return true;
  if (ice === 'connected' || ice === 'completed') return true;
  return false;
}

function waitForPeerConnected(pc, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!pc) {
      reject(new Error('Peer connection missing'));
      return;
    }
    if (isPeerTransportReady(pc)) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Peer connection timeout'));
    }, timeoutMs);
    const onState = () => {
      if (isPeerTransportReady(pc)) {
        cleanup();
        resolve();
      } else if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed' ||
        pc.iceConnectionState === 'failed'
      ) {
        cleanup();
        reject(new Error(`Peer connection ${pc.connectionState || pc.iceConnectionState}`));
      }
    };
    function cleanup() {
      clearTimeout(timer);
      pc.removeEventListener('connectionstatechange', onState);
      pc.removeEventListener('iceconnectionstatechange', onState);
    }
    pc.addEventListener('connectionstatechange', onState);
    pc.addEventListener('iceconnectionstatechange', onState);
  });
}

async function configureSenderForLowLatency(sender) {
  if (!sender?.getParameters || !sender?.setParameters) return;
  const params = sender.getParameters() || {};
  const first = (params.encodings && params.encodings[0]) || {};
  params.encodings = [
    {
      ...first,
      maxBitrate: 64000,
      dtx: 'disabled',
    },
  ];
  try {
    await sender.setParameters(params);
  } catch {
    // Browser support varies; keep defaults if rejected.
  }
}

function waitForOutboundAudioFlow(pc, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    if (!pc) {
      reject(new Error('Peer connection missing'));
      return;
    }
    const start = Date.now();
    let baseline = -1;
    const timer = setInterval(async () => {
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error('WHIP connected but no outbound audio flow'));
        return;
      }
      try {
        const senders = pc.getSenders().filter((s) => s.track?.kind === 'audio');
        for (const sender of senders) {
          const stats = await sender.getStats();
          for (const report of stats.values()) {
            if (report.type !== 'outbound-rtp' || report.kind !== 'audio') continue;
            const sent = Number(report.bytesSent || 0);
            const packets = Number(report.packetsSent || 0);
            if (baseline < 0) {
              baseline = sent;
            } else if (sent > baseline + 200 || packets > 5) {
              clearInterval(timer);
              resolve();
              return;
            }
          }
        }
      } catch {
        // Keep polling until timeout.
      }
    }, 250);
  });
}

function StatusIndicator({ label, active, detail = '' }) {
  return (
    <div
      className={`rounded-md px-0.5 py-0.5 text-xs text-slate-100 ${
        active ? 'bg-emerald-500' : 'bg-slate-700'
      }`}
    >
      <div className="text-center font-medium">{label}</div>
      <div className="text-center text-[0.72rem] opacity-90">{detail || (active ? 'active' : 'idle')}</div>
    </div>
  );
}

export default function VipAudioUploadCard({
  ownRoverId = '',
  audioForwardByRover = {},
  playUploadedAudio,
  stopUploadedAudio,
  startMicWhip,
  readyMicWhip,
  stopMicWhip,
}) {
  const { state: controlState } = useControlSystem();
  const { value: vipAudio, save: saveVipAudio } = useSettingsNamespace('vipAudio', { openMicEnabled: false });

  const roverId = String(ownRoverId || '').trim();
  const [selectedUpload, setSelectedUpload] = useState(null);
  const [working, setWorking] = useState(false);
  const openMicEnabled = Boolean(vipAudio?.openMicEnabled);
  const [micState, setMicState] = useState('idle');
  const [message, setMessage] = useState('');
  const streamRef = useRef(null);
  const audioTrackRef = useRef(null);
  const whipPcRef = useRef(null);
  const micActiveRef = useRef(false);
  const activeRoverRef = useRef('');
  const pttActive = Boolean(controlState?.mic?.pttActive);

  const selectedForwardState = useMemo(
    () => (roverId ? audioForwardByRover?.[roverId] || null : null),
    [audioForwardByRover, roverId],
  );

  const pipelineConnected = Boolean(
    selectedForwardState && selectedForwardState.state !== 'offline' && !selectedForwardState.error,
  );
  const uploadPlaying = Boolean(
    selectedForwardState?.source === 'upload' && selectedForwardState?.state === 'playing',
  );
  const micRelayActive = Boolean(
    selectedForwardState?.source === 'mic-whip' &&
      (selectedForwardState?.state === 'starting' || selectedForwardState?.state === 'playing'),
  );
  const micHot = Boolean(audioTrackRef.current && (openMicEnabled || pttActive));
  const whipLinkActive = micState === 'live' || micState === 'starting';

  const handleUploadPlay = async () => {
    if (!roverId) {
      setMessage('Take control of your rover first.');
      return;
    }
    if (!selectedUpload) {
      setMessage('Select an audio file first.');
      return;
    }
    if (selectedUpload.size > MAX_UPLOAD_BYTES) {
      setMessage(`File too large (max ${MAX_UPLOAD_BYTES} bytes).`);
      return;
    }

    setWorking(true);
    setMessage('');
    try {
      const buffer = await selectedUpload.arrayBuffer();
      const dataBase64 = bytesToBase64(new Uint8Array(buffer));
      await playUploadedAudio?.({
        roverId,
        name: selectedUpload.name,
        mime: selectedUpload.type || '',
        dataBase64,
      });
      setMessage('Upload playback started.');
    } catch (err) {
      setMessage(err?.message || 'Failed to play upload.');
    } finally {
      setWorking(false);
    }
  };

  const handleUploadStop = async () => {
    if (!roverId) {
      setMessage('Take control of your rover first.');
      return;
    }

    setWorking(true);
    setMessage('');
    try {
      await stopUploadedAudio?.(roverId);
      setMessage('Upload playback stopped.');
    } catch (err) {
      setMessage(err?.message || 'Failed to stop upload.');
    } finally {
      setWorking(false);
    }
  };

  const stopMicCapture = useCallback(
    async (targetRoverId) => {
      const target = String(targetRoverId || activeRoverRef.current || '').trim();
      micActiveRef.current = false;
      setMicState('idle');
      if (whipPcRef.current) {
        try {
          whipPcRef.current.getSenders().forEach((sender) => sender.track?.stop());
        } catch {
          // noop
        }
        try {
          whipPcRef.current.close();
        } catch {
          // noop
        }
      }
      whipPcRef.current = null;
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((track) => track.stop());
        } catch {
          // noop
        }
      }
      streamRef.current = null;
      audioTrackRef.current = null;
      if (target) {
        try {
          await stopMicWhip?.(target);
        } catch {
          // noop
        }
      }
      activeRoverRef.current = '';
    },
    [stopMicWhip],
  );

  const startWhipMic = useCallback(
    async (target) => {
      const startPayload = await startMicWhip?.(target);
      const whipUrl = String(startPayload?.whipUrl || '').trim();
      const token = String(startPayload?.token || '').trim();
      if (!whipUrl || !token) {
        throw new Error('WHIP endpoint unavailable');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: TARGET_SAMPLE_RATE,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      const track = stream.getAudioTracks()?.[0];
      audioTrackRef.current = track || null;
      if (track) {
        track.enabled = Boolean(openMicEnabled || pttActive);
      }
      if (track?.applyConstraints) {
        try {
          await track.applyConstraints({
            channelCount: 1,
            sampleRate: TARGET_SAMPLE_RATE,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          });
        } catch {
          // noop
        }
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      whipPcRef.current = pc;
      pc.onconnectionstatechange = () => {
        if (!micActiveRef.current) return;
        const state = pc.connectionState;
        if (state === 'connected') {
          setMicState('live');
          return;
        }
        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          setMicState('error');
          setMessage(`WHIP transport ${state}.`);
        }
      };
      stream.getAudioTracks().forEach((audioTrack) => {
        const sender = pc.addTrack(audioTrack, stream);
        configureSenderForLowLatency(sender);
      });

      const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc, 1800);

      const response = await fetch(whipUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
          ...buildAuthHeader(token),
        },
        body: pc.localDescription?.sdp || offer.sdp,
      });
      if (!response.ok) {
        throw new Error(`WHIP request failed: ${response.status}`);
      }
      const answerSdp = await response.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      await waitForPeerConnected(pc, 10000);
      await waitForOutboundAudioFlow(pc, 6000);
      await readyMicWhip?.(target);
    },
    [openMicEnabled, pttActive, readyMicWhip, startMicWhip],
  );

  useEffect(() => {
    let cancelled = false;

    async function syncMicState() {
      if (!roverId) {
        await stopMicCapture(activeRoverRef.current);
        return;
      }
      if (micActiveRef.current && activeRoverRef.current === roverId) return;
      if (!openMicEnabled && !pttActive) return;

      try {
        setMicState('starting');
        setMessage('');
        micActiveRef.current = true;
        activeRoverRef.current = roverId;
        await startWhipMic(roverId);
        if (!cancelled) {
          setMicState('live');
        }
      } catch (err) {
        if (!cancelled) {
          setMicState('error');
          setMessage(err?.message || 'Failed to start mic forwarding.');
        }
        await stopMicCapture(roverId);
      }
    }

    syncMicState();
    return () => {
      cancelled = true;
    };
  }, [openMicEnabled, pttActive, roverId, startWhipMic, stopMicCapture]);

  useEffect(() => {
    const track = audioTrackRef.current;
    if (!track) return;
    track.enabled = Boolean(openMicEnabled || pttActive);
  }, [openMicEnabled, pttActive]);

  useEffect(
    () => () => {
      stopMicCapture(activeRoverRef.current || roverId);
    },
    [roverId, stopMicCapture],
  );

  return (
    <div className="grid gap-0.5 grid-cols-1 lg:grid-cols-2">
      <section className="surface h-full">
        <div className="grid h-full gap-0.5 grid-rows-[auto_auto_1fr_auto]">
          <p className="text-sm text-slate-200 text-center">Audio Upload</p>

          <label className="mx-auto grid w-full max-w-sm gap-0.5 text-xs text-slate-300 text-center">
            <span>Audio file (mp3 / wav / ogg)</span>
            <input
              className={`${fieldClass} text-center`}
              type="file"
              accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"
              disabled={working || !roverId}
              onChange={(event) => setSelectedUpload(event.target.files?.[0] || null)}
            />
          </label>

          <div className="mx-auto w-full max-w-sm text-center">
            {selectedUpload ? (
              <div className="surface-muted text-xs text-slate-300">
                {selectedUpload.name} ({selectedUpload.size} bytes)
              </div>
            ) : (
              <div className="surface-muted text-xs text-slate-500">No file selected</div>
            )}
          </div>

          <div className="flex justify-center gap-0.5">
            <button type="button" className="button-dark text-sm" disabled={working || !roverId} onClick={handleUploadPlay}>
              {working ? 'Working...' : 'Play Upload'}
            </button>
            <button type="button" className="button-dark text-sm" disabled={working || !roverId} onClick={handleUploadStop}>
              Stop
            </button>
          </div>
        </div>
      </section>

      <section className="surface h-full">
        <div className="grid h-full gap-0.5 grid-rows-[auto_auto_1fr]">
          <p className="text-sm text-slate-200 text-center">Live Microphone</p>
          <label className="surface-muted mx-auto flex w-full max-w-sm items-center justify-center gap-0.5 px-0.5 py-0.5 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={openMicEnabled}
              disabled={!roverId}
              onChange={(event) => saveVipAudio((current) => ({ ...(current || {}), openMicEnabled: Boolean(event.target.checked) }))}
            />
            <span>Open mic</span>
          </label>
          <div className="grid gap-0.5 content-start">
            <StatusIndicator label="WHIP link" active={whipLinkActive} detail={micState} />
            <StatusIndicator label="Mic hot" active={micHot} detail={micHot ? 'transmitting' : 'muted'} />
            <div className="surface-muted text-center text-xs text-slate-400">PTT key: {controlState?.keymap?.micPtt?.[0] || 'm'} (hold)</div>
          </div>
        </div>
      </section>

      <section className="surface lg:col-span-2">
        <div className="space-y-0.5">
          <p className="text-sm text-slate-200 text-center">Audio Status</p>
          <div className="grid gap-0.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
            <StatusIndicator label="Forward pipe" active={pipelineConnected} detail={pipelineConnected ? 'connected' : 'offline'} />
            <StatusIndicator label="Upload playback" active={uploadPlaying} detail={uploadPlaying ? 'playing' : 'idle'} />
            <StatusIndicator label="Mic relay" active={micRelayActive} detail={micRelayActive ? 'active' : 'idle'} />
            <StatusIndicator label="WHIP transport" active={whipLinkActive} detail={micState} />
            <StatusIndicator label="Mic transmit" active={micHot} detail={micHot ? 'hot' : 'muted'} />
          </div>
          {message ? <div className="text-xs text-slate-400 text-center">{message}</div> : null}
        </div>
      </section>
    </div>
  );
}
