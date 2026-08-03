// Mobile Driver Tabs
// Purpose: Owns the shared mobile tab selector, state, and per-tab modules.
import { useCallback, useState } from 'react';
import Tabs, { Tab, TabList, TabPanels } from '../../../components/Tabs/index.jsx';
import { useSessionSelector } from '../../../context/SessionContext.jsx';
import { useControlSelector } from '../../../controls/index.js';
import { useSettingsNamespace } from '../../../settings/index.js';
import MobileChatTab from '../tabs/mobile/ChatTab/index.jsx';
import RoomControlsTab from '../tabs/mobile/RoomControlsTab/index.jsx';
import ActivitiesTab from '../tabs/shared/ActivitiesTab/index.jsx';
import VipTab from '../tabs/shared/VipTab/index.jsx';
import HelpTab from '../tabs/shared/HelpTab/index.jsx';
import SettingsTab from '../tabs/shared/SettingsTab/index.jsx';

export default function MobileTabs() {
  const [activeTab, setActiveTab] = useState('chat');
  const isVerified = useSessionSelector((state) => Boolean(state.session?.isVerified));
  const ownRoverId = useSessionSelector((state) => String(state.session?.assignment?.roverId || '').trim());
  const ownAudioForward = useSessionSelector((state) => ownRoverId ? state.session?.audioForward?.[ownRoverId] || null : null);
  const pttActive = useControlSelector((control) => Boolean(control.state.mic?.pttActive));
  const { value: vipAudio } = useSettingsNamespace('vipAudio', { openMicEnabled: false, pttMode: 'live' });
  const pttMode = vipAudio?.pttMode === 'clip' ? 'clip' : 'live';
  const vipMicActive = Boolean(ownRoverId && isVerified && (pttMode === 'clip' ? pttActive : (vipAudio?.openMicEnabled || pttActive)));
  const vipClipPlaying = Boolean(ownRoverId && isVerified && pttMode === 'clip' && ownAudioForward?.source === 'upload' && ownAudioForward?.state === 'playing');
  const handleTabChange = useCallback((tab) => setActiveTab(tab), []);

  return (
    <section className="mobile-tabs-snap text-base">
      <Tabs defaultTab="chat" currentTab={activeTab} onTabChange={handleTabChange}>
        <TabList>
          <Tab id="chat">Chat</Tab>
          <Tab id="activities">Activities</Tab>
          <Tab id="vip" highlight={vipClipPlaying ? 'green' : vipMicActive ? 'pink' : 'none'}>
            <span className="inline-flex items-center gap-0.5">
              <span>VIP</span>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${isVerified ? 'bg-emerald-400' : 'bg-amber-400'}`} aria-hidden="true" title={isVerified ? 'Verified' : 'Not verified'} />
            </span>
          </Tab>
          <Tab id="roomcontrols">Room Controls</Tab>
          <Tab id="help">Help</Tab>
          <Tab id="settings">Settings</Tab>
        </TabList>
        <TabPanels>
          <MobileChatTab />
          <ActivitiesTab />
          <VipTab />
          <RoomControlsTab />
          <HelpTab />
          <SettingsTab />
        </TabPanels>
      </Tabs>
    </section>
  );
}
