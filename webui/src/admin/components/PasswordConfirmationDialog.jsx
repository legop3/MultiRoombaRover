// Password Confirmation Dialog
// Purpose: Collects recent password proof for sensitive administrative mutations without storing it in page state longer than necessary.
// Scope: Handles confirmation presentation only; retry ownership remains in AdminApp.
import { useState } from 'react';

export default function PasswordConfirmationDialog({ open, busy, error, onCancel, onConfirm }) {
  const [password, setPassword] = useState('');
  if (!open) return null;

  async function submit(event) {
    event.preventDefault();
    await onConfirm(password);
    setPassword('');
  }

  function cancel() {
    // Clear the credential before closing because this component remains
    // mounted beneath the admin shell and would otherwise retain it in memory.
    setPassword('');
    onCancel();
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 p-2">
      <form className="w-full max-w-sm border border-neutral-500/70 bg-neutral-900 p-1 text-slate-100 shadow-2xl" onSubmit={submit}>
        <h2 className="text-base font-semibold">Confirm password</h2>
        <p className="mt-0.5 text-xs text-slate-400">This sensitive action requires recent confirmation of your administrator password.</p>
        <input
          autoFocus
          autoComplete="current-password"
          className="field-input mt-1 w-full"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error ? <p className="mt-0.5 text-xs text-red-300">{error}</p> : null}
        <div className="mt-1 flex justify-end gap-0.5">
          <button type="button" className="button-dark" disabled={busy} onClick={cancel}>Cancel</button>
          <button type="submit" className="button-dark" disabled={busy || !password}>{busy ? 'Confirming…' : 'Confirm'}</button>
        </div>
      </form>
    </div>
  );
}
