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

  /*
    Navigating away from the driver route unmounts its identity hooks. The PTZ
    route is still an active control surface, so it must keep the same driver
    identity heartbeat alive instead of allowing the session to become passive
    while someone operates or waits for the camera.
  */
  useDefaultNickname();
  useIncomingInterInstanceTransfer();
  useUserIdentitySync({ identitySurface: 'driver' });

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
