// Scanner App Root
// Purpose: Exposes the dedicated scanner route as a separate spectator-style app surface.
// Scope: Keeps route wiring thin so scanner behavior remains isolated in ScannerContent.
import ScannerContent from './ScannerContent.jsx';

export default function ScannerAppRoot() {
  return <ScannerContent />;
}
