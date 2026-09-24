import CardFrame from '../../components/CardFrame/index.jsx';
import ChatPanel from '../../components/ChatPanel/index.jsx';
import HomeAssistantControls from '../../components/HomeAssistantControls/index.jsx';
import ReplaySourcesPanel from '../../components/ReplaySourcesPanel/index.jsx';
import { PTZ_CAMERA_ID } from '../../components/PtzLiveVideo/index.jsx';
import { PtzQueueSummary } from './PtzQueuePanel.jsx';
import { PtzLightingControls, PtzMobileControlsPanel, PtzControlReference } from './PtzControls.jsx';
import { PtzPresetPanel } from './PtzPresetPanel.jsx';
import { PtzMediaPane } from './PtzMediaPane.jsx';
function PtzDesktopFullscreen({ ptz, releasePending }) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(7rem,0.22fr)] gap-0.5 overflow-hidden p-0.5">
      <div className="flex min-h-0 min-w-0 gap-0.5 overflow-hidden">
        <main className="min-h-0 shrink-0 overflow-hidden bg-black" style={{ aspectRatio: '16 / 9' }}>
          <PtzMediaPane ptz={ptz} open framed />
        </main>
        {/* Keep the sidebar itself transparent. Its child cards still own their dark surfaces,
            while the shared PTZ page theme can show through the same compact gaps as the driver
            layout instead of being covered by one solid sidebar rectangle. */}
        <aside className="flex min-h-0 min-w-56 flex-1 flex-col gap-0.5 overflow-y-auto text-sm">
          <PtzQueueSummary ptz={ptz} />
          {ptz?.permissions?.canControl ? (
            <PtzLightingControls ptz={ptz} />
          ) : (
            <CardFrame title="Controls" bodyClassName="p-1 text-xs text-slate-400">
              Live PTZ controls unlock when your camera turn is active.
            </CardFrame>
          )}
          <PtzControlReference />
          <ReplaySourcesPanel panelId="ptz-controller-replay" defaultSelectedKey={`ptz:${PTZ_CAMERA_ID}`} />
          {/*
            Desktop keeps room lights as the final sidebar tool so camera
            turn controls and replay remain above the less-frequent room-wide
            actions. HomeAssistantControls owns its own feature and policy gate.
          */}
          <HomeAssistantControls />
        </aside>
      </div>
      <div className="grid min-h-0 grid-cols-[minmax(0,1.6fr)_minmax(16rem,0.7fr)] gap-0.5 overflow-hidden">
        <ChatPanel fillHeight title="Chat" allowSpectatorInput inputTarget="overlay" />
        <PtzPresetPanel ptz={ptz} />
      </div>
      {releasePending ? (
        <div className="pointer-events-none absolute bottom-1 right-1 rounded-sm bg-black/80 px-2 py-1 text-xs text-slate-200">
          Closing...
        </div>
      ) : null}
    </div>
  );
}

function PtzMobileLandscape({ ptz, onClose, releasePending = false }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-0.5">
      {/*
        Landscape intentionally retains one control column beside the video.
        This is the established PTZ interaction and avoids forcing rover-style
        left/right columns onto a camera that has a smaller control inventory.
      */}
      <section className="mobile-touch-control grid min-h-[calc(100dvh-0.25rem)] shrink-0 grid-cols-[minmax(0,1fr)_13rem] items-start gap-0.5">
        {/*
          The video keeps one viewport of height, but the grid row is allowed to
          grow when the control column is taller. That makes the sidebar's tail
          extend below the video instead of forcing it into a nested scroller.
        */}
        <div className="min-w-0 space-y-0.5">
          <main className="relative h-[calc(100dvh-0.25rem)] min-h-0 overflow-hidden bg-black">
            <button
              type="button"
              className="absolute right-1 top-1 z-110 rounded-sm border border-white/40 bg-black/80 px-2 py-1 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
              disabled={releasePending}
              onClick={onClose}
            >
              Close
            </button>
            <PtzMediaPane ptz={ptz} open compact framed={false} />
          </main>
          {/*
            The right control column is naturally taller than the viewport.
            Placing room lights after the fixed-height video uses that left-
            column space while the whole landscape page continues scrolling as
            one surface.
          */}
          <HomeAssistantControls />
        </div>
        {/*
          Do not put overflow scrolling on this column. The surrounding PTZ
          landscape content is the single page scroller, so a swipe over either
          the video area or these controls advances the same document flow.
        */}
        <aside className="min-h-0 space-y-0.5">
          {/*
            Landscape keeps all turn-critical controls in its one existing
            sidebar. Queue position belongs first so the operator can confirm
            control ownership before touching the camera, while replay follows
            the lighting buttons because it is the next secondary action in
            the same scroll column.
          */}
          <PtzQueueSummary ptz={ptz} />
          <PtzMobileControlsPanel ptz={ptz} disabled={!ptz?.permissions?.canControl} />
          <ReplaySourcesPanel
            panelId="ptz-controller-replay-mobile-landscape"
            defaultSelectedKey={`ptz:${PTZ_CAMERA_ID}`}
          />
        </aside>
      </section>
      <section className="grid gap-0.5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
        <ChatPanel title="Chat" allowSpectatorInput inputTarget="overlay" />
        <PtzPresetPanel ptz={ptz} />
      </section>
    </div>
  );
}

function PtzMobilePortrait({ ptz, onClose, releasePending = false }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-0.5">
      <main className="relative aspect-video min-h-0 shrink-0 overflow-hidden bg-black">
        <button
          type="button"
          className="absolute right-1 top-1 z-110 rounded-sm border border-white/40 bg-black/80 px-2 py-1 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
          disabled={releasePending}
          onClick={onClose}
        >
          Close
        </button>
        <PtzMediaPane ptz={ptz} open compact framed={false} />
      </main>
      {/*
        Portrait gives the video its full available width and places controls
        below it. Reusing the landscape sidebar width here was the source of the
        cramped portrait presentation, while the controls themselves remain the
        same shared PTZ controls used in landscape.
      */}
      <section className="mobile-touch-control">
        <PtzMobileControlsPanel ptz={ptz} disabled={!ptz?.permissions?.canControl} />
      </section>
      <section className="space-y-0.5">
        {/*
          Replay and presets are compact secondary actions, so portrait places
          them in one equal-width row before the full-width queue and chat. The
          explicit two-column grid keeps this arrangement local to portrait and
          leaves the desktop and one-column landscape compositions unchanged.
        */}
        <div className="grid grid-cols-2 items-start gap-0.5">
          <ReplaySourcesPanel
            panelId="ptz-controller-replay-mobile-portrait"
            defaultSelectedKey={`ptz:${PTZ_CAMERA_ID}`}
          />
          <PtzPresetPanel ptz={ptz} />
        </div>
        <PtzQueueSummary ptz={ptz} />
        <ChatPanel title="Chat" allowSpectatorInput inputTarget="overlay" />
        {/* Portrait keeps room lights immediately after chat as requested. */}
        <HomeAssistantControls />
      </section>
    </div>
  );
}

export { PtzDesktopFullscreen, PtzMobileLandscape, PtzMobilePortrait };
