import { useMemo, useState } from 'react';
import { fieldClass, flowWrapClass, innerFlowClass } from './constants.js';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export default function VipAudioUploadCard({
  ownRoverId = '',
  audioForwardByRover = {},
  playUploadedAudio,
  stopUploadedAudio,
}) {
  const roverId = String(ownRoverId || '').trim();
  const [selectedUpload, setSelectedUpload] = useState(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');

  const selectedForwardState = useMemo(
    () => (roverId ? audioForwardByRover?.[roverId] || null : null),
    [audioForwardByRover, roverId],
  );

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

  return (
    <section className={`surface ${flowWrapClass}`}>
      <div className={innerFlowClass}>
        <p className="text-sm text-slate-300">VIP Audio Upload</p>
        <label className="grid w-full gap-0.5 text-xs text-slate-300">
          <span>Audio file (mp3 / wav / ogg)</span>
          <input
            className={fieldClass}
            type="file"
            accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"
            disabled={working || !roverId}
            onChange={(event) => setSelectedUpload(event.target.files?.[0] || null)}
          />
        </label>
        {selectedUpload ? (
          <div className="surface-muted mx-auto w-full max-w-sm text-xs text-slate-300 text-center">
            {selectedUpload.name} ({selectedUpload.size} bytes)
          </div>
        ) : null}
        <div className="flex justify-center gap-0.5">
          <button type="button" className="button-dark text-sm" disabled={working || !roverId} onClick={handleUploadPlay}>
            {working ? 'Working...' : 'Play Upload'}
          </button>
          <button type="button" className="button-dark text-sm" disabled={working || !roverId} onClick={handleUploadStop}>
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
