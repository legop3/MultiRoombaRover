import { useMemo } from 'react';
import { useControlSelector } from '../../controls/index.js';
import { formatKeyLabel } from '../../controls/keymapUtils.js';
import NicknameForm from '../NicknameForm/index.jsx';
import SocialButton from '../SocialButton/index.jsx';
import KeyPill from '../vip/VipAudioUploadCard/KeyPill.jsx';

function ControlRow({ label, keyLabel }) {
  return (
    <div className="surface-muted flex items-center justify-between gap-0.5 px-0.5 py-0.35 text-[0.8rem] text-slate-200">
      <span>{label}</span>
      <KeyPill label={keyLabel} />
    </div>
  );
}

function DesktopQuickstart({ keymap }) {
  return (
    <div className="space-y-0.5">
      <p className="text-sm text-slate-200">1. Press "Start Driving" put your rover into driving mode.</p>
      <div className="space-y-0.5">
        <p className="text-sm text-slate-200">2. Use the drive controls to move your rover:</p>
        <div className="space-y-0.5">
          <ControlRow label="Forward" keyLabel={formatKeyLabel(keymap?.driveForward?.[0])} />
          <ControlRow label="Backward" keyLabel={formatKeyLabel(keymap?.driveBackward?.[0])} />
          <ControlRow label="Turn Left" keyLabel={formatKeyLabel(keymap?.driveLeft?.[0])} />
          <ControlRow label="Turn Right" keyLabel={formatKeyLabel(keymap?.driveRight?.[0])} />
          <ControlRow label="Move faster" keyLabel={formatKeyLabel(keymap?.boostModifier?.[0])} />
          <ControlRow label="Move slower" keyLabel={formatKeyLabel(keymap?.slowModifier?.[0])} />
        </div>
      </div>
      <p className="text-sm text-slate-200">3. When done, enter "Docking Assist" and line up the front sensor with the dock sensor.</p>
    </div>
  );
}

function MobileQuickstart() {
  return (
    <div className="space-y-0.5 text-sm text-slate-200">
      <p>1. Press "Start Driving" put your rover into driving mode.</p>
      <p>2. Touch and hold in Joystick area to move.</p>
      <p>3. Use the other column for motor, horn, and camera controls.</p>
      <p>4. When done, enter "Docking Assist" and line up the front sensor with the dock sensor.</p>
    </div>
  );
}

export default function QuickstartOverlay({
  visible,
  layout,
  showOnLoad,
  onToggleShowOnLoad,
  onOpenHelp,
  onClose,
}) {
  const rawKeymap = useControlSelector((control) => control.state.keymap);
  const isDesktop = layout === 'desktop';
  const keymap = useMemo(() => rawKeymap || {}, [rawKeymap]);

  if (!visible) return null;

  const handleCheckbox = (event) => {
    const keepShowing = !event.target.checked;
    onToggleShowOnLoad?.(keepShowing);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/75 p-0.5 items-center">
      <div className="pointer-events-auto surface w-full max-w-3xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-0.5 py-0.35 text-sm text-slate-200">
          <span className="font-semibold text-xl">Welcome! To get started:</span>
          {/* <button type="button" onClick={onClose} className="button-dark px-1 py-0.25 text-[0.8rem]">
            Close
          </button> */}
        </div>
        <div className={`grid gap-0.5 p-0.5 ${isDesktop ? 'md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]' : 'grid-cols-1'}`}>
          <section className="space-y-0.5 border-b border-slate-700">
            {isDesktop ? <DesktopQuickstart keymap={keymap} /> : <MobileQuickstart />}
          </section>
          {/* {!isDesktop? <div className='w-full h-1 bg-blue-500'></div> : null} */}
          <section className="space-y-0.5">
            <p className='text-left'>Next...</p>
            <div className="surface space-y-0.5 p-0.5 border-b border-slate-700">
              <p className="text-xl font-semibold text-slate-200">Set your nickname</p>
              <p className="text-sm font-semibold text-slate-200">Nicknames are assigned randomly by default, you can change yours here.</p>
              <NicknameForm compact />
            </div>
            <div className="surface p-0.5">
              <p className="text-xl font-semibold text-slate-200">Join our Discord server!</p>
              <p className="text-sm font-semibold text-slate-200">We have an active and welcoming community :3</p>
              <SocialButton id="discord" label="Join Discord" />
            </div>
          </section>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-0.5 border-t border-slate-700 px-0.5 py-0.35 text-[0.8rem]">
          <label className="flex items-center gap-0.5 text-slate-300">
            <input
              type="checkbox"
              checked={!showOnLoad}
              onChange={handleCheckbox}
              className="accent-cyan-500"
            />
            <span>Don&apos;t show again</span>
          </label>
          <div className="flex items-center gap-0.5">
            {/* <button type="button" onClick={onOpenHelp} className="button-dark px-1 py-0.25">
              Open full Help
            </button> */}
            <button type="button" onClick={onClose} className="button-dark px-1 py-0.25 text-2xl bg-green-600 hover:bg-green-400 hover:border-green-100 border-green-400">
              Got it! Let me in!
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
