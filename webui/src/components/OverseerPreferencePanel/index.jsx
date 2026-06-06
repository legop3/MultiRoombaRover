import { useState } from 'react';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import CardFrame from '../CardFrame/index.jsx';

function formatUpdatedAt(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function OverseerMemoryPopup({ memory, onClose }) {
  const summary = typeof memory?.summary === 'string' && memory.summary.trim() ? memory.summary : 'Memory unavailable.';
  const updatedAt = formatUpdatedAt(memory?.updatedAt);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-1"
      onClick={onClose}
    >
      <div className="w-full max-w-2xl" onClick={(event) => event.stopPropagation()}>
        <CardFrame
          title="Overseer memory"
          meta={updatedAt ? `Updated ${updatedAt}` : null}
          actions={
            <button type="button" onClick={onClose} className="button-dark px-1 py-0.25 text-[0.75rem]">
              Close
            </button>
          }
          bodyClassName="p-0.5 text-xs"
        >
          {/* The memory is rendered as the server's existing plain-text summary so
              this popup stays consistent with the overseer/admin debug display. */}
          <pre className="surface max-h-[70vh] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[0.72rem] text-slate-200">{summary}</pre>
        </CardFrame>
      </div>
    </div>
  );
}

export default function OverseerPreferencePanel() {
  const { identifySession } = useSessionActions();
  const vote = useSessionSelector((state) => state.session?.overseerVote || null);
  const overseerMemory = useSessionSelector((state) => state.overseerMemory || null);
  const { value: profile } = useSettingsNamespace('profile', { nickname: '' });
  const { value: identity } = useSettingsNamespace('identity', { cookieUserId: '' });
  const { value, save } = useSettingsNamespace('overseerPreference', { enabled: false });
  const [memoryOpen, setMemoryOpen] = useState(false);
  const enabled = Boolean(value?.enabled);
  const running = Boolean(vote?.running);

  const onToggle = async (event) => {
    const next = Boolean(event?.target?.checked);
    await save((current) => ({ ...(current || {}), enabled: next }));
    await identifySession({
      cookieUserId: String(identity?.cookieUserId || '').trim(),
      nickname: String(profile?.nickname || '').trim(),
      overseerEnabled: next,
    });
  };

  const actions = (
    <button
      type="button"
      onClick={() => setMemoryOpen(true)}
      className="button-dark px-1 py-0.25 text-[0.75rem]"
      title="View overseer memory"
    >
      Memory
    </button>
  );

  return (
    <>
      <CardFrame title="Overseer vote" actions={actions} bodyClassName="space-y-0.5 text-center text-xs text-slate-200">
        <label
          className={`flex items-center justify-center gap-1.5 rounded px-1 py-0.5 ${
            enabled ? 'bg-emerald-600/80 text-emerald-50' : 'bg-slate-600/70 text-slate-100'
          }`}
        >
          <input type="checkbox" checked={enabled} onChange={onToggle} />
          <span>Your vote: {enabled ? 'Yes' : 'No'}</span>
        </label>
        <span className="text-xs">Enable a local LLM in chat</span>

        <div className="mt-0.5 text-slate-400">
          Yes!: {Number(vote?.yesCount || 0)}, No...: {Number(vote?.noCount || 0)}
        </div>
        <div className="mt-0.5 flex justify-center">
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[0.7rem] font-medium ${
              running ? 'bg-emerald-600/80 text-emerald-50' : 'bg-slate-600/70 text-slate-100'
            }`}
          >
            {running ? 'Running!' : 'Stopped by vote.'}
          </span>
        </div>
      </CardFrame>
      {memoryOpen ? <OverseerMemoryPopup memory={overseerMemory} onClose={() => setMemoryOpen(false)} /> : null}
    </>
  );
}
