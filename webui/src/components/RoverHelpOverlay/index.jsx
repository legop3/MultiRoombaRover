// Rover Help Overlay
// Purpose: Gives every rover surface one unmistakable, responsive HELP treatment.
// Scope: Renders only the shared visual; server roster state decides when it is active.
import AutoFitText from '../AutoFitText/index.jsx';
import './styles.css';

export default function RoverHelpOverlay({ active = false }) {
  if (!active) return null;

  return (
    <div
      className="rover-help-overlay pointer-events-none absolute inset-0 z-50 overflow-hidden border-[clamp(0.2rem,1.2cqw,1rem)] border-white bg-red-600 p-[clamp(0.2rem,2cqw,1.5rem)] text-white"
      role="status"
      aria-label="Rover needs help"
    >
      <AutoFitText
        fitHeight
        minSize={8}
        maxSize={1400}
        className="font-black tracking-tight text-white"
      >
        HELP
      </AutoFitText>
    </div>
  );
}
