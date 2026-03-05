import { useMemo, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useSettingsNamespace } from '../settings/index.js';
import NicknameForm from './NicknameForm.jsx';

function maskKey(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  if (key.length <= 10) return `${key.slice(0, 2)}***${key.slice(-2)}`;
  return `${key.slice(0, 6)}...${key.slice(-6)}`;
}

const cookieKeyRegex = /^cu_[a-f0-9]{32}$/;

export default function VipPanel() {
  const { session, identifySession, requestVerification } = useSession();
  const { value: identity, save: saveIdentity } = useSettingsNamespace('identity', { cookieUserId: '' });
  const { value: profile } = useSettingsNamespace('profile', { nickname: '' });

  const currentStoredKey = useMemo(() => (identity?.cookieUserId || '').trim(), [identity?.cookieUserId]);
  const nickname = (profile?.nickname || '').trim();
  const isVerified = Boolean(session?.isVerified);
  const pendingRequestId = session?.verification?.pendingRequestId || null;

  const [requestFlowStep, setRequestFlowStep] = useState(0);
  const [requestKeyInput, setRequestKeyInput] = useState('');
  const [confirmNickname, setConfirmNickname] = useState(false);
  const [restoreFlowStep, setRestoreFlowStep] = useState(0);
  const [restoreKeyInput, setRestoreKeyInput] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const fieldClass = 'field-input w-full max-w-sm text-left focus:ring-emerald-500';
  const flowWrapClass = 'mx-auto w-full max-w-xl flex justify-center';
  const innerFlowClass = 'mx-auto flex w-full max-w-md flex-col items-center space-y-0.5 text-center';

  const applyIdentityKey = async (nextRaw) => {
    const next = String(nextRaw || '').trim().toLowerCase();
    if (!next) {
      throw new Error('Identity key required.');
    }
    if (!cookieKeyRegex.test(next)) {
      throw new Error('Identity key must match format: cu_ + 32 lowercase hex chars.');
    }
    saveIdentity((current) => ({ ...(current || {}), cookieUserId: next }));
    await identifySession({ cookieUserId: next, nickname });
    return next;
  };

  const beginRequestFlow = () => {
    setRequestFlowStep(1);
    setRequestKeyInput(currentStoredKey);
    setConfirmNickname(false);
    setMessage('');
  };

  const cancelRequestFlow = () => {
    setRequestFlowStep(0);
    setConfirmNickname(false);
  };

  const beginRestoreFlow = () => {
    setRestoreFlowStep(1);
    setRestoreKeyInput('');
    setMessage('');
  };

  const cancelRestoreFlow = () => {
    setRestoreFlowStep(0);
    setRestoreKeyInput('');
  };

  const handleRequestSubmit = async (event) => {
    event.preventDefault();
    if (!confirmNickname) {
      setMessage('Please confirm your nickname agreement before sending.');
      return;
    }
    if (requestFlowStep < 3) {
      setMessage('Complete all request steps before sending.');
      return;
    }
    setWorking(true);
    setMessage('');
    try {
      const applied = await applyIdentityKey(requestKeyInput);
      await requestVerification();
      setRequestKeyInput(applied);
      setRequestFlowStep(0);
      setConfirmNickname(false);
      setMessage('Verification request sent to lockdown admins.');
    } catch (err) {
      setMessage(err.message || 'Failed to submit request.');
    } finally {
      setWorking(false);
    }
  };

  const handleRestoreSubmit = async (event) => {
    event.preventDefault();
    if (restoreFlowStep < 2) return;
    setWorking(true);
    setMessage('');
    try {
      await applyIdentityKey(restoreKeyInput);
      setRestoreFlowStep(0);
      setRestoreKeyInput('');
      setMessage('Identity key restored.');
    } catch (err) {
      setMessage(err.message || 'Failed to restore key.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="panel-section space-y-0.5 text-base">
      {isVerified ? (
        <section className="surface text-sm text-slate-200">
          VIP controls will show here... when there are some...
        </section>
      ) : null}

      {!isVerified ? (
        pendingRequestId ? (
          <section className={`surface text-sm text-slate-300 ${flowWrapClass}`}>
            <div className={innerFlowClass}>Verification request pending: {pendingRequestId}</div>
          </section>
        ) : requestFlowStep === 0 ? (
          <section className={`surface ${flowWrapClass}`}>
            <div className={innerFlowClass}>
              <p className="text-sm text-slate-300">Verification</p>
              <button type="button" className="button-dark text-sm" onClick={beginRequestFlow} disabled={working}>
                Request Verification
              </button>
            </div>
          </section>
        ) : (
          <form className={`surface ${flowWrapClass}`} onSubmit={handleRequestSubmit}>
            <div className={innerFlowClass}>
              <p className="text-sm text-slate-300">Request verification</p>
              <p className="text-xs text-slate-500">
                Step {requestFlowStep} of 3
              </p>

              {requestFlowStep === 1 ? (
                <div className="space-y-0.5">
                  <p className="text-xs text-slate-400">
                    Confirm your nickname, which is used as part of the verification process. You can edit it here before requesting.
                  </p>
                  <div className="mx-auto w-full max-w-sm">
                    <NicknameForm compact />
                  </div>
                  <div className="surface-muted mx-auto w-full max-w-sm text-xs text-slate-300 text-center">
                    Current nickname: <span className="font-semibold">{nickname || '(not set)'}</span>
                  </div>
                  <label className="flex items-center justify-center gap-0.5 text-xs text-slate-300 text-center">
                    <input
                      type="checkbox"
                      className="accent-emerald-500"
                      checked={confirmNickname}
                      onChange={(event) => setConfirmNickname(event.target.checked)}
                    />
                    <span>I understand this nickname is tied to my verification.</span>
                  </label>
                  <div className="flex justify-center gap-0.5">
                    <button
                      type="button"
                      className="button-dark text-sm"
                      disabled={!nickname || !confirmNickname}
                      onClick={() => setRequestFlowStep(2)}
                    >
                      Continue
                    </button>
                    <button type="button" className="button-dark text-sm" onClick={cancelRequestFlow}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              {requestFlowStep === 2 ? (
                <div className="space-y-0.5">
                  <p className="text-xs text-slate-400">
                    Save your identity key in a safe place. You can use it to restore your identity in another browser.
                  </p>
                  <input
                    className={fieldClass}
                    type="password"
                    name="identity_key_request"
                    autoComplete="current-password"
                    maxLength={35}
                    value={requestKeyInput}
                    onChange={(event) => setRequestKeyInput(event.target.value.toLowerCase())}
                    placeholder="Identity key for this request"
                  />
                  <div className="flex justify-center gap-0.5">
                    <button
                      type="button"
                      className="button-dark text-sm"
                      disabled={!requestKeyInput}
                      onClick={() => navigator.clipboard?.writeText(requestKeyInput)}
                    >
                      Copy Key
                    </button>
                    <button
                      type="button"
                      className="button-dark text-sm"
                      disabled={!requestKeyInput}
                      onClick={() => setRequestFlowStep(3)}
                    >
                      Continue
                    </button>
                    <button type="button" className="button-dark text-sm" onClick={() => setRequestFlowStep(1)}>
                      Back
                    </button>
                  </div>
                </div>
              ) : null}

              {requestFlowStep === 3 ? (
                <div className="space-y-0.5">
                  <p className="text-xs text-slate-400">
                    Final step: confirm and send your verification request.
                  </p>
                  <input
                    className={fieldClass}
                    type="password"
                    name="identity_key_request_final"
                    autoComplete="current-password"
                    maxLength={35}
                    value={requestKeyInput}
                    onChange={(event) => setRequestKeyInput(event.target.value.toLowerCase())}
                    placeholder="Identity key for this request"
                  />
                  <div className="flex justify-center gap-0.5">
                    <button type="submit" className="button-dark text-sm" disabled={working || !requestKeyInput}>
                      Confirm Request
                    </button>
                    <button type="button" className="button-dark text-sm" onClick={() => setRequestFlowStep(2)}>
                      Back
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </form>
        )
      ) : null}

      <section className={`surface ${flowWrapClass}`}>
        <div className={innerFlowClass}>
          <p className="text-sm text-slate-300">Identity key</p>
          <p className="text-xs text-slate-500">Current: {maskKey(currentStoredKey) || 'not set yet'}</p>
          <input
            className={fieldClass}
            type="password"
            name="identity_key_current"
            autoComplete="current-password"
            maxLength={35}
            value={currentStoredKey}
            readOnly
            placeholder="Identity key"
          />
          {restoreFlowStep === 0 ? (
            <div className="flex justify-center gap-0.5">
              <button
                type="button"
                className="button-dark text-sm"
                disabled={!currentStoredKey}
                onClick={() => navigator.clipboard?.writeText(currentStoredKey)}
              >
                Copy Key
              </button>
              <button type="button" className="button-dark text-sm" onClick={beginRestoreFlow} disabled={working}>
                Restore Key
              </button>
            </div>
          ) : null}

          {restoreFlowStep === 1 ? (
            <div className="space-y-0.5">
              <p className="text-xs text-slate-400">
                Restoring your key should only be done when needed. Use this to move your identity to another browser.
              </p>
              <div className="flex justify-center gap-0.5">
                <button type="button" className="button-dark text-sm" onClick={() => setRestoreFlowStep(2)}>
                  Continue
                </button>
                <button type="button" className="button-dark text-sm" onClick={cancelRestoreFlow}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {restoreFlowStep === 2 ? (
            <form className="space-y-0.5" onSubmit={handleRestoreSubmit}>
              <input
                className={fieldClass}
                type="password"
                name="identity_key_restore"
                autoComplete="current-password"
                maxLength={35}
                value={restoreKeyInput}
                onChange={(event) => setRestoreKeyInput(event.target.value.toLowerCase())}
                placeholder="Paste key to restore"
              />
              <div className="flex justify-center gap-0.5">
                <button type="submit" className="button-dark text-sm" disabled={working || !restoreKeyInput}>
                  Confirm Restore
                </button>
                <button type="button" className="button-dark text-sm" onClick={() => setRestoreFlowStep(1)}>
                  Back
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </section>

      {message ? (
        <div className={flowWrapClass}>
          <p className="text-xs text-slate-400 text-center">{message}</p>
        </div>
      ) : null}
    </section>
  );
}
