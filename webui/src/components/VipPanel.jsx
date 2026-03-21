import { useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useSettingsNamespace } from '../settings/index.js';
import { COOKIE_KEY_REGEX, flowWrapClass } from './vip/constants.js';
import VipVerificationCard from './vip/VipVerificationCard.jsx';
import VipIdentityCard from './vip/VipIdentityCard.jsx';

export default function VipPanel() {
  const { session, identifySession, requestVerification } = useSession();
  const { value: identity, save: saveIdentity } = useSettingsNamespace('identity', { cookieUserId: '' });
  const { value: profile } = useSettingsNamespace('profile', { nickname: '' });

  const currentStoredKey = useMemo(() => (identity?.cookieUserId || '').trim(), [identity?.cookieUserId]);
  const nickname = (profile?.nickname || '').trim();
  const isVerified = Boolean(session?.isVerified);
  const pendingRequestId = session?.verification?.pendingRequestId || null;
  const [message, setMessage] = useState('');

  const applyIdentityKey = async (nextRaw) => {
    const next = String(nextRaw || '').trim().toLowerCase();
    if (!next) {
      throw new Error('Identity key required.');
    }
    if (!COOKIE_KEY_REGEX.test(next)) {
      throw new Error('Identity key must match format: cu_ + 32 lowercase hex chars.');
    }
    saveIdentity((current) => ({ ...(current || {}), cookieUserId: next }));
    await identifySession({ cookieUserId: next, nickname });
    return next;
  };

  return (
    <section className="panel-section space-y-0.5 text-base">
      {isVerified ? (
        <div className={`surface ${flowWrapClass}`}>
          <div className="mx-auto flex w-full max-w-md flex-col items-center space-y-0.5 text-center">
            <p className="text-sm text-slate-300">VIP verified.</p>
            <p className="text-xs text-slate-500">Audio forwarding is disabled while this stack is being rebuilt.</p>
          </div>
        </div>
      ) : (
        <VipVerificationCard
          pendingRequestId={pendingRequestId}
          currentStoredKey={currentStoredKey}
          nickname={nickname}
          requestVerification={requestVerification}
          applyIdentityKey={applyIdentityKey}
          onMessage={setMessage}
        />
      )}

      <VipIdentityCard
        currentStoredKey={currentStoredKey}
        applyIdentityKey={applyIdentityKey}
        onMessage={setMessage}
      />

      {message ? (
        <div className={flowWrapClass}>
          <p className="text-xs text-slate-400 text-center">{message}</p>
        </div>
      ) : null}
    </section>
  );
}
