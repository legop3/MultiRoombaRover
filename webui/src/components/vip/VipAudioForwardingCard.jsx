import { useMemo, useState } from 'react';
import {
  MAX_UPLOAD_BYTES,
  bytesToBase64,
  fieldClass,
  flowWrapClass,
  innerFlowClass,
} from './constants.js';

export default function VipAudioForwardingCard({
  roster = [],
  ownRoverId = '',
  audioForwardByRover = {},
  playUploadedAudio,
  stopUploadedAudio,
}) {
  const [selectedUpload, setSelectedUpload] = useState(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const singleRoverId = roster.length === 1 ? roster[0].id : '';
  const targetRoverId = String(singleRoverId || ownRoverId || '').trim();
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
