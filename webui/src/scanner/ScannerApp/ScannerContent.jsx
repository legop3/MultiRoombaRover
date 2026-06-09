// Scanner Content
// Purpose: Provides the rover-facing IO page for the server-run barcode scanner system.
// Scope: Captures keyboard-style scanner input, emits raw scans, renders server state, and plays local beep/TTS output.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';
import { useSpectatorMode } from '../../hooks/useSpectatorMode.js';
import useDefaultNickname from '../../hooks/useDefaultNickname.js';
import useUserIdentitySync from '../../hooks/useUserIdentitySync.js';
import SocketConnectionPill from '../../components/SocketConnectionPill/index.jsx';
import useScannerSpeech from './useScannerSpeech.js';
import ScannerVoiceSetup from './ScannerVoiceSetup.jsx';

const EMPTY_SCANNER_STATE = {
  beepAllowed: false,
  lastScan: null,
  registryError: null,
};

function playSubmitBeep() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  const audioContext = new AudioContextClass();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;

  // The beep is deliberately short and loud because it confirms that the scan
  // computer submitted input. It is not tied to success; success/failure comes
  // back from the server as the large display text and spoken label.
  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(980, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.95, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.22);
  oscillator.onended = () => {
    audioContext.close().catch(() => {});
  };
}

export default function ScannerContent() {
  const socket = useSocket();
  const setupMode = new URLSearchParams(window.location.search).get('setup') === 'voice';
  const inputRef = useRef(null);
  const flashTimerRef = useRef(null);
  const [scannerState, setScannerState] = useState(EMPTY_SCANNER_STATE);
  const [flashActive, setFlashActive] = useState(false);

  useDefaultNickname();
  useUserIdentitySync();
  useSpectatorMode();
  useScannerSpeech(scannerState.lastScan);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    focusInput();
  }, [focusInput]);

  useEffect(() => {
    return () => {
      window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  useEffect(() => {
    function handleScannerState(nextState = {}) {
      setScannerState({
        ...EMPTY_SCANNER_STATE,
        ...(nextState && typeof nextState === 'object' ? nextState : {}),
      });
    }

    socket.on('barcode:state', handleScannerState);
    return () => {
      socket.off('barcode:state', handleScannerState);
    };
  }, [socket]);

  const submitScan = useCallback(() => {
    const code = String(inputRef.current?.value || '').trim();
    if (!code) {
      focusInput();
      return;
    }

    if (scannerState.beepAllowed) {
      // The flash is paired with the local submit beep so rovers get an
      // immediate visual confirmation that the scanner computer accepted input.
      // It is intentionally not a success indicator; the server result still
      // arrives separately as the resolved text and spoken label.
      window.clearTimeout(flashTimerRef.current);
      setFlashActive(true);
      flashTimerRef.current = window.setTimeout(() => {
        setFlashActive(false);
      }, 120);
      playSubmitBeep();
    }

    // The page intentionally sends only raw scanner text. The server reloads
    // the barcode registry, resolves labels/types, applies access policy, and
    // broadcasts the display state back to every scanner page.
    socket.emit('barcode:scan', { code }, () => {});
    inputRef.current.value = '';
    focusInput();
  }, [focusInput, scannerState.beepAllowed, socket]);

  const lastScan = scannerState.lastScan;
  const label = lastScan?.label || 'waiting';

  if (setupMode) {
    return <ScannerVoiceSetup />;
  }

  return (
    <main
      className={`flex min-h-screen cursor-default flex-col items-center justify-center overflow-hidden px-6 text-center ${
        flashActive ? 'bg-white text-black' : 'bg-black text-white'
      }`}
      onClick={focusInput}
    >
      <input
        ref={inputRef}
        aria-label="barcode scanner input"
        className="absolute left-0 top-0 h-px w-px opacity-0"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          submitScan();
        }}
      />
      <section className="flex min-h-screen w-full items-center justify-center">
        <h1 className="max-w-full break-words text-[18vw] font-black leading-none tracking-normal">
          {label}
        </h1>
      </section>
      <SocketConnectionPill />
    </main>
  );
}
