// Display Chat Feed
// Purpose: Shows the existing chat panel scaled for distance viewing.
// Scope: Uses ChatPanel minimal mode so the display route reuses normal chat behavior without input chrome.
import ChatPanel from '../../../components/ChatPanel/index.jsx';

export default function DisplayChatFeed() {
  const displayChatScale = 3;

  return (
    <section className="h-full min-h-0 overflow-hidden border-t border-slate-800 bg-black p-[0.45vw]">
      <div
        className="origin-top-left"
        style={{
          // ChatPanel is shared with the normal UI and intentionally compact.
          // Scaling the whole panel keeps message rendering, scrolling, typing
          // rows, and future chat behavior in one place while making the display
          // readable. Width and height compensation reserve the unscaled layout
          // space that becomes exactly one full chat band after transform.
          width: `calc(100% / ${displayChatScale})`,
          height: `calc(100% / ${displayChatScale})`,
          transform: `scale(${displayChatScale})`,
        }}
      >
        <ChatPanel minimal fillHeight hideSpectatorNotice />
      </div>
    </section>
  );
}
