// Top-level mini summary app shell with hard-refresh timer and alerts.
import { useEffect } from 'react';
import AlertFeed from '../../components/AlertFeed/index.jsx';
import MiniSummaryContent from './MiniSummaryContent.jsx';
import { HARD_REFRESH_MS } from './constants.js';

export default function MiniSummaryAppRoot() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const timer = setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('refresh', Date.now().toString());
      window.location.replace(url.toString());
    }, HARD_REFRESH_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <MiniSummaryContent />
      <AlertFeed scale={3} />
    </>
  );
}
