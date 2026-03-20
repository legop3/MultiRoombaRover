import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_UPLOAD_BYTES,
  bytesToBase64,
  fieldClass,
  flowWrapClass,
  innerFlowClass,
} from './constants.js';
import { useControlSystem } from '../../controls/index.js';

const TARGET_SAMPLE_RATE = 16000;
const MIC_PACKET_MS = 40;
const MIC_PACKET_BYTES = (TARGET_SAMPLE_RATE * 2 * MIC_PACKET_MS) / 1000; // s16le mono
const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

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

function resampleTo16k(input, sampleRate) {
  if (!input || !input.length) return new Float32Array(0);
  if (sampleRate === TARGET_SAMPLE_RATE) return input;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return input;
  const ratio = sampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let outIdx = 0; outIdx < outputLength; outIdx += 1) {
    const src = outIdx * ratio;
    const srcFloor = Math.floor(src);
    const srcCeil = Math.min(input.length - 1, srcFloor + 1);
    const frac = src - srcFloor;
    const a = input[srcFloor] ?? 0;
    const b = input[srcCeil] ?? a;
    output[outIdx] = a + (b - a) * frac;
  }
  return output;
}

function floatToInt16Bytes(floatSamples) {
  const bytes = new Uint8Array(floatSamples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < floatSamples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, floatSamples[i]));
    const int16 = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    view.setInt16(i * 2, int16, true);
  }
  return bytes;
}

