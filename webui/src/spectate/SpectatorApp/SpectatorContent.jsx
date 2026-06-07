// Spectator Content
// Purpose: Defines the Spectator Content module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useSession } from '../../context/SessionContext.jsx';
import { useSpectatorMode } from '../../hooks/useSpectatorMode.js';
import useDefaultNickname from '../../hooks/useDefaultNickname.js';
import useUserIdentitySync from '../../hooks/useUserIdentitySync.js';
import ChatPanel from '../../components/ChatPanel/index.jsx';
import AlertFeed from '../../components/AlertFeed/index.jsx';
import GlobalObjectiveBanner from '../../components/GlobalObjectiveBanner/index.jsx';
import RoverQueuesPanel from '../../components/RoverQueuesPanel/index.jsx';
import RawUserPilePanel from '../../components/RawUserPilePanel/index.jsx';
import ButtonBoxPanel from '../../components/ButtonBoxPanel/index.jsx';
import RewardRunOverlay from '../../components/RewardRunOverlay/index.jsx';
import usePortraitLayout from './hooks/usePortraitLayout.js';
import RoverRow from './components/RoverRow.jsx';
import SecondaryRow from './components/SecondaryRow.jsx';
import LogsRow from './components/LogsRow.jsx';

export default function SpectatorContent() {
  const { session } = useSession();
  const inLockdown = session?.mode === 'lockdown';
  useDefaultNickname();
  // The spectator route is not rendered through App.jsx, so it must opt into
  // the same persisted identity heartbeat here. That keeps the existing
  // cookie-backed identity and saved nickname behavior active without adding a
  // separate spectator identity path.
  useUserIdentitySync();
  useSpectatorMode();
  const isPortraitLayout = usePortraitLayout();
  const roster = session?.roster ?? [];

  if (inLockdown) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-slate-200">
        <div className="surface max-w-md space-y-0.5 p-1 text-center text-sm">
          <p className="text-lg font-semibold text-white">Spectate disabled during lockdown.</p>
          <p className="text-slate-300">Please wait until the server leaves lockdown to view streams.</p>
        </div>
      </div>
    );
  }

  const mainClass = isPortraitLayout
    ? 'flex min-h-screen flex-col bg-black text-slate-100 md:h-screen md:overflow-hidden'
    : 'grid min-h-screen grid-cols-1 gap-0.5 bg-black text-slate-100 md:h-full md:min-h-0 md:grid-cols-[minmax(0,1fr)_18rem] lg:grid-cols-[minmax(0,1fr)_20rem]';
  const contentClass = isPortraitLayout
    ? 'order-2 flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 overflow-y-auto'
    : 'order-1 flex min-h-0 min-w-0 flex-col gap-0.5 md:overflow-y-auto';
  const sidebarClass = isPortraitLayout
    ? 'order-1 grid w-full min-h-0 items-stretch gap-0.5 border-b border-slate-800/60 bg-slate-950/90 p-0.5 grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1.9fr)_minmax(0,0.7fr)]'
    : 'order-2 flex min-h-0 min-w-0 flex-col gap-0.5 border-l border-slate-800/60 bg-slate-950/90 md:h-full md:overflow-y-auto';
  const topBarItemClass = isPortraitLayout ? '' : '';
  const portraitItemHeight = isPortraitLayout ? 'h-64' : '';

  return (
    <div className="min-h-screen bg-black text-slate-100 md:h-screen md:overflow-hidden">
      <main className={mainClass}>
        <section className={sidebarClass}>
          {isPortraitLayout ? (
            <div className={`${topBarItemClass} ${portraitItemHeight} flex flex-col gap-0.5`}>
              <GlobalObjectiveBanner layout="desktop" dismissable={false} className="text-sm" />
              <ButtonBoxPanel />
              <div className="min-h-0 flex-1">
                <RawUserPilePanel hideNicknameForm hideHeader compact fillHeight className="h-full" />
              </div>
            </div>
          ) : (
            <div className={topBarItemClass}>
              <GlobalObjectiveBanner layout="desktop" dismissable={false} className="text-sm" />
              <ButtonBoxPanel />
            </div>
          )}
          <div className={`${topBarItemClass} ${isPortraitLayout ? `${portraitItemHeight} overflow-y-auto` : ''}`}>
            <div className="panel h-full">
              <RoverQueuesPanel title="Rovers" />
            </div>
          </div>
          {!isPortraitLayout ? (
            <div className={`${topBarItemClass} flex-1 min-h-0`}>
              <RawUserPilePanel hideNicknameForm hideHeader compact fillHeight className="h-full" />
            </div>
          ) : null}
          <div className={`${topBarItemClass} ${isPortraitLayout ? portraitItemHeight : 'flex-[1.1] min-h-0'}`}>
            <ChatPanel allowSpectatorInput hideSpectatorNotice fillHeight />
          </div>
          <div className={`${topBarItemClass} ${isPortraitLayout ? portraitItemHeight : ''}`}>
            <LogsRow className={`${isPortraitLayout ? 'h-full' : 'h-40'} overflow-hidden`} />
          </div>
        </section>
        <section className={contentClass}>
          <RoverRow roster={roster} />
          <SecondaryRow />
        </section>
      </main>
      <AlertFeed />
      <RewardRunOverlay />
    </div>
  );
}
