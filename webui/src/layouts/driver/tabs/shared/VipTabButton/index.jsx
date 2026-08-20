// Driver VIP Tab Button
// Purpose: Keeps verification and active-audio status identical across every driver layout.
import { Tab } from '../../../../../components/Tabs/index.jsx';
import { useControlSelector } from '../../../../../controls/index.js';
import { useSessionSelector } from '../../../../../context/SessionContext.jsx';
import { useSettingsNamespace } from '../../../../../settings/index.js';

export default function VipTabButton({ compact = false }) {
  const isVerified = useSessionSelector((state) => Boolean(state.session?.isVerified));
  const ownRoverId = useSessionSelector((state) => String(state.session?.assignment?.roverId || '').trim());
  const ownAudioForward = useSessionSelector((state) => (
    ownRoverId ? state.session?.audioForward?.[ownRoverId] || null : null
  ));
  const pttActive = useControlSelector((control) => Boolean(control.state.mic?.pttActive));
  const { value: vipAudio } = useSettingsNamespace('vipAudio', { openMicEnabled: false, pttMode: 'live' });
  const clipMode = vipAudio?.pttMode === 'clip';

  // Pink represents a live microphone path, while green means an uploaded clip
  // is actively forwarding. Keeping these conditions here prevents desktop and
  // mobile selectors from drifting away from the mounted VIP audio lifecycle.
  const micActive = Boolean(
    ownRoverId
      && isVerified
      && (clipMode ? pttActive : (vipAudio?.openMicEnabled || pttActive)),
  );
  const clipPlaying = Boolean(
    ownRoverId
      && isVerified
      && clipMode
      && ownAudioForward?.source === 'upload'
      && ownAudioForward?.state === 'playing',
  );
  const dotSizeClass = compact ? 'h-1.5 w-1.5' : 'h-3 w-3';
  const gapClass = compact ? 'gap-0.5' : 'gap-2';

  return (
    <Tab id="vip" highlight={clipPlaying ? 'green' : micActive ? 'pink' : 'none'}>
      <span className={`inline-flex items-center ${gapClass}`}>
        <span>VIP</span>
        <span
          className={`inline-block rounded-full ${dotSizeClass} ${isVerified ? 'bg-emerald-400' : 'bg-red-600'}`}
          aria-hidden="true"
          title={isVerified ? 'Verified' : 'Not verified'}
        />
      </span>
    </Tab>
  );
}
