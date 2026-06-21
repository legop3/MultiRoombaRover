// Duplicate Identity Overlay
// Purpose: Blocks an older non-verified driver tab after the server detects the same identity in another driver tab.
// Scope: Presents a driver-page-only message while leaving enforcement owned by the server.
import { useSessionSelector } from '../../context/SessionContext.jsx';

export default function DuplicateIdentityOverlay() {
  const duplicateIdentityBlock = useSessionSelector((state) => state.duplicateIdentityBlock);

  if (!duplicateIdentityBlock) {
    return null;
  }

  const message =
    typeof duplicateIdentityBlock?.message === 'string' && duplicateIdentityBlock.message.trim()
      ? duplicateIdentityBlock.message.trim()
      : 'This driver session is already active in another tab.';

  return (
    <div className="pointer-events-auto fixed inset-0 z-[2000] flex items-center justify-center bg-black px-0.5 py-0.5 text-slate-100">
      <section className="surface w-full max-w-md space-y-0.5 text-center shadow-2xl">
        <div className="space-y-0.5">
          <h1 className="text-lg font-semibold text-white">Another driver tab is already open</h1>
          <p className="text-sm text-slate-300">{message}</p>
        </div>
        {/* <div className="surface-muted space-y-0.5">
          <p className="text-sm text-slate-100">
            Continue from the newest tab or close this one.
          </p>
          <p className="text-xs text-slate-400">
            Verified users are allowed to keep multiple tabs open.
          </p>
        </div> */}
      </section>
    </div>
  );
}
