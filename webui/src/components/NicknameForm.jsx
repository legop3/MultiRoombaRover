import { useEffect, useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useSettingsNamespace } from '../settings/index.js';

export default function NicknameForm({ compact = false }) {
  const { session, setNickname } = useSession();
  const { value, save } = useSettingsNamespace('profile', { nickname: '' });
  const [nicknameInput, setNicknameInput] = useState(value.nickname || '');
  const [saving, setSaving] = useState(false);

  const canSetNickname = session?.role !== 'spectator';

  useEffect(() => {
    setNicknameInput(value.nickname || '');
  }, [value.nickname]);

  async function handleSave(event) {
    event.preventDefault();
    if (!canSetNickname) return;
    const trimmed = (nicknameInput || '').trim().slice(0, 32);
    if (!trimmed) return;
    setSaving(true);
    try {
      await setNickname(trimmed);
      save({ nickname: trimmed });
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-0.5" onSubmit={handleSave}>
      <input
        className="field-input flex-1 min-w-0"
        value={nicknameInput}
        onChange={(e) => setNicknameInput(e.target.value)}
        maxLength={32}
        placeholder="Enter a nickname"
        disabled={!canSetNickname}
      />
      <button
        type="submit"
        disabled={!canSetNickname || saving}
        className="button-dark shrink-0 whitespace-nowrap disabled:opacity-50"
      >
        {saving ? 'Saving…' : compact ? 'Set' : 'Save'}
      </button>
    </form>
  );
}
