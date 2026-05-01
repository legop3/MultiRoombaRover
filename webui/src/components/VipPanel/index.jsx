// Vip Panel
// Purpose: Defines the Vip Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useMemo, useState } from 'react';
import { useSession } from '../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import { COOKIE_KEY_REGEX, flowWrapClass } from '../vip/constants.js';
import VipAudioUploadCard from '../vip/VipAudioUploadCard/index.jsx';
import VipVerificationCard from '../vip/VipVerificationCard.jsx';
import VipIdentityCard from '../vip/VipIdentityCard.jsx';
import VipPrivateRoverAccessCard from '../vip/VipPrivateRoverAccessCard.jsx';
import VipNeatoCard from '../vip/VipNeatoCard.jsx';
import VipLiftCard from '../vip/VipLiftCard.jsx';

export default function VipPanel() {
  const {
    session,
    identifySession,
    requestVerification,
    requestPrivateRoverAccess,
    playUploadedAudio,
    stopUploadedAudio,
    startMicWhip,
    readyMicWhip,
    stopMicWhip,
    neatoStart,
    neatoSendHome,
    neatoLocate,
    neatoClearErrors,
    neatoPowerCycle,
    liftUp,
    liftDown,
  } = useSession();
  const { value: identity, save: saveIdentity } = useSettingsNamespace('identity', { cookieUserId: '' });
  const { value: profile } = useSettingsNamespace('profile', { nickname: '' });

  const currentStoredKey = useMemo(() => (identity?.cookieUserId || '').trim(), [identity?.cookieUserId]);
  const nickname = (profile?.nickname || '').trim();
  const isVerified = Boolean(session?.isVerified);
  const pendingRequestId = session?.verification?.pendingRequestId || null;
  const requestablePrivateRovers = session?.privateRoverAccess?.requestableRovers || [];
  const pendingPrivateRoverRequests = session?.privateRoverAccess?.pendingRequests || [];
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
    <section className="space-y-2 text-base">
      <div className="grid gap-2 grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.9fr)]">
        {!isVerified ? (
          <div className="lg:col-span-2">
            <VipVerificationCard
              pendingRequestId={pendingRequestId}
              currentStoredKey={currentStoredKey}
              nickname={nickname}
              requestVerification={requestVerification}
              applyIdentityKey={applyIdentityKey}
              onMessage={setMessage}
              fullWidth
            />
          </div>
        ) : null}

        <div className="lg:col-span-2">
          {isVerified ? (
            <div className="space-y-2">
              <VipNeatoCard
                neato={session?.neato || null}
                onStart={neatoStart}
                onSendHome={neatoSendHome}
                onLocate={neatoLocate}
                onClearErrors={neatoClearErrors}
                onPowerCycle={neatoPowerCycle}
                fullWidth
              />
              <VipLiftCard
                lift={session?.lift || null}
                onUp={liftUp}
                onDown={liftDown}
                fullWidth
              />
              <VipAudioUploadCard
                ownRoverId={ownRoverId}
                audioForwardByRover={session?.audioForward || {}}
                playUploadedAudio={playUploadedAudio}
                stopUploadedAudio={stopUploadedAudio}
                startMicWhip={startMicWhip}
                readyMicWhip={readyMicWhip}
                stopMicWhip={stopMicWhip}
              />
            </div>
          ) : (
            <section className="surface h-full">
              <div className="flex h-full flex-col items-center justify-center text-center text-xs text-slate-400">
                Verify your account to unlock VIP controls.
              </div>
            </section>
          )}
        </div>

        <div className="lg:col-span-2">
          <VipPrivateRoverAccessCard
            requestableRovers={requestablePrivateRovers}
            pendingRequests={pendingPrivateRoverRequests}
            requestPrivateRoverAccess={requestPrivateRoverAccess}
            onMessage={setMessage}
            fullWidth
          />
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
