// Floating Fullscreen Button
// Purpose: Defines the Floating Fullscreen Button module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
export default function FloatingFullscreenButton({ side = 'right', onClick }) {
  const sideClass = side === 'left' ? 'left-2' : 'right-2';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`fixed bottom-2 ${sideClass} z-30 flex h-10 w-10 items-center justify-center rounded-full border border-cyan-200/50 bg-slate-900/70 text-cyan-100 shadow-lg backdrop-blur-sm transition hover:bg-slate-800/80 active:scale-95`}
      aria-label="Enter fullscreen"
      title="Enter fullscreen"
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        aria-hidden="true"
        className="pointer-events-none"
      >
        <path
          d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
