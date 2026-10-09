// Spectator App Root
// Purpose: Defines the Spectator App Root module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import RoomAudioPlayer from '../../components/RoomAudioPlayer/index.jsx';
import SpectatorContent from './SpectatorContent.jsx';

export default function SpectatorAppRoot() {
  return (
    <>
      <RoomAudioPlayer />
      <SpectatorContent />
    </>
  );
}
