// Volume Settings Card
// Purpose: Lets any user set their own horn, TTS, and mic-forward volume.
// Scope: Renders the server-resolved ceilings; the server still owns every limit.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CardFrame from '../CardFrame/index.jsx';
import { useSession } from '../../context/SessionContext.jsx';

/*
  Sliders are a 0-1 fraction of whichever ceiling the server resolved for this
  user, so the same three keys describe the fraction, the ceiling, and the gain
  the rover will actually apply.
*/
const GAIN_FIELDS = [
  { key: 'hornGain', label: 'Horn volume' },
  { key: 'ttsGain', label: 'Text-to-speech volume' },
  { key: 'forwardGain', label: 'Microphone volume' },
];

// Dragging a range input fires continuously; persist once the user settles.
const COMMIT_DEBOUNCE_MS = 300;

function clampFraction(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function normalizeValues(raw) {
  const out = {};
  GAIN_FIELDS.forEach(({ key }) => {
    out[key] = clampFraction(raw?.[key], 1);
  });
  return out;
}

function formatGain(value) {
  const num = Number(value);
  return `${Number.isFinite(num) ? num.toFixed(2) : '0.00'}x`;
}

export default function VolumeSettingsCard() {
  const { session, setUserAudioGains } = useSession();
  const audioGains = session?.audioGains || null;
  const serverValues = useMemo(() => normalizeValues(audioGains?.values), [audioGains?.values]);
  const ceilings = audioGains?.ceilings || {};
  const boostGranted = Boolean(audioGains?.boostGranted);

  const [draft, setDraft] = useState(serverValues);
  const [error, setError] = useState(null);
  const commitTimerRef = useRef(null);
  const pendingRef = useRef(null);

  /*
    The server is authoritative, so an accepted save or an admin-side change
    resyncs the sliders. Comparing the serialized values keeps a resync from
    fighting a drag that is already in flight.
  */
  useEffect(() => {
    if (pendingRef.current) return;
    setDraft(serverValues);
  }, [serverValues]);

  const commit = useCallback(
    async (next) => {
      pendingRef.current = next;
      try {
        await setUserAudioGains(next);
        setError(null);
      } catch (err) {
        setError(err?.message || 'Failed to save volume');
        setDraft(serverValues);
      } finally {
        pendingRef.current = null;
      }
    },
    [serverValues, setUserAudioGains],
  );

  useEffect(() => () => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
  }, []);

  const handleChange = (key) => (event) => {
    const next = clampFraction(event.target.value, 0);
    const nextDraft = { ...draft, [key]: next };
    setDraft(nextDraft);
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => commit(nextDraft), COMMIT_DEBOUNCE_MS);
  };

  // Sliders would be misleading before the first session sync lands.
  if (!audioGains) return null;

  return (
    <CardFrame title="Volume" className="lg:col-span-2" bodyClassName="space-y-1 p-1 text-sm">
      {GAIN_FIELDS.map(({ key, label }) => {
        const ceiling = Number.isFinite(Number(ceilings[key])) ? Number(ceilings[key]) : 0;
        const fraction = clampFraction(draft[key], 1);
        const muted = ceiling <= 0;
        return (
          <label
            key={key}
            className="mx-auto block w-full max-w-lg rounded bg-neutral-800/80 px-1.5 py-1 text-sm text-white"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
              <span className="min-w-0 font-semibold text-white">{label}</span>
              <span className="rounded bg-neutral-900 px-1 py-0.5 text-xs text-white">
                {Math.round(fraction * 100)}% · {formatGain(fraction * ceiling)}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={fraction}
              onChange={handleChange(key)}
              className="mt-1 w-full accent-emerald-500 disabled:opacity-50"
              disabled={muted}
            />
            <span className="text-xs text-slate-400">
              {muted ? 'Muted by admin gain settings.' : `100% = ${formatGain(ceiling)} (your current limit)`}
            </span>
          </label>
        );
      })}
      <p className="mx-auto w-full max-w-lg text-xs leading-snug text-white">
        {boostGranted
          ? 'You have a raised volume limit. 100% is the admin-set hard cap for boosted users rather than the normal global gain.'
          : 'Your limit is the global gain an admin has set. Admins can raise it per user.'}
      </p>
      {error && <p className="mx-auto w-full max-w-lg text-xs text-rose-300">{error}</p>}
    </CardFrame>
  );
}
