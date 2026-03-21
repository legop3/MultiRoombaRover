import { useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useSettingsNamespace } from '../settings/index.js';
import { COOKIE_KEY_REGEX, flowWrapClass } from './vip/constants.js';
import VipAudioUploadCard from './vip/VipAudioUploadCard.jsx';
import VipVerificationCard from './vip/VipVerificationCard.jsx';
import VipIdentityCard from './vip/VipIdentityCard.jsx';

export default function VipPanel() {
  const {
    session,
    identifySession,
    requestVerification,
    playUploadedAudio,
    stopUploadedAudio,
    startMicWhip,
    readyMicWhip,
    stopMicWhip,
  } = useSession();
  const { value: identity, save: saveIdentity } = useSettingsNamespace('identity', { cookieUserId: '' });
  const { value: profile } = useSettingsNamespace('profile', { nickname: '' });

  const currentStoredKey = useMemo(() => (identity?.cookieUserId || '').trim(), [identity?.cookieUserId]);
  const nickname = (profile?.nickname || '').trim();
  const isVerified = Boolean(session?.isVerified);
  const pendingRequestId = session?.verification?.pendingRequestId || null;
  const ownRoverId = String(session?.assignment?.roverId || '').trim();
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
      <div className="grid gap-0.5 grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.9fr)]">
        <div className="lg:col-span-2">
          {isVerified ? (
            <section className="surface w-full">
              <div className="mx-auto flex w-full max-w-md flex-col items-center space-y-0.5 text-center">
                <p className="text-sm text-emerald-300">Verification complete</p>
                <p className="text-xs text-slate-400">VIP controls are unlocked for your assigned rover.</p>
              </div>
            </section>
          ) : (
            <VipVerificationCard
              pendingRequestId={pendingRequestId}
              currentStoredKey={currentStoredKey}
              nickname={nickname}
              requestVerification={requestVerification}
              applyIdentityKey={applyIdentityKey}
              onMessage={setMessage}
              fullWidth
            />
          )}
        </div>

        <div className="lg:col-span-2">
          {isVerified ? (
            <VipAudioUploadCard
              ownRoverId={ownRoverId}
              audioForwardByRover={session?.audioForward || {}}
              playUploadedAudio={playUploadedAudio}
              stopUploadedAudio={stopUploadedAudio}
              startMicWhip={startMicWhip}
              readyMicWhip={readyMicWhip}
              stopMicWhip={stopMicWhip}
            />
          ) : (
            <section className="surface h-full">
              <div className="flex h-full flex-col items-center justify-center text-center text-xs text-slate-400">
                Verify your account to unlock VIP controls.
              </div>
            </section>
          )}
        </div>

        <div className="lg:col-span-2">
          <VipIdentityCard
            currentStoredKey={currentStoredKey}
            applyIdentityKey={applyIdentityKey}
            onMessage={setMessage}
            fullWidth
          />
        </div>
      </div>

      {message ? (
        <div className={flowWrapClass}>
          <p className="text-xs text-slate-400 text-center">{message}</p>
        </div>
      ) : null}
    </section>
  );
}
