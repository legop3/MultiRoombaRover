// Nickname Form
// Purpose: Defines the Nickname Form module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useState } from 'react';
import { useSessionActions } from '../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import { trackAnalyticsEvent } from '../../analytics/index.js';

export default function NicknameForm({ compact = false }) {
  const { setNickname } = useSessionActions();
  const { value, save } = useSettingsNamespace('profile', { nickname: '' });
  const [nicknameInput, setNicknameInput] = useState(value.nickname || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNicknameInput(value.nickname || '');
  }, [value.nickname]);

  async function handleSave(event) {
    event.preventDefault();
    const trimmed = (nicknameInput || '').trim().slice(0, 32);
    if (!trimmed) return;
    setSaving(true);
    try {
      // Nicknames are identity metadata rather than rover-control permission.
      // Spectator pages use the same socket action and local profile storage as
      // the driver UI so chat/user-list labels stay consistent across routes.
      await setNickname(trimmed);
      save({ nickname: trimmed });
      /*
        The event records that a nickname was saved, while the shared analytics
        session reporter owns the actual nickname field. Keeping that split
        prevents every form call site from needing to know privacy/config rules.
      */
      trackAnalyticsEvent('nickname_set', {
        length: trimmed.length,
      });
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-stretch gap-0.5">
      <input
        className="field-input flex-1 min-w-0"
        value={nicknameInput}
        onChange={(e) => setNicknameInput(e.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          handleSave(event);
        }}
        maxLength={32}
        placeholder="Enter a nickname"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="button-dark h-full shrink-0 whitespace-nowrap px-0.5 py-0 disabled:opacity-50"
      >
        {saving ? 'Saving…' : compact ? 'Set' : 'Save'}
      </button>
    </div>
  );
}
