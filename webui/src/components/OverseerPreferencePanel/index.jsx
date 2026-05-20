import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';

export default function OverseerPreferencePanel() {
  const { identifySession } = useSessionActions();
  const sessionIdentity = useSessionSelector((state) => state.session?.identity || null);
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
    <section className="surface p-1.5 text-xs text-slate-200">
      <div className="space-y-1">
        <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400">Overseer Vote</div>
        <label className="flex items-center gap-2 rounded border border-slate-700/70 bg-slate-900/60 px-2 py-1.5">
          <input type="checkbox" checked={enabled} onChange={onToggle} />
          <span className="text-slate-100">Enable Overseer for me</span>
        </label>
      </div>

      <div className="mt-1.5 grid grid-cols-2 gap-1">
        <div className="rounded border border-slate-700/70 bg-slate-900/50 px-2 py-1">
          <div className="text-[0.6rem] uppercase tracking-wide text-slate-500">Running</div>
          <div className={running ? 'font-semibold text-emerald-300' : 'font-semibold text-slate-300'}>
            {running ? 'YES' : 'NO'}
          </div>
        </div>
        <div className="rounded border border-slate-700/70 bg-slate-900/50 px-2 py-1">
          <div className="text-[0.6rem] uppercase tracking-wide text-slate-500">Your vote</div>
          <div className="font-semibold text-slate-200">{(sessionIdentity?.overseerEnabled ?? enabled) ? 'YES' : 'NO'}</div>
        </div>
      </div>

      <div className="mt-1.5 rounded border border-slate-700/70 bg-slate-900/50 px-2 py-1 text-[0.65rem] text-slate-400">
        yes {Number(vote?.yesCount || 0)} / no {Number(vote?.noCount || 0)} / online {Number(vote?.eligibleCount || vote?.onlineCount || 0)}
      </div>
    </section>
  );
}
