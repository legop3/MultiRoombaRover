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
    <section className="surface p-1 text-xs text-slate-200">
      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={enabled} onChange={onToggle} />
          <span>Overseer vote</span>
        </label>
        <span className={running ? 'text-emerald-300' : 'text-slate-400'}>
          running: {running ? 'yes' : 'no'}
        </span>
      </div>
      <div className="mt-1 text-[0.65rem] text-slate-400">
        yes {Number(vote?.yesCount || 0)} / no {Number(vote?.noCount || 0)} / online {Number(vote?.onlineCount || 0)}
      </div>
      <div className="mt-0.5 text-[0.65rem] text-slate-500">
        your vote: {(sessionIdentity?.overseerEnabled ?? enabled) ? 'yes' : 'no'}
      </div>
    </section>
  );
}
