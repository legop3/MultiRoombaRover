export default function HelpPanel({ layout }) {
  const presets = {
    desktop: [
      'Use WASD + Shift to drive. Video must stay focused.',
      'Macros on the left prep the rover before moving.',
      'Switch tabs on the right for telemetry, room, and advanced tools.',
    ],
    'mobile-portrait': [
      'Keep joystick centered when not driving.',
      'Auxiliary buttons sit beside the joystick – use them carefully.',
      'Scroll to access drive/telemetry if screen space is limited.',
    ],
    'mobile-landscape': [
      'Joystick and video are side by side for game-style control.',
      'Rotate back to portrait if you need admin controls quickly.',
      'Tabs are desktop-only; mobile shows sections stacked.',
    ],
  };
  const tips = presets[layout] || presets.desktop;
  return (
    <section className="rounded-sm bg-[#242a32] p-1 text-base text-slate-100">
      <p className="text-sm text-slate-400">Help</p>
      <ul className="mt-1 space-y-1 text-sm">
        {tips.map((tip) => (
          <li key={tip} className="rounded-sm bg-black/30 px-1 py-1 text-slate-200">
            {tip}
          </li>
        ))}
      </ul>
    </section>
  );
}
