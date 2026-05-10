// Fullscreen Prompt
// Purpose: Defines the Fullscreen Prompt module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
export default function FullscreenPrompt({ visible, mode, onEnterFullscreen, onDismiss }) {
  if (!visible) return null;
  const isIOSMode = mode === 'pwa-hint';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-1 pointer-events-none bg-black/20">
      <div className="pointer-events-auto w-full max-w-sm surface center">
        <div className="space-y-0.5 p-1 text-sm text-slate-100">
          <h2 className="text-base font-semibold text-white border-b border-slate-700">Better in fullscreen!</h2>
          {isIOSMode ? (
            <p className="text-slate-300">
              For fullscreen on iOS, open Safari's share menu and pick <strong>Add to Home Screen</strong>. Launching from
              the home screen then makes it fullscreen.
            </p>
          ) : (
            <p className="text-slate-300">
              Enable fullscreen to free up more space for the video feed and controls. You can exit fullscreen at any time
              via the system back or home gesture.
            </p>
          )}
          <p className="text-xs border-t border-b border-slate-700 p-0.5 text-blue-300 text-center">This will only show once just to let you know. There is a fullscreen button in the bottom right for later use.</p>

          <div className="flex justify-end gap-0.5 pt-1 text-sm">
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
