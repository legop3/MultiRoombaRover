// Server Display Content
// Purpose: Composes the passive room display route used as a third spectator-style page.
// Scope: Shows online names, rover driver/battery status, chat, replay overlays, reward overlays, and hidden audio.
import { useSettingsNamespace } from '../../settings/index.js';
import SpectatorSettings from '../../components/SpectatorSettings/index.jsx';
import SpectatorReplayPopup from '../../components/SpectatorSettings/ReplayPopup.jsx';
import { useSession } from '../../context/SessionContext.jsx';
import { useSpectatorMode } from '../../hooks/useSpectatorMode.js';
import useDefaultNickname from '../../hooks/useDefaultNickname.js';
import useUserIdentitySync from '../../hooks/useUserIdentitySync.js';
import RewardRunOverlay from '../../components/RewardRunOverlay/index.jsx';
import OnlinePeopleStrip from './components/OnlinePeopleStrip.jsx';
import DisplayRoverGrid from './components/DisplayRoverGrid.jsx';
import DisplayChatFeed from './components/DisplayChatFeed.jsx';
import DisplayNoticeOverlay from './components/DisplayNoticeOverlay.jsx';
import DisplayPtzOperatorBadge from './components/DisplayPtzOperatorBadge.jsx';
import AlertFeed from '../../components/AlertFeed/index.jsx';

const VIEW_OPTIONS = [{ key: 'showReplayPopups', label: 'Replay popups' }];

export default function ServerDisplayContent() {
  const { session } = useSession();
  const { value: viewPreferences, save: saveViewPreferences, status: settingsStatus } = useSettingsNamespace(
    'displayPage',
    { showReplayPopups: true },
  );
  const updateViewPreference = (key, enabled) => saveViewPreferences({ [key]: enabled });
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
      <div className="flex h-[clamp(4rem,7.5vmin,6.5rem)] shrink-0 overflow-hidden pr-10">
        <OnlinePeopleStrip users={session?.users || []} />
        <DisplayPtzOperatorBadge />
      </div>
      <div className="max-h-[65%] shrink-0 overflow-y-auto">
        <DisplayRoverGrid roster={session?.roster || []} session={session} />
      </div>
      <div className="min-h-0 flex-1">
        <DisplayChatFeed />
      </div>
      <DisplayNoticeOverlay />
      <RewardRunOverlay />
      <AlertFeed scale={2} opacity={1}/>
      <SpectatorSettings options={VIEW_OPTIONS} preferences={viewPreferences} onToggle={updateViewPreference} />
      <SpectatorReplayPopup enabled={viewPreferences?.showReplayPopups !== false} ready={settingsStatus !== 'loading'} />
    </div>
  );
}
