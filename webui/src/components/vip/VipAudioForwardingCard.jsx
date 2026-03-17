import { useMemo, useState } from 'react';
import { MAX_UPLOAD_BYTES, bytesToBase64, fieldClass } from './constants.js';

export default function VipAudioForwardingCard({
  roster = [],
  audioForwardByRover = {},
  playUploadedAudio,
  stopUploadedAudio,
  onMessage,
}) {
  const [selectedRoverId, setSelectedRoverId] = useState('');
  const [selectedUpload, setSelectedUpload] = useState(null);
  const [working, setWorking] = useState(false);
  const selectedForwardState = useMemo(
    () => (selectedRoverId ? audioForwardByRover?.[selectedRoverId] || null : null),
    [audioForwardByRover, selectedRoverId],
  );

  const handleUploadPlay = async () => {
    const roverId = String(selectedRoverId || '').trim();
    if (!roverId) {
      onMessage?.('Select a rover first.');
      return;
    }
    if (!selectedUpload) {
      onMessage?.('Select an audio file first.');
      return;
    }
    if (selectedUpload.size > MAX_UPLOAD_BYTES) {
      onMessage?.(`File too large (max ${MAX_UPLOAD_BYTES} bytes).`);
      return;
    }
    setWorking(true);
    onMessage?.('');
    try {
      const buffer = await selectedUpload.arrayBuffer();
      const base64 = bytesToBase64(new Uint8Array(buffer));
      await playUploadedAudio?.({
        roverId,
        name: selectedUpload.name,
        mime: selectedUpload.type || '',
        dataBase64: base64,
      });
      onMessage?.(`Playing upload on ${roverId}.`);
    } catch (err) {
      onMessage?.(err.message || 'Failed to play upload.');
    } finally {
      setWorking(false);
    }
  };

  const handleUploadStop = async () => {
    const roverId = String(selectedRoverId || '').trim();
    if (!roverId) {
      onMessage?.('Select a rover first.');
      return;
    }
    setWorking(true);
    onMessage?.('');
    try {
      await stopUploadedAudio?.(roverId);
      onMessage?.(`Stopped upload on ${roverId}.`);
    } catch (err) {
      onMessage?.(err.message || 'Failed to stop upload.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="surface space-y-0.5 text-sm text-slate-200">
      <p className="text-slate-300">VIP Audio Forwarding</p>
      <label className="grid gap-0.5 text-xs text-slate-300">
        <span>Target rover</span>
        <select
          className={fieldClass}
          value={selectedRoverId}
          onChange={(event) => setSelectedRoverId(event.target.value)}
          disabled={working}
        >
          <option value="">Select rover</option>
          {roster.map((rover) => (
            <option key={rover.id} value={rover.id}>
              {rover.name || rover.id}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-0.5 text-xs text-slate-300">
        <span>Audio file (mp3 / wav / ogg)</span>
        <input
          className={fieldClass}
          type="file"
          accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"
          disabled={working}
          onChange={(event) => setSelectedUpload(event.target.files?.[0] || null)}
        />
      </label>
      {selectedUpload ? (
        <div className="surface-muted text-xs text-slate-300 text-center">
          {selectedUpload.name} ({selectedUpload.size} bytes)
        </div>
      ) : null}
      <div className="flex justify-center gap-0.5">
        <button type="button" className="button-dark text-sm" disabled={working} onClick={handleUploadPlay}>
          {working ? 'Working...' : 'Play Upload'}
        </button>
        <button type="button" className="button-dark text-sm" disabled={working} onClick={handleUploadStop}>
          Stop
        </button>
      </div>
      {selectedForwardState ? (
        <div className="surface-muted text-xs text-slate-300 text-center">
          state: {selectedForwardState.state || 'idle'}
          {selectedForwardState.error ? ` | error: ${selectedForwardState.error}` : ''}
        </div>
      ) : null}
    </section>
  );
}
