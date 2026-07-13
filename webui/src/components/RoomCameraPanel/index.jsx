// Room Camera Panel
// Purpose: Defines the Room Camera Panel module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import { useRoomCameraSnapshots } from '../../hooks/useRoomCameraSnapshots.js';
import { PTZ_CAMERA_ID, usePtzCameraSnapshots } from '../../hooks/usePtzCameraSnapshot.js';
import RoomCameraFeed from '../RoomCameraFeed/index.jsx';
import CardFrame from '../CardFrame/index.jsx';
import { isFeatureEnabled } from '../../lib/features.js';

function EmptyState() {
  return (
    <CardFrame title="Room Cameras" bodyClassName="space-y-0.5 text-sm">
      <p className="text-center text-slate-400">No room cameras configured.</p>
      <p className="text-center text-slate-500">Add entries to server config to populate this list.</p>
    </CardFrame>
  );
}

const ORIENTATIONS = ['horizontal', 'vertical'];
const CAMERA_VISIBILITY_ROOT_MARGIN = '0px';

function normalizeOrientation(value, fallback) {
  if (ORIENTATIONS.includes(value)) {
    return value;
  }
  return fallback;
}

function useCameraPanelSubscriptionGate() {
  const panelRef = useRef(null);
  const [isPanelVisible, setIsPanelVisible] = useState(false);

  useEffect(() => {
    /*
      Browser visibility can only be measured after React has mounted a real DOM
      node. Starting closed avoids a short subscribe/unsubscribe burst for room
      camera panels that mount below the fold.
    */
    const panel = panelRef.current;
    if (!panel || typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }

    let intersectsViewport = true;

    const publishVisibility = () => {
      /*
        Server upload bandwidth is only saved when the socket subscription is
        actually disabled. Combining viewport intersection with page visibility
        means a scrolled-away panel and a hidden browser tab both stop receiving
        room-camera frame uploads from socketGateway.js.
      */
      setIsPanelVisible(intersectsViewport && document.visibilityState !== 'hidden');
    };

    const handlePageVisibilityChange = () => {
      /*
        IntersectionObserver is about layout visibility, while the Page
        Visibility API is about whether the tab itself can be seen. The latter
        matters here because a background tab can still keep a mounted panel and
        socket alive unless we explicitly close the subscription gate.
      */
      publishVisibility();
    };

    document.addEventListener('visibilitychange', handlePageVisibilityChange);

    if (typeof IntersectionObserver !== 'function') {
      /*
        Without IntersectionObserver we cannot cheaply know whether the panel is
        clipped by a scroll container. Fall back to page visibility so browsers
        without the observer still behave correctly, just without scroll-based
        bandwidth savings.
      */
      publishVisibility();
      return () => {
        document.removeEventListener('visibilitychange', handlePageVisibilityChange);
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        /*
          A zero root margin keeps the bandwidth gate strict: the browser only
          subscribes once the panel intersects the viewport. If the first frame
          feels too delayed in real use, this constant can be widened later.
        */
        intersectsViewport = Boolean(entry?.isIntersecting);
        publishVisibility();
      },
      { root: null, rootMargin: CAMERA_VISIBILITY_ROOT_MARGIN, threshold: 0 },
    );

    observer.observe(panel);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', handlePageVisibilityChange);
    };
  }, []);

  return { panelRef, isPanelVisible };
}

export default function RoomCameraPanel(props) {
  const enabled = useSessionSelector((state) =>
    isFeatureEnabled(state, 'roomCameras') || isFeatureEnabled(state, 'ptzCamera'),
  );

  /*
    Camera-panel visibility belongs with the panel. PTZ is included here because
    the user-facing request is "show it as a room camera"; the rendering path
    still uses the same RoomCameraFeed tile as ordinary room cameras.
  */
  if (!enabled) return null;

  return <RoomCameraPanelContent {...props} />;
}

