import { useEffect } from 'react';
import config from '../../config/driverAnalytics.json';

export default function DriverAnalytics() {
  useEffect(() => {
    if (!config.enabled) return;

    document.head.append(
      document
        .createRange()
        .createContextualFragment(config.tags.join('\n'))
    );
  }, []);

  return null;
}