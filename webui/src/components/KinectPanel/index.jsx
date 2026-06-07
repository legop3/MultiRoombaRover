// Kinect Panel
// Purpose: Displays request-only Kinect image and 3D snapshots shared by the server.
// Scope: Owns browser socket events, cached frame display, request controls, and card layout.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import CardFrame from '../CardFrame/index.jsx';
import PointCloudViewer from './PointCloudViewer.jsx';
import {
  buildStatusPill,
  normalizeBinaryPayload,
  normalizeKinectStatus,
} from './utils.js';

export default function KinectPanel() {
  const socket = useSocket();
  const status = useSessionSelector((state) => normalizeKinectStatus(state.session?.kinect));
  const [activeView, setActiveView] = useState('3d');
  const [pointCloudFrame, setPointCloudFrame] = useState(null);
  const [colorUrl, setColorUrl] = useState(null);
  const [requestError, setRequestError] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!socket) return undefined;

    const handlePointCloudFrame = (meta = {}, buffer) => {
      const normalized = normalizeBinaryPayload(buffer);
      // The current 3D viewer only supports grid frames because the mesh needs
      // the original Kinect pixel layout.  Ignore old packed-point cached
      // frames so they cannot silently render as the retired dot-cloud view.
      if (!normalized || !meta?.grid) return;
      setPointCloudFrame({ meta, buffer: normalized });
      setActiveView('3d');
      setRequestError(null);
    };

    const handleColorFrame = (...args) => {
      const buffer = args[1];
      const normalized = normalizeBinaryPayload(buffer);
      if (!normalized) return;
      const blob = new Blob([normalized], { type: 'image/jpeg' });
      const nextUrl = URL.createObjectURL(blob);
      setColorUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return nextUrl;
      });
      setActiveView('image');
      setRequestError(null);
    };

    socket.on('kinect:pointCloudFrame', handlePointCloudFrame);
    socket.on('kinect:colorFrame', handleColorFrame);
    socket.emit('kinect:requestCachedFrames', {}, () => {});

    return () => {
      socket.off('kinect:pointCloudFrame', handlePointCloudFrame);
      socket.off('kinect:colorFrame', handleColorFrame);
    };
  }, [socket]);

  useEffect(() => () => {
    if (colorUrl) URL.revokeObjectURL(colorUrl);
  }, [colorUrl]);

  const cooldownRemainingMs = Math.max(0, Number(status.captureCooldownUntil || 0) - nowMs);
  const controlsDisabled = !status.enabled || status.busy || cooldownRemainingMs > 0;
  const cooldownText = cooldownRemainingMs > 0 ? `${Math.ceil(cooldownRemainingMs / 1000)}s` : null;
  const statusPill = useMemo(
    () =>
      buildStatusPill({
        cooldownText,
        enabled: status.enabled,
        busy: status.busy,
        lastError: status.lastError,
      }),
    [cooldownText, status.busy, status.enabled, status.lastError],
  );
  const visibleError = requestError || status.lastError;

  const emitRequest = useCallback(
    (eventName) => {
      if (!socket || controlsDisabled) return;
      setRequestError(null);
      socket.emit(eventName, {}, (resp = {}) => {
        if (resp.error) {
          setRequestError(resp.error);
        }
      });
    },
    [controlsDisabled, socket],
  );

  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-0.5 text-[0.68rem] text-slate-400">
      <span className={`inline-flex min-w-[3.7rem] justify-center rounded border px-1 py-0.5 text-xs font-semibold ${statusPill.className}`}>
        {statusPill.label}
      </span>
      <div className="inline-flex overflow-hidden rounded border border-slate-700">
        {['3d', 'image'].map((option) => (
          <button
            key={option}
            type="button"
            className={`px-1 py-0.5 ${activeView === option ? 'bg-slate-600 text-white' : 'bg-transparent text-slate-400 hover:text-white'}`}
            onClick={() => setActiveView(option)}
          >
            {option === '3d' ? '3D' : 'Image'}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="button-dark px-1 py-0.25"
        disabled={controlsDisabled}
        onClick={() => emitRequest('kinect:requestPointCloud')}
      >
        Request 3D
      </button>
      <button
        type="button"
        className="button-dark px-1 py-0.25"
        disabled={controlsDisabled}
        onClick={() => emitRequest('kinect:requestColorImage')}
      >
        Request Image
      </button>
    </div>
  );

  return (
    <CardFrame title="Kinect Viewer" actions={actions} bodyClassName="space-y-0.5 p-0.5 text-sm">
      <div className="aspect-[4/3] w-full overflow-hidden rounded bg-black">
        {activeView === '3d' && pointCloudFrame?.buffer ? (
          <PointCloudViewer frame={pointCloudFrame} />
        ) : activeView === '3d' ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-slate-400">
            Request a 3D frame
          </div>
        ) : colorUrl ? (
          <img src={colorUrl} alt="Kinect image" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-center text-sm text-slate-400">
            Request an image
          </div>
        )}
      </div>
      {visibleError ? (
        <p className="m-0 break-words text-[0.7rem] text-red-300">{String(visibleError).toLowerCase()}</p>
      ) : null}
    </CardFrame>
  );
}
