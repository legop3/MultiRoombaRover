// Dedicated PTZ Route Root
// Purpose: Mounts the PTZ controller as a real page with the same shared input
// and identity systems used by the driver page.
// Scope: Mounts input/identity providers; the page owns session entry and layouts.
import AlertFeed from '../components/AlertFeed/index.jsx';
import SocketConnectionPill from '../components/SocketConnectionPill/index.jsx';
import PtzControllerPage from './PtzControllerPage.jsx';
import {
  ControlSystemProvider,
  GamepadInputManager,
  KeyboardInputManager,
} from '../controls/index.js';
import useDefaultNickname from '../hooks/useDefaultNickname.js';
import useIncomingInterInstanceTransfer from '../hooks/useIncomingInterInstanceTransfer.js';
import useLayoutMode from '../hooks/useLayoutMode.js';
import useUserIdentitySync from '../hooks/useUserIdentitySync.js';

function PtzRouteContent() {
  const layout = useLayoutMode();

  useDefaultNickname();
  useIncomingInterInstanceTransfer();
  useUserIdentitySync({ identitySurface: 'ptz' });

  return (
    <ControlSystemProvider>
      <KeyboardInputManager />
      <GamepadInputManager />
      <PtzControllerPage layout={layout} />
      <AlertFeed />
      <SocketConnectionPill />
    </ControlSystemProvider>
  );
}

export default function PtzAppRoot() {
  return <PtzRouteContent />;
}
