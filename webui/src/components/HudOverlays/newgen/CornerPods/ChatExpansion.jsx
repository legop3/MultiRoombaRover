// New-drive Chat Expansion
// Purpose: Keeps chat collapsed to a corner icon while reusing the established HUD composer behavior.
import { useCallback, useState } from 'react';
import { FaComment } from 'react-icons/fa';
import { useChatActions } from '../../../../context/ChatContext.jsx';
import { useSessionSelector } from '../../../../context/SessionContext.jsx';
import { useControlSelector } from '../../../../controls/index.js';
import { formatKeyLabel } from '../../../../controls/keymapUtils.js';
import HudChatInput from '../../HudChatInput/index.jsx';
import KeyPill from '../../../vip/VipAudioUploadCard/KeyPill.jsx';

export default function ChatExpansion({ podOpen }) {
  const role = useSessionSelector((state) => state.session?.role || null);
  const chatKeyLabel = useControlSelector((control) => formatKeyLabel(control.state.keymap?.chatFocus?.[0]));
  const { blurChat, focusChat } = useChatActions();
  const [open, setOpen] = useState(false);

  const setChatOpen = useCallback((nextOpen) => {
    const next = Boolean(nextOpen);
    setOpen(next);
    if (!next) blurChat();
  }, [blurChat]);

  const toggleChat = useCallback(() => {
    if (open) {
      setChatOpen(false);
      return;
    }

    setOpen(true);
    /* HudChatInput remains mounted while visually collapsed, so the existing
       ChatContext HUD ref is ready immediately. Waiting one animation frame lets
       the opening presentation commit before the browser paints the focus ring. */
    window.requestAnimationFrame(focusChat);
  }, [focusChat, open, setChatOpen]);

  // Spectators use the sidebar transcript but cannot send through the legacy HUD
  // composer, so hiding this expansion avoids presenting an inert control.
  if (role === 'spectator') return null;

  return (
    <>
      <button
        type="button"
        aria-label={open ? 'Close chat' : 'Open chat'}
        aria-pressed={open}
        onClick={toggleChat}
        className={`pointer-events-auto absolute z-20 flex h-8 items-center justify-center gap-1 bg-black/60 px-1.5 text-sm text-white transition hover:bg-black/80 ${podOpen ? 'bottom-[8.5rem] right-0 rounded-tl-lg' : 'bottom-0 right-10 rounded-t-lg'}`}
      >
        <FaComment aria-hidden="true" />
        {/* The pill reflects the live keymap so remapping chat focus updates this
            compact HUD hint without duplicating or hardcoding the default key. */}
        {chatKeyLabel ? <KeyPill label={chatKeyLabel} /> : null}
      </button>

      <HudChatInput variant="newdrive" open={open} onOpenChange={setChatOpen} />
    </>
  );
}
