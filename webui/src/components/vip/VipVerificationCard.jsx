import { useState } from 'react';
import NicknameForm from '../NicknameForm/index.jsx';
import { flowWrapClass, innerFlowClass, fieldClass } from './constants.js';

export default function VipVerificationCard({
  pendingRequestId,
  currentStoredKey,
  nickname,
  requestVerification,
  applyIdentityKey,
  onMessage,
  fullWidth = false,
}) {
  const [requestFlowStep, setRequestFlowStep] = useState(0);
  const [requestKeyInput, setRequestKeyInput] = useState('');
  const [confirmNickname, setConfirmNickname] = useState(false);
  const [working, setWorking] = useState(false);

  const beginRequestFlow = () => {
    setRequestFlowStep(1);
    setRequestKeyInput(currentStoredKey);
    setConfirmNickname(false);
    onMessage?.('');
  };

  const cancelRequestFlow = () => {
    setRequestFlowStep(0);
    setConfirmNickname(false);
  };

  const handleRequestSubmit = async (event) => {
    event.preventDefault();
    if (!confirmNickname) {
      onMessage?.('Please confirm your nickname agreement before sending.');
      return;
    }
    if (requestFlowStep < 3) {
      onMessage?.('Complete all request steps before sending.');
      return;
    }
    setWorking(true);
    onMessage?.('');
    try {
      const applied = await applyIdentityKey(requestKeyInput);
      await requestVerification?.();
      setRequestKeyInput(applied);
      setRequestFlowStep(0);
      setConfirmNickname(false);
      onMessage?.('Verification request sent to lockdown admins.');
    } catch (err) {
      onMessage?.(err.message || 'Failed to submit request.');
    } finally {
      setWorking(false);
    }
  };

  const wrapClass = fullWidth ? 'w-full' : flowWrapClass;

  if (pendingRequestId) {
    return (
      <section className={`surface text-sm text-slate-300 ${wrapClass}`}>
        <div className={innerFlowClass}>Verification request pending: {pendingRequestId}</div>
      </section>
    );
  }

  if (requestFlowStep === 0) {
    return (
      <section className={`surface ${wrapClass}`}>
        <div className={innerFlowClass}>
          <p className="text-sm text-slate-300">Verification</p>
          <button type="button" className="button-dark text-sm" onClick={beginRequestFlow} disabled={working}>
            Request Verification
          </button>
        </div>
      </section>
    );
  }

  return (
    <form className={`surface ${wrapClass}`} onSubmit={handleRequestSubmit}>
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
  );
}
