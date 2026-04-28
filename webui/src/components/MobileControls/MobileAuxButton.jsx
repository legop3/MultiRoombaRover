// Hold-to-run aux motor button for mobile controls.
export default function MobileAuxButton({ id, label, values, color, disabled, onPress, onRelease }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(event) => {
        event.preventDefault();
        onPress(id, values);
      }}
      onPointerUp={() => onRelease(id)}
      onPointerLeave={() => onRelease(id)}
      onPointerCancel={() => onRelease(id)}
      onContextMenu={(event) => event.preventDefault()}
      className={`flex h-full w-full items-center justify-center rounded-xl border-2 px-1 py-0.75 text-center text-sm font-semibold text-white transition select-none no-touch-select ${color} hover:brightness-110 active:brightness-125 active:scale-[0.99] disabled:opacity-30`}
    >
      {label}
    </button>
  );
}
