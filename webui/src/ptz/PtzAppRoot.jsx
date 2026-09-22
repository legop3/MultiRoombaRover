// Dedicated PTZ Route Root
// Purpose: Mounts the PTZ controller as a real page with the same shared input
// and identity systems used by the driver page.
// Scope: Owns route-level providers and responsive selection only; camera state,
// queue policy, and the visible controller remain in the shared PTZ component.
import AlertFeed from '../components/AlertFeed/index.jsx';
import SocketConnectionPill from '../components/SocketConnectionPill/index.jsx';
import { PtzControllerPage } from '../components/PtzCamera/index.jsx';
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
