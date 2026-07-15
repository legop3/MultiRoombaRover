// Session Document Title
// Purpose: Uses the configured local inter-instance profile name as the browser tab title.
// Scope: Owns only the document title lifecycle; the static HTML title remains the fallback.
import { useEffect } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';

const DEFAULT_DOCUMENT_TITLE = document.title;

export default function SessionDocumentTitle() {
  const interInstanceEnabled = useSessionSelector((state) => Boolean(state.session?.interInstances?.enabled));
  const interInstanceName = useSessionSelector((state) =>
    String(state.session?.interInstances?.profile?.name || '').trim(),
  );

  useEffect(() => {
    /*
      The static title from index.html remains the source of truth until the
      server confirms that inter-instance sharing is enabled and supplies a
      usable profile name. This prevents the profile's loading state from
      replacing the familiar fallback title with an empty or temporary value.
    */
    if (!interInstanceEnabled || !interInstanceName) return undefined;

    document.title = interInstanceName;

    /*
      Restore the static title when the synchronized profile disappears or the
      feature is disabled. React also runs this cleanup during development's
      StrictMode effect check, so the component never leaves a stale server name
      behind when its session-derived conditions stop being true.
    */
    return () => {
      document.title = DEFAULT_DOCUMENT_TITLE;
    };
  }, [interInstanceEnabled, interInstanceName]);

  return null;
}