function concatUint8(chunks = [], totalLength = 0) {
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export default function VipAudioForwardingCard({
  roster = [],
  ownRoverId = '',
  audioForwardByRover = {},
  playUploadedAudio,
  stopUploadedAudio,
  startMicForward,
  stopMicForward,
  sendMicChunk,
  startMicWhip,
  stopMicWhip,
}) {
  const { state: controlState } = useControlSystem();
  const [selectedUpload, setSelectedUpload] = useState(null);
  const [working, setWorking] = useState(false);
  const [openMicEnabled, setOpenMicEnabled] = useState(false);
  const [micState, setMicState] = useState('idle');
  const [message, setMessage] = useState('');
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaSourceRef = useRef(null);
  const processorRef = useRef(null);
  const sinkRef = useRef(null);
  const pendingPcmChunksRef = useRef([]);
  const pendingPcmBytesRef = useRef(0);
  const whipPcRef = useRef(null);
  const micTransportRef = useRef('none');
  const whipFailoverRef = useRef(false);
  const micActiveRef = useRef(false);
  const activeRoverRef = useRef('');
  const singleRoverId = roster.length === 1 ? roster[0].id : '';
  const targetRoverId = String(singleRoverId || ownRoverId || '').trim();
  const pttActive = Boolean(controlState?.mic?.pttActive);
  const selectedForwardState = useMemo(
    () => (targetRoverId ? audioForwardByRover?.[targetRoverId] || null : null),
    [audioForwardByRover, targetRoverId],
  );

  const handleUploadPlay = async () => {
    const roverId = targetRoverId;
    if (!roverId) {
      setMessage('Take control of a rover first.');
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
      const base64 = bytesToBase64(new Uint8Array(buffer));
      await playUploadedAudio?.({
        roverId,
        name: selectedUpload.name,
        mime: selectedUpload.type || '',
        dataBase64: base64,
      });
      setMessage(`Playing upload on ${roverId}.`);
    } catch (err) {
      setMessage(err.message || 'Failed to play upload.');
    } finally {
      setWorking(false);
    }
  };

  const handleUploadStop = async () => {
    const roverId = targetRoverId;
    if (!roverId) {
      setMessage('Take control of a rover first.');
      return;
    }
    setWorking(true);
    setMessage('');
    try {
      await stopUploadedAudio?.(roverId);
      setMessage(`Stopped upload on ${roverId}.`);
    } catch (err) {
      setMessage(err.message || 'Failed to stop upload.');
    } finally {
      setWorking(false);
    }
  };

  const stopMicCapture = useCallback(
    async (roverId) => {
      const target = String(roverId || activeRoverRef.current || '').trim();
      micActiveRef.current = false;
      setMicState('idle');
      try {
        if (processorRef.current && mediaSourceRef.current) {
          mediaSourceRef.current.disconnect(processorRef.current);
        }
      } catch {
        // noop
      }
      try {
        if (processorRef.current && sinkRef.current) {
          processorRef.current.disconnect(sinkRef.current);
        }
      } catch {
        // noop
      }
      try {
        if (sinkRef.current && audioContextRef.current?.destination) {
          sinkRef.current.disconnect(audioContextRef.current.destination);
        }
      } catch {
        // noop
      }
      if (audioContextRef.current) {
        try {
          await audioContextRef.current.close();
        } catch {
          // noop
        }
      }
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
      processorRef.current = null;
      mediaSourceRef.current = null;
      sinkRef.current = null;
      audioContextRef.current = null;
      pendingPcmChunksRef.current = [];
      pendingPcmBytesRef.current = 0;
      whipFailoverRef.current = false;
      micTransportRef.current = 'none';
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((track) => track.stop());
        } catch {
          // noop
        }
      }
      streamRef.current = null;
      if (target) {
        try {
          await stopMicWhip?.(target);
        } catch {
          // noop
        }
        try {
          await stopMicForward?.(target);
        } catch {
          // noop
        }
      }
      activeRoverRef.current = '';
    },
    [stopMicForward, stopMicWhip],
  );

  const startSocketBridge = useCallback(
    async (target, stream) => {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error('Web Audio API is not supported in this browser.');
      }
      await startMicForward?.(target);
      const audioContext = new AudioContextCtor({ latencyHint: 'interactive' });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      mediaSourceRef.current = source;
      const processor = audioContext.createScriptProcessor(1024, 1, 1);
      processorRef.current = processor;
      const sink = audioContext.createGain();
      sink.gain.value = 0;
      sinkRef.current = sink;
      pendingPcmChunksRef.current = [];
      pendingPcmBytesRef.current = 0;
      micTransportRef.current = 'socket';

      processor.onaudioprocess = (event) => {
        if (!micActiveRef.current || micTransportRef.current !== 'socket') return;
        const input = event.inputBuffer?.getChannelData(0);
        if (!input || input.length === 0) return;
        const resampled = resampleTo16k(input, audioContext.sampleRate);
        if (!resampled.length) return;
        const pcmBytes = floatToInt16Bytes(resampled);
        pendingPcmChunksRef.current.push(pcmBytes);
        pendingPcmBytesRef.current += pcmBytes.length;

        while (pendingPcmBytesRef.current >= MIC_PACKET_BYTES) {
          const merged = concatUint8(pendingPcmChunksRef.current, pendingPcmBytesRef.current);
          const packet = merged.slice(0, MIC_PACKET_BYTES);
          const rest = merged.slice(MIC_PACKET_BYTES);
          pendingPcmChunksRef.current = rest.length ? [rest] : [];
          pendingPcmBytesRef.current = rest.length;
          sendMicChunk?.({ roverId: target, data: packet });
        }
      };

      source.connect(processor);
      processor.connect(sink);
      sink.connect(audioContext.destination);
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      setMicState('live');
    },
    [sendMicChunk, startMicForward],
  );

  const startWhipBridge = useCallback(
    async (target, stream) => {
      const startPayload = await startMicWhip?.(target);
      const whipUrl = String(startPayload?.whipUrl || '').trim();
      const token = String(startPayload?.token || '').trim();
      if (!whipUrl || !token) {
        throw new Error('WHIP endpoint unavailable');
      }
      const pc = new RTCPeerConnection(RTC_CONFIG);
      whipPcRef.current = pc;
      micTransportRef.current = 'whip';
      whipFailoverRef.current = false;
      try {
        stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
        pc.onconnectionstatechange = () => {
          const state = pc.connectionState;
          if (!micActiveRef.current) return;
          if (state === 'connected') {
            setMicState('live');
            return;
          }
          if ((state === 'failed' || state === 'disconnected') && !whipFailoverRef.current) {
            whipFailoverRef.current = true;
            const roverId = activeRoverRef.current;
            if (!roverId || !streamRef.current) return;
            (async () => {
              try {
                await stopMicWhip?.(roverId);
              } catch {
                // noop
              }
              if (!micActiveRef.current || micTransportRef.current !== 'whip') return;
              try {
                await startSocketBridge(roverId, streamRef.current);
              } catch (err) {
                setMicState('error');
                setMessage(err?.message || 'Mic fallback failed.');
              }
            })();
          }
        };

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
        setMicState('live');
      } catch (err) {
        try {
          pc.close();
        } catch {
          // noop
        }
        if (whipPcRef.current === pc) {
          whipPcRef.current = null;
        }
        micTransportRef.current = 'none';
        throw err;
      }
    },
    [startMicWhip, startSocketBridge, stopMicWhip],
  );

  const startMicCapture = useCallback(
    async (roverId) => {
      const target = String(roverId || '').trim();
      if (!target) {
        throw new Error('Take control of a rover first.');
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone capture is not supported in this browser.');
      }
      await stopMicCapture(target);
      setMicState('starting');
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: TARGET_SAMPLE_RATE,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;
        micActiveRef.current = true;
        activeRoverRef.current = target;
        let whipErr = null;
        try {
          await startWhipBridge(target, stream);
          return;
        } catch (err) {
          whipErr = err;
          try {
            await stopMicWhip?.(target);
          } catch {
            // noop
          }
        }
        await startSocketBridge(target, stream);
        if (whipErr) {
          setMessage(`WHIP unavailable, using socket fallback: ${whipErr.message || 'unknown error'}`);
        }
      } catch (err) {
        if (stream) {
          try {
            stream.getTracks().forEach((track) => track.stop());
          } catch {
            // noop
          }
        }
        streamRef.current = null;
        audioContextRef.current = null;
        mediaSourceRef.current = null;
        processorRef.current = null;
        sinkRef.current = null;
        whipPcRef.current = null;
        micTransportRef.current = 'none';
        throw err;
      }
    },
    [startSocketBridge, startWhipBridge, stopMicCapture, stopMicWhip],
  );

  useEffect(() => {
    const desiredActive = Boolean(openMicEnabled || pttActive);
    const roverId = targetRoverId;
    let cancelled = false;
    async function syncMicState() {
      if (!roverId || !desiredActive) {
        await stopMicCapture(activeRoverRef.current || roverId);
        return;
      }
      if (micActiveRef.current && activeRoverRef.current === roverId) return;
      try {
        await startMicCapture(roverId);
      } catch (err) {
        if (!cancelled) {
          setMicState('error');
          setMessage(err?.message || 'Failed to start microphone forwarding.');
        }
      }
    }
    syncMicState();
    return () => {
      cancelled = true;
    };
  }, [openMicEnabled, pttActive, startMicCapture, stopMicCapture, targetRoverId]);

  useEffect(
    () => () => {
      stopMicCapture(activeRoverRef.current);
    },
    [stopMicCapture],
  );

  return (
    <section className={`surface ${flowWrapClass}`}>
      <div className={innerFlowClass}>
        <p className="text-sm text-slate-300">VIP Audio Forwarding</p>
        <label className="grid w-full gap-0.5 text-xs text-slate-300">
          <span>Audio file (mp3 / wav / ogg)</span>
          <input
            className={fieldClass}
            type="file"
            accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"
            disabled={working || !targetRoverId}
            onChange={(event) => setSelectedUpload(event.target.files?.[0] || null)}
          />
        </label>
        {selectedUpload ? (
          <div className="surface-muted mx-auto w-full max-w-sm text-xs text-slate-300 text-center">
            {selectedUpload.name} ({selectedUpload.size} bytes)
          </div>
        ) : null}
        <div className="flex justify-center gap-0.5">
          <button type="button" className="button-dark text-sm" disabled={working || !targetRoverId} onClick={handleUploadPlay}>
            {working ? 'Working...' : 'Play Upload'}
          </button>
          <button type="button" className="button-dark text-sm" disabled={working || !targetRoverId} onClick={handleUploadStop}>
            Stop
          </button>
        </div>
        <div className="surface-muted mx-auto flex w-full max-w-sm flex-col gap-0.5 p-0.5 text-xs text-slate-300 text-center">
          <p className="text-slate-200">Microphone Forwarding</p>
          <label className="flex items-center justify-center gap-0.5">
            <input
              type="checkbox"
              checked={openMicEnabled}
              disabled={!targetRoverId}
              onChange={(event) => setOpenMicEnabled(Boolean(event.target.checked))}
            />
            <span>Open mic</span>
          </label>
          <p className="text-slate-400">PTT key: {controlState?.keymap?.micPtt?.[0] || 'v'} (hold)</p>
          <p className="text-slate-400">mic: {micState}</p>
          <p className="text-slate-500">transport: {micTransportRef.current === 'none' ? 'idle' : micTransportRef.current}</p>
        </div>
        {selectedForwardState ? (
          <div className="surface-muted mx-auto w-full max-w-sm text-xs text-slate-300 text-center">
            state: {selectedForwardState.state || 'idle'}
            {selectedForwardState.error ? ` | error: ${selectedForwardState.error}` : ''}
          </div>
        ) : null}
        {message ? <div className="text-xs text-slate-400 text-center">{message}</div> : null}
      </div>
    </section>
  );
}
