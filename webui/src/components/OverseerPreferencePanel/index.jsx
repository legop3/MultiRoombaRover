import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import CardFrame from '../CardFrame/index.jsx';

export default function OverseerPreferencePanel() {
  const { identifySession } = useSessionActions();
  const vote = useSessionSelector((state) => state.session?.overseerVote || null);
  const { value: profile } = useSettingsNamespace('profile', { nickname: '' });
  const { value: identity } = useSettingsNamespace('identity', { cookieUserId: '' });
  const { value, save } = useSettingsNamespace('overseerPreference', { enabled: false });
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
    <CardFrame title="Overseer vote" bodyClassName="space-y-0.5 text-center text-xs text-slate-200">
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
  );
}
