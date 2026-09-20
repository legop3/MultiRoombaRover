import { useEffect } from 'react';
import { useSessionActions, useSessionSelector } from '../../context/SessionContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';

const BUTTONBOX_LIFETIME_MS = 5000;
const BARCODE_SCAN_LIFETIME_MS = 10 * 1000;

export default function useAlertEvents() {
  const buttonBoxButtons = useSessionSelector((state) => state.session?.buttonBox?.buttons);
  const { pushAlert } = useSessionActions();
  const socket = useSocket();

  useEffect(() => {
    function onButtonIncrement(payload = {}) {
      const buttonId = Number(payload.buttonId);
      if (!Number.isFinite(buttonId) || buttonId < 1 || buttonId > 4) return;
      const buttons = Array.isArray(buttonBoxButtons) ? buttonBoxButtons : [];
      const button = buttons.find((entry) => Number(entry?.id) === buttonId) || {};
      const count = Number.isFinite(payload.count) ? payload.count : Number(button.count) || 0;
      /*
        Event fields win over session fields because the button-box event is the
        exact outcome of this press. Session sync follows immediately after, but
        using it first can make fast toasts briefly show stale count/limit data.
      */
      const goal = Number.isFinite(payload.goal) ? payload.goal : Number.isFinite(button.goal) ? button.goal : 0;
      const dailyCount = Number.isFinite(payload.dailyCount)
        ? payload.dailyCount
        : Number.isFinite(button.dailyCount)
          ? button.dailyCount
          : 0;
      const dailyLimit = Number.isFinite(payload.dailyLimit)
        ? payload.dailyLimit
        : Number.isFinite(button.dailyLimit)
          ? button.dailyLimit
          : null;
      const rewardNumber = Number.isFinite(button.rewardNumber) ? button.rewardNumber : '?';
      const rewardName =
        typeof button.rewardName === 'string' && button.rewardName.trim()
          ? button.rewardName.trim()
          : 'Unassigned';
      const rewardDescription =
        typeof button.rewardDescription === 'string' && button.rewardDescription.trim()
          ? button.rewardDescription.trim()
          : null;
      const description =
        typeof payload.description === 'string' && payload.description.trim()
          ? payload.description.trim()
          : null;
      pushAlert({
        id: `buttonbox-active-${buttonId}`,
        kind: 'buttonbox-active',
        lifetimeMs: BUTTONBOX_LIFETIME_MS,
        payload: {
          buttonId,
          count,
          goal,
          dailyCount,
          dailyLimit,
          limited: Boolean(payload.limited),
          description,
          rewardNumber,
          rewardName,
          rewardDescription,
        },
      });
    }
    socket.on('buttonBox:increment', onButtonIncrement);
    return () => {
      socket.off('buttonBox:increment', onButtonIncrement);
    };
  }, [pushAlert, buttonBoxButtons, socket]);

  useEffect(() => {
    function onBarcodeScanned(payload = {}) {
      const label = typeof payload.label === 'string' && payload.label.trim()
        ? payload.label.trim()
        : payload.code || 'unknown barcode';
      /*
        Barcode scans use a fixed alert id because the scanner can fire quickly
        during games. Reusing the id makes the newest scan replace the previous
        barcode popup in AlertFeed's keyed visible map instead of building a
        stack of old scan cards that would hide the current wiki link.
      */
      pushAlert({
        id: 'barcode-scan-active',
        kind: 'barcode-scan',
        lifetimeMs: BARCODE_SCAN_LIFETIME_MS,
        payload: {
          ...payload,
          label,
        },
      });
    }

    socket.on('barcode:scanned', onBarcodeScanned);
    return () => {
      socket.off('barcode:scanned', onBarcodeScanned);
    };
  }, [pushAlert, socket]);

}
