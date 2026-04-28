// Logs Row
// Purpose: Defines the Logs Row module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import LogPanel from '../../../components/LogPanel/index.jsx';

export default function LogsRow({ className = '' }) {
  return (
    <div className={`panel ${className}`}>
      <LogPanel />
    </div>
  );
}
