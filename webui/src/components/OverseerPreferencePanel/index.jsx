import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';

export default function OverseerPreferencePanel() {
  const { identifySession } = useSessionActions();
  const vote = useSessionSelector((state) => state.session?.overseerVote || null);
  const { value: profile } = useSettingsNamespace('profile', { nickname: '' });
  const { value: identity } = useSettingsNamespace('identity', { cookieUserId: '' });
  const { value, save } = useSettingsNamespace('overseerPreference', { enabled: true });
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

  return (
    <section className="surface p-1 text-xs text-slate-200 text-center">
      <label className="flex items-center justify-center gap-1.5">
        <input type="checkbox" checked={enabled} onChange={onToggle} />
        <span>Enable Overseer LLM</span>
      </label>
      <div className="mt-0.5 text-slate-400">
        Yes?: {Number(vote?.yesCount || 0)}, No!: {Number(vote?.noCount || 0)}
      </div>
      <div className="mt-0.5 flex justify-center">
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[0.7rem] font-medium ${
            running ? 'bg-emerald-600/80 text-emerald-50' : 'bg-slate-600/70 text-slate-100'
          }`}
        >
          {running ? 'Running!' : 'Stopped...'}
        </span>
      </div>
    </section>
  );
}
