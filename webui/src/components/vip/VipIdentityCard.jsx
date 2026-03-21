import { useState } from 'react';
import { fieldClass, flowWrapClass, innerFlowClass, maskKey } from './constants.js';

export default function VipIdentityCard({ currentStoredKey, applyIdentityKey, onMessage, fullWidth = false }) {
  const [restoreFlowStep, setRestoreFlowStep] = useState(0);
  const [restoreKeyInput, setRestoreKeyInput] = useState('');
  const [working, setWorking] = useState(false);

  const beginRestoreFlow = () => {
    setRestoreFlowStep(1);
    setRestoreKeyInput('');
    onMessage?.('');
  };

  const cancelRestoreFlow = () => {
    setRestoreFlowStep(0);
    setRestoreKeyInput('');
  };

  const handleRestoreSubmit = async (event) => {
    event.preventDefault();
    if (restoreFlowStep < 2) return;
    setWorking(true);
    onMessage?.('');
    try {
      await applyIdentityKey(restoreKeyInput);
      setRestoreFlowStep(0);
      setRestoreKeyInput('');
      onMessage?.('Identity key restored.');
    } catch (err) {
      onMessage?.(err.message || 'Failed to restore key.');
    } finally {
      setWorking(false);
    }
  };

  const wrapClass = fullWidth ? 'w-full' : flowWrapClass;

  return (
    <section className={`surface ${wrapClass}`}>
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
  );
}
