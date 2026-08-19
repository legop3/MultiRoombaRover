// Driver Layout Root
// Purpose: Selects and frames the concrete desktop or mobile driver composition.
// Scope: Owns layout-only mobile framing so App.jsx does not place page cards.
import DesktopLayout from './DesktopLayout/index.jsx';
import OldDesktopLayout from './OldDesktopLayout/index.jsx';
import MobilePortraitLayout from './MobilePortraitLayout/index.jsx';
import MobileLandscapeLayout from './MobileLandscapeLayout/index.jsx';
import { useDriverLayout } from './DriverLayoutContext.jsx';

export default function DriverLayoutRoot({ oldDesktop = false }) {
  const layout = useDriverLayout();

  if (layout === 'desktop') {
    // /old changes only the desktop composition. Mobile keeps one canonical
    // portrait/landscape implementation regardless of which desktop URL was opened.
    return oldDesktop ? <OldDesktopLayout /> : <DesktopLayout />;
  }

  return layout === 'mobile-landscape' ? <MobileLandscapeLayout /> : <MobilePortraitLayout />;
}
