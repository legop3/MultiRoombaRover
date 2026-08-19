// Personal Volume Adjustment Card
// Purpose: Lets an approved user offset horn, text-to-speech, and microphone output around server-owned base levels.
// Scope: Persists signed percentages in roverSettings while the server owns permission, clamping, and gain conversion.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CardFrame from '../CardFrame/index.jsx';
import { useSession } from '../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';

const ADJUSTMENT_FIELDS = [
  { key: 'hornPercent', label: 'Horn volume' },
  { key: 'ttsPercent', label: 'Text-to-speech volume' },
  { key: 'forwardPercent', label: 'Microphone volume' },
];
const DEFAULT_ADJUSTMENTS = { hornPercent: 0, ttsPercent: 0, forwardPercent: 0 };
const COMMIT_DEBOUNCE_MS = 300;

function clampPercent(value, maximum) {
  const number = Number(value);
  const limit = Math.max(0, Number(maximum) || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(Math.max(-limit, Math.min(limit, number)));
}

function normalizeAdjustments(raw, maximum) {
  const normalized = {};
  ADJUSTMENT_FIELDS.forEach(({ key }) => {
    normalized[key] = clampPercent(raw?.[key], maximum);
  });
  return normalized;
}

function formatPercent(value) {
  const number = Number(value) || 0;
  return `${number > 0 ? '+' : ''}${number}%`;
}

export default function VolumeSettingsCard() {
  const { session, setPersonalAudioAdjustments } = useSession();
  const { value: savedAdjustments, save: saveAdjustments } = useSettingsNamespace(
    'audioAdjustments',
    DEFAULT_ADJUSTMENTS,
  );
  const serverState = session?.audioAdjustments || null;
  const allowed = Boolean(serverState?.allowed);
  const maximum = Math.max(0, Number(serverState?.maxAdjustmentPercent) || 0);
  const normalizedSaved = useMemo(
    () => normalizeAdjustments(savedAdjustments, maximum),
    [maximum, savedAdjustments],
  );
  const [draft, setDraft] = useState(normalizedSaved);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    setDraft(normalizedSaved);
  }, [normalizedSaved]);

  const commit = useCallback(async (next) => {
    const normalized = normalizeAdjustments(next, maximum);
    // Saving first makes the cookie the durable source used by every reconnect
    // and session:identify update. The socket call applies it immediately to a
    // rover the current browser may already control.
    saveAdjustments(normalized);
    try {
      await setPersonalAudioAdjustments(normalized);
      setError(null);
    } catch (err) {
      setError(err?.message || 'Failed to apply volume adjustments');
    }
  }, [maximum, saveAdjustments, setPersonalAudioAdjustments]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handleChange = (key) => (event) => {
    const next = { ...draft, [key]: clampPercent(event.target.value, maximum) };
    setDraft(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(next), COMMIT_DEBOUNCE_MS);
  };

  if (!serverState) return null;

  return (
    <CardFrame title="Personal volume adjustment" className="@[28rem]:col-span-2" bodyClassName="space-y-1 p-1 text-sm">
      {ADJUSTMENT_FIELDS.map(({ key, label }) => (
        <label key={key} className="mx-auto block w-full max-w-lg rounded bg-neutral-800/80 px-1.5 py-1 text-white">
          <div className="flex items-center justify-between gap-1.5">
            <span className="min-w-0 font-semibold text-white">{label}</span>
            <span className="rounded bg-neutral-900 px-1 py-0.5 text-xs text-white">
              {formatPercent(draft[key])}
            </span>
          </div>
          <input
            type="range"
            min={-maximum}
            max={maximum}
            step="1"
            value={clampPercent(draft[key], maximum)}
            onChange={handleChange(key)}
            className="mt-1 w-full accent-emerald-500 disabled:opacity-50"
            disabled={!allowed || maximum <= 0}
          />
          <span className="text-xs text-slate-400">
            {allowed
              ? `Allowed range: -${maximum}% to +${maximum}%. Center is no adjustment.`
              : 'An administrator must approve personal volume adjustments for your user.'}
          </span>
        </label>
      ))}
      {error && <p className="mx-auto w-full max-w-lg text-xs text-rose-300">{error}</p>}
    </CardFrame>
  );
}