function RoomCameraPanelContent({
  defaultOrientation = 'horizontal',
  orientation: forcedOrientation,
  hideLayoutToggle = false,
  hideHeader = false,
  panelId = null,
}) {
  const roomCamerasEnabled = useSessionSelector((state) => isFeatureEnabled(state, 'roomCameras'));
  const ptzEnabled = useSessionSelector((state) => isFeatureEnabled(state, 'ptzCamera'));
  const ptz = useSessionSelector((state) => state.session?.ptzCamera || null);
  const cameras = useSessionSelector((state) => state.session?.roomCameras || []);
  const cameraSources = useMemo(() => {
    const base = roomCamerasEnabled ? cameras : [];
    if (!ptzEnabled || !ptz) return base;
    /*
      PTZ snapshots use a different socket namespace from room cameras, but the
      display model is intentionally the same: an id, a label, and a feed object.
      Marking the type lets the subscription layer stay separate while the tile
      renderer remains shared.
    */
    return [
      ...base,
      {
        id: PTZ_CAMERA_ID,
        name: ptz.name || 'PTZ Camera',
        type: 'ptz',
      },
    ];
  }, [cameras, ptz, ptzEnabled, roomCamerasEnabled]);
  const cameraIds = useMemo(
    () => cameraSources.filter((camera) => camera.type !== 'ptz').map((camera) => camera.id),
    [cameraSources],
  );
  const { panelRef, isPanelVisible } = useCameraPanelSubscriptionGate();
  const feedMap = useRoomCameraSnapshots(cameraIds, { enabled: isPanelVisible });
  const ptzFeeds = usePtzCameraSnapshots([PTZ_CAMERA_ID], { enabled: isPanelVisible && ptzEnabled });
  const { value: orientationSettings, save: saveOrientationSettings } = useSettingsNamespace('roomCameraPanels', {});
  const [orientation, setOrientation] = useState(() =>
    normalizeOrientation(
      panelId ? orientationSettings?.[panelId] : defaultOrientation,
      'horizontal',
    ),
  );
  const storedOrientation = panelId ? orientationSettings?.[panelId] : null;
  const effectiveOrientation = forcedOrientation
    ? normalizeOrientation(forcedOrientation, 'horizontal')
    : normalizeOrientation(
        /*
          Settings are external state, so derive from them during render instead
          of mirroring them into local state from an effect. Local state remains
          useful as the immediate value after clicking the layout toggle, while
          stored settings win once the settings provider has loaded or saved.
        */
        storedOrientation || orientation,
        'horizontal',
      );
  const containerClass =
    effectiveOrientation === 'vertical' ? 'flex flex-col gap-0.5' : 'grid gap-0.5 md:grid-cols-2';
  const showLayoutToggle = !hideLayoutToggle && !forcedOrientation && cameraSources.length > 0;
  const applyOrientation = (next) => {
    setOrientation(next);
    if (panelId) {
      saveOrientationSettings((current) => ({ ...(current || {}), [panelId]: next }));
    }
  };

  if (cameraSources.length === 0) {
    return (
      <div ref={panelRef}>
        <EmptyState />
      </div>
    );
  }

  const actions = showLayoutToggle ? (
    <div className="flex items-center gap-0.5 text-[0.68rem] text-slate-400">
      <span>Layout</span>
      <div className="inline-flex overflow-hidden rounded border border-slate-700">
        {ORIENTATIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`px-1 py-0.5 ${effectiveOrientation === option ? 'bg-slate-600 text-white' : 'bg-transparent text-slate-400 hover:text-white'}`}
            onClick={() => applyOrientation(option)}
          >
            {option === 'vertical' ? 'Vertical' : 'Grid'}
          </button>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div ref={panelRef}>
      <CardFrame
        title="Room cameras"
        actions={actions}
        hideHeader={hideHeader}
        bodyClassName="space-y-0.5 text-base"
      >
        <div className={containerClass}>
          {cameraSources.map((camera) => {
            const feed = camera.type === 'ptz' ? ptzFeeds[camera.id] || null : feedMap[camera.id] || null;
            return (
              <article key={camera.id} className="w-full space-y-0.5 p-0.5">
                {/* <header className="space-y-0.5">
                  <p className="text-lg font-semibold text-white">{camera.name || camera.id}</p>
                  {camera.description && <p className="text-xs text-slate-500">{camera.description}</p>}
                </header> */}
                <RoomCameraFeed feed={feed} label={camera.name || camera.id} />
              </article>
            );
          })}
        </div>
      </CardFrame>
    </div>
  );
}
