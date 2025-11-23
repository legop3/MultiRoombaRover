export default function FullscreenPrompt({ visible, mode, onEnterFullscreen, onDismiss }) {
  if (!visible) return null;
  const isIOSMode = mode === 'pwa-hint';

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center p-2 pointer-events-none sm:items-center">
      <div className="pointer-events-auto w-full max-w-sm rounded-lg border border-cyan-500/40 bg-zinc-950/95 shadow-xl">
        <div className="space-y-2 p-4 text-sm text-slate-100">
          <h2 className="text-base font-semibold text-white">Better in fullscreen</h2>
          {isIOSMode ? (
            <p className="text-slate-300">
              For fullscreen on iOS, open Safari&apos;s share menu and pick <strong>Add to Home Screen</strong>. Launching from
              the home screen removes the browser chrome.
            </p>
          ) : (
            <p className="text-slate-300">
              Enable fullscreen to free up more space for the video feed and controls. You can exit fullscreen at any time
              via the system back or home gesture.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1 text-sm">
            <button type="button" className="rounded border border-slate-600 px-3 py-1 text-slate-200" onClick={onDismiss}>
              {isIOSMode ? 'Got it' : 'Not now'}
            </button>
            {!isIOSMode && (
              <button
                type="button"
                className="rounded bg-cyan-500 px-3 py-1 font-semibold text-black hover:bg-cyan-400"
                onClick={onEnterFullscreen}
              >
                Enter fullscreen
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
