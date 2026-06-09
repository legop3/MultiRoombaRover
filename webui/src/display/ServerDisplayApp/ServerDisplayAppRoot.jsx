// Server Display App Root
// Purpose: Defines the route root for the physical-room display page.
// Scope: Keeps this passive spectator-style surface separate from the main driver UI.
import ServerDisplayContent from './ServerDisplayContent.jsx';

export default function ServerDisplayAppRoot() {
  return <ServerDisplayContent />;
}
