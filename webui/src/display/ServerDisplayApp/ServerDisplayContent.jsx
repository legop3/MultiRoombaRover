// Server Display Content
// Purpose: Composes the passive room display route used as a third spectator-style page.
// Scope: Shows online names, rover driver/battery status, chat, replay overlays, reward overlays, and hidden audio.
import { useSession, useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { useSpectatorMode } from '../../hooks/useSpectatorMode.js';
import useDefaultNickname from '../../hooks/useDefaultNickname.js';
import useUserIdentitySync from '../../hooks/useUserIdentitySync.js';
import ReplayReadyPopup from '../../components/ReplaySourcesPanel/ReplayReadyPopup.jsx';
import RewardRunOverlay from '../../components/RewardRunOverlay/index.jsx';
import OnlinePeopleStrip from './components/OnlinePeopleStrip.jsx';
import DisplayRoverGrid from './components/DisplayRoverGrid.jsx';
import DisplayChatFeed from './components/DisplayChatFeed.jsx';
import DisplayNoticeOverlay from './components/DisplayNoticeOverlay.jsx';
import DisplayPtzOperatorBadge from './components/DisplayPtzOperatorBadge.jsx';
import AlertFeed from '../../components/AlertFeed/index.jsx';

export default function ServerDisplayContent() {
  const { session } = useSession();
  const latestReplay = useSessionSelector((state) => state.latestReplay);
  const { clearLatestReplay } = useSessionActions();
  const inLockdown = session?.mode === 'lockdown';

  useDefaultNickname();
  // This page is a passive room endpoint, but it still needs the same identity
  // heartbeat as /spectate and /mini so nickname cookies and spectator role sync
  // stay current when this laptop is left running for a long session.
  useUserIdentitySync();
  useSpectatorMode();

  if (inLockdown) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black text-[clamp(2.5rem,8vh,8rem)] font-black text-slate-200">
        Lockdown
      </div>
    );
  }

  return (
    <div className="display-page flex h-screen w-screen flex-col overflow-hidden bg-black text-slate-100">
      <div className="flex h-[8vh] min-h-16 shrink-0 overflow-hidden">
        <OnlinePeopleStrip users={session?.users || []} />
        <DisplayPtzOperatorBadge />
      </div>
      <div className="min-h-0 flex-[0.72]">
        <DisplayRoverGrid roster={session?.roster || []} session={session} />
      </div>
      <div className="min-h-0 flex-[1.28]">
        <DisplayChatFeed />
      </div>
      <DisplayNoticeOverlay />
      <RewardRunOverlay />
      <ReplayReadyPopup replay={latestReplay} onClose={clearLatestReplay} />  
      <AlertFeed scale={5} />
    </div>
  );
}
