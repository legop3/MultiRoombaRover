// Quickstart Overlay
// Purpose: First-run "welcome / get started" dialog shown on the driver page.
// Scope: Responsive CardFrame modal; owns modal accessibility/dismissal; reuses nickname, keybind, social controls.
import { useRef } from 'react';
import CardFrame from '../CardFrame/index.jsx';
import ControlHint from '../ControlHint/index.jsx';
import NicknameForm from '../NicknameForm/index.jsx';
import SocialButton from '../SocialButton/index.jsx';
import KeyPill from '../vip/VipAudioUploadCard/KeyPill.jsx';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { getSocialById } from '../../lib/socials.js';

function ControlRow({ label, actionId }) {
  return (
    <div className="surface-muted flex items-center justify-between gap-0.5 px-0.5 py-0.5 text-sm text-slate-200">
      <span>{label}</span>
      <KeyPill label={<ControlHint actionId={actionId} />} />
    </div>
  );
}

function DesktopQuickstart() {
  return (
    <div className="space-y-0.5">
      <p className="text-sm text-slate-200">1. Click &quot;Your rover is docked&quot; to undock.</p>
      <div className="space-y-0.5">
        <p className="text-sm text-slate-200">2. Drive with these keybindings:</p>
        <div className="space-y-0.5">
          <ControlRow label="Forward" actionId="driveForward" />
          <ControlRow label="Backward" actionId="driveBackward" />
          <ControlRow label="Turn Left" actionId="driveLeft" />
          <ControlRow label="Turn Right" actionId="driveRight" />
          <ControlRow label="Move faster" actionId="boostModifier" />
          <ControlRow label="Move slower" actionId="slowModifier" />
        </div>
      </div>
      <p className="text-sm text-slate-200">3. Use the video HUD for rover controls and information.</p>
      <p className="text-sm text-slate-200">4. Click &quot;Dock rover&quot; when finished.</p>
    </div>
  );
}

function MobileQuickstart() {
  return (
    <div className="space-y-0.5 text-sm text-slate-200">
      <p>1. Tap &quot;Your rover is docked&quot; to undock.</p>
      <p>2. Hold and drag on the drive pad.</p>
      <p>3. Choose Precision, Normal, or Turbo above the drive pad.</p>
      <p>4. Use the other column for rover controls.</p>
      <p>5. Tap &quot;Dock and charge&quot; when finished.</p>
    </div>
  );
}

function DiscordQuickstartCard() {
  const discord = useSessionSelector((state) => getSocialById(state, 'discord'));

  /*
    The section has explanatory text around the actual button, so SocialButton's
    own null return is not enough here. Keep the whole Discord prompt self-
    contained so layouts do not need a separate social feature check.
  */
  if (!discord?.url) return null;

  return (
    <CardFrame className="w-full" bodyClassName="space-y-0.5 p-0.5 text-base" title='Join our Discord server!'>
      {/* <p className="text-base font-semibold text-neutral-50">Join our Discord server!</p> */}
      <p className="text-sm font-semibold text-slate-200">We have an active and welcoming community.</p>
      <SocialButton id="discord" label="Join Discord" />
    </CardFrame>
  );
}

export default function QuickstartOverlay({
  visible,
  layout,
  showOnLoad,
  onToggleShowOnLoad,
  onClose,
}) {
  const isDesktop = layout === 'desktop';
  const dialogRef = useRef(null);

  if (!visible) return null;

  const handleCheckbox = (event) => {
    // "Don't show again" only records the preference; it does not dismiss the dialog.
    const keepShowing = !event.target.checked;
    onToggleShowOnLoad?.(keepShowing);
  };

  // Dismiss when clicking anywhere outside the dialog card.
  const handleScrimClick = (event) => {
    if (!dialogRef.current?.contains(event.target)) onClose?.();
  };

  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto bg-black/75 p-1"
      onClick={handleScrimClick}
    >
      <div className="mx-auto flex min-h-full w-full max-w-3xl items-center justify-center py-1">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Welcome!"
          className="w-full min-w-0"
        >
          <CardFrame
            title="Welcome! To get started"
            className="w-full"
            bodyClassName="space-y-0.5 p-0.5 text-base"
            actions={(
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="button-dark px-0.5 py-0.5 text-lg leading-none"
              >
                ×
              </button>
            )}
          >
            <div className={`grid min-w-0 gap-0.5 ${isDesktop ? 'md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]' : 'grid-cols-1'}`}>
              <section className="min-w-0 space-y-0.5">
                <CardFrame title='To get started:'>
                {isDesktop ? <DesktopQuickstart /> : <MobileQuickstart />}
                </CardFrame>
              </section>
              <section className="min-w-0 space-y-0.5">
                <CardFrame title="Set your nickname" bodyClassName="space-y-0.5 p-0.5 text-base">
                  <p className="text-sm font-semibold text-slate-200">Nicknames are assigned randomly by default, you can change yours here.</p>
                  <NicknameForm compact />
                </CardFrame>
                <DiscordQuickstartCard />
              </section>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-0.5 border-t border-neutral-500/50 pt-0.5 text-sm">
              <label className="flex items-center gap-0.5 text-slate-300">
                <input
                  type="checkbox"
                  checked={!showOnLoad}
                  onChange={handleCheckbox}
                  className="accent-cyan-500"
                />
                <span>Don&apos;t show again</span>
              </label>
              <button
                type="button"
                onClick={onClose}
                className="button-dark bg-green-600 px-1 py-0.5 text-base hover:border-green-100 hover:bg-green-400 border-green-400"
              >
                Got it! Let me in!
              </button>
            </div>
          </CardFrame>
        </div>
      </div>
    </div>
  );
}
