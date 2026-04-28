// Log panel wrapper row for spectator layout.
import LogPanel from '../../../components/LogPanel/index.jsx';

export default function LogsRow({ className = '' }) {
  return (
    <div className={`panel ${className}`}>
      <LogPanel />
    </div>
  );
}
