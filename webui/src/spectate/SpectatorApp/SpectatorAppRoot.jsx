// Spectator App Root
// Purpose: Defines the Spectator App Root module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import ModeGateOverlay from '../../components/ModeGateOverlay/index.jsx';
import SpectatorContent from './SpectatorContent.jsx';

export default function SpectatorAppRoot() {
  return (
    <>
      <SpectatorContent />
      {/*
        The spectator route does not render App.jsx, so it must mount the gate
        overlay itself. This keeps admin/lockdown login behavior available on
        /spectate and, more importantly, gives external spectators a real
        AuthPanel when the bandwidth policy requires admin approval or admin
        login before spectating.
      */}
      <ModeGateOverlay includeSpectatorAccessGate />
    </>
  );
}
