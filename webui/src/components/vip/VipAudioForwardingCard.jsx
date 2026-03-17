import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_UPLOAD_BYTES,
  bytesToBase64,
  fieldClass,
  flowWrapClass,
  innerFlowClass,
} from './constants.js';
import { useControlSystem } from '../../controls/index.js';

export default function VipAudioForwardingCard({
  roster = [],
  ownRoverId = '',
  audioForwardByRover = {},
  playUploadedAudio,
  stopUploadedAudio,
  startMicForward,
  stopMicForward,
  sendMicChunk,
}) {
  const { state: controlState } = useControlSystem();
  const [selectedUpload, setSelectedUpload] = useState(null);
  const [working, setWorking] = useState(false);
  const [openMicEnabled, setOpenMicEnabled] = useState(false);
  const [micState, setMicState] = useState('idle');
  const [message, setMessage] = useState('');
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
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
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== 'inactive') {
          recorder.stop();
        }
      } catch {
        // noop
      }
      recorderRef.current = null;
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
          await stopMicForward?.(target);
        } catch {
          // noop
        }
      }
      activeRoverRef.current = '';
    },
    [stopMicForward],
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
      if (typeof MediaRecorder === 'undefined') {
        throw new Error('MediaRecorder is not supported in this browser.');
      }
      await stopMicCapture(target);
      setMicState('starting');
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;
        await startMicForward?.(target);
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
        const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
        recorderRef.current = recorder;
        micActiveRef.current = true;
        activeRoverRef.current = target;
        recorder.ondataavailable = async (event) => {
          try {
            if (!micActiveRef.current || !event.data || event.data.size <= 0) return;
            const buffer = await event.data.arrayBuffer();
            const base64 = bytesToBase64(new Uint8Array(buffer));
            sendMicChunk?.({ roverId: target, dataBase64: base64 });
          } catch {
            // noop
          }
        };
        recorder.onstop = () => {
          if (!micActiveRef.current) return;
          micActiveRef.current = false;
          setMicState('idle');
        };
        recorder.start(120);
        setMicState('live');
      } catch (err) {
        if (stream) {
          try {
            stream.getTracks().forEach((track) => track.stop());
          } catch {
            // noop
          }
        }
        streamRef.current = null;
        throw err;
      }
    },
    [sendMicChunk, startMicForward, stopMicCapture],
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
