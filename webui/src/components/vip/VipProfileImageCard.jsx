// Vip Profile Image Card
// Purpose: Lets verified VIP users persist a profile image URL used for chat message avatars.
// Scope: Owns local URL validation UX and writes to the existing profile settings namespace.
import { useEffect, useMemo, useState } from 'react';
import { useSettingsNamespace } from '../../settings/index.js';
import CardFrame from '../CardFrame/index.jsx';
import { fieldClass, flowWrapClass, innerFlowClass } from './constants.js';

function normalizeHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const protocol = String(parsed.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export default function VipProfileImageCard({ isVerified = false, fullWidth = false, onMessage }) {
  const { value: profile, save: saveProfile } = useSettingsNamespace('profile', {
    nickname: '',
    profileImageUrl: '',
  });
  const stored = String(profile?.profileImageUrl || '').trim();
  const [input, setInput] = useState(stored);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setInput(stored);
  }, [stored]);

  const normalizedInput = useMemo(() => normalizeHttpUrl(input), [input]);
  const hasUnsaved = String(input || '').trim() !== stored;
  const canSave = Boolean(isVerified && hasUnsaved && (normalizedInput || !String(input || '').trim()));
  const wrapClass = fullWidth ? 'w-full' : flowWrapClass;

  const handleSave = async (event) => {
    event.preventDefault();
    if (!isVerified) {
      onMessage?.('Verify your account before setting a profile image URL.');
      return;
    }
    setWorking(true);
    onMessage?.('');
    try {
      const next = normalizedInput || '';
      saveProfile((current) => ({ ...(current || {}), profileImageUrl: next }));
      onMessage?.(next ? 'Profile image URL saved.' : 'Profile image URL cleared.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <CardFrame title="Chat profile image URL" accent="#f59e0b" className={wrapClass} bodyClassName="text-sm text-slate-300">
      <form className={innerFlowClass} onSubmit={handleSave}>
        <p className="text-xs text-slate-500">
          Verified users can set a custom avatar for chat and Discord bridge messages.
        </p>
        <input
          className={fieldClass}
          type="url"
          name="vip_profile_image_url"
          placeholder="https://example.com/avatar.png"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={!isVerified || working}
        />
        {!normalizedInput && String(input || '').trim() ? (
          <p className="text-xs text-amber-300">Enter a valid http/https image URL.</p>
        ) : null}
        <div className="flex justify-center gap-0.5">
          <button type="submit" className="button-dark text-sm disabled:opacity-50" disabled={!canSave || working}>
            {working ? 'Saving...' : 'Save URL'}
          </button>
          <button
            type="button"
            className="button-dark text-sm disabled:opacity-50"
            disabled={!isVerified || working || !stored}
            onClick={() => setInput('')}
          >
            Clear
          </button>
        </div>
      </form>
    </CardFrame>
  );
}
