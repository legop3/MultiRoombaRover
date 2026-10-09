import { useCallback } from 'react';
import { useSessionSelector } from '../context/SessionContext.jsx';

export default function useServerUrl() {
  const publicUrl = useSessionSelector((state) => state.session?.interInstances?.profile?.publicUrl);
  // The UI may be served by Vite while session data comes from the actual server.
  return useCallback((url) => new URL(url, publicUrl || window.location.origin).href, [publicUrl]);
}
