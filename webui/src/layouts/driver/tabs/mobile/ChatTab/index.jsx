// Mobile Chat Tab
// Purpose: Owns the mobile chat and compact supporting-card composition.
import ChatPanel from '../../../../../components/ChatPanel/index.jsx';
import SocialButtonsGrid from '../../../../../components/SocialButtonsGrid/index.jsx';
import OverseerPreferencePanel from '../../../../../components/OverseerPreferencePanel/index.jsx';
import RawUserPilePanel from '../../../../../components/RawUserPilePanel/index.jsx';
import { TabPanel } from '../../../../../components/Tabs/index.jsx';
import { useSessionSelector } from '../../../../../context/SessionContext.jsx';
import { isFeatureEnabled } from '../../../../../lib/features.js';
import { themeGapClass, themeStackClass } from '../../../../../themes/index.js';

export default function MobileChatTab() {
  const showOverseerPreferencePanel = useSessionSelector((state) => Boolean(state.session?.overseerVote?.votingEnabled));
  const showSocialButtons = useSessionSelector((state) => {
    /* Match the card's own gate so its absence cannot reserve an empty column. */
    const socials = Array.isArray(state.session?.socials) ? state.session.socials : [];
    return isFeatureEnabled(state, 'socials') && socials.length > 0;
  });

  return (
    <TabPanel id="chat">
      <div className={themeStackClass}>
        <ChatPanel nicknameLayout="stacked" />
        <div className={`grid items-start ${themeGapClass} ${showSocialButtons ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)]'}`}>
          {showSocialButtons ? <SocialButtonsGrid /> : null}
          <div className={`flex min-w-0 flex-col ${themeGapClass} ${showSocialButtons ? '' : 'max-w-sm'}`}>
            {showOverseerPreferencePanel ? <OverseerPreferencePanel /> : null}
            <RawUserPilePanel hideNicknameForm compact />
          </div>
        </div>
      </div>
    </TabPanel>
  );
}
