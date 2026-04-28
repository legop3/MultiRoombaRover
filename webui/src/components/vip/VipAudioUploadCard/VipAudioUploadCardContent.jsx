// Vip Audio Upload Card Content
// Purpose: Defines the Vip Audio Upload Card Content module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fieldClass } from '../constants.js';
import { useControlSystem } from '../../../controls/index.js';
import { formatKeyLabel } from '../../../controls/keymapUtils.js';
import { useSettingsNamespace } from '../../../settings/index.js';
import { MAX_UPLOAD_BYTES, TARGET_SAMPLE_RATE, RTC_CONFIG } from './constants.js';
import { bytesToBase64, buildAuthHeader } from './base64.js';
import {
  waitForIceGatheringComplete,
  waitForPeerConnected,
  configureSenderForLowLatency,
  waitForOutboundAudioFlow,
} from './whipTransport.js';
import { mergeFloatChunks, encodeWavMono16 } from './audioCodec.js';
import StatusIndicator from './StatusIndicator.jsx';
import KeyPill from './KeyPill.jsx';

export default function VipAudioUploadCard({
  ownRoverId = '',
  audioForwardByRover = {},
  playUploadedAudio,
  stopUploadedAudio,
  startMicWhip,
  readyMicWhip,
  stopMicWhip,
}) {
  const { state: controlState } = useControlSystem();
  const { value: vipAudio, save: saveVipAudio } = useSettingsNamespace('vipAudio', {
    openMicEnabled: false,
    pttMode: 'live',
  });

  const roverId = String(ownRoverId || '').trim();
  const [selectedUpload, setSelectedUpload] = useState(null);
  const [working, setWorking] = useState(false);
  const openMicEnabled = Boolean(vipAudio?.openMicEnabled);
  const pttMode = vipAudio?.pttMode === 'clip' ? 'clip' : 'live';
  const clipMode = pttMode === 'clip';

  const [micState, setMicState] = useState('idle');
  const [clipState, setClipState] = useState('idle');
  const [message, setMessage] = useState('');

  const streamRef = useRef(null);
  const audioTrackRef = useRef(null);
  const whipPcRef = useRef(null);
  const micActiveRef = useRef(false);
  const activeRoverRef = useRef('');

  const clipStreamRef = useRef(null);
  const clipAudioContextRef = useRef(null);
  const clipSourceRef = useRef(null);
  const clipProcessorRef = useRef(null);
  const clipMuteGainRef = useRef(null);
  const clipChunksRef = useRef([]);
  const clipRecordingRef = useRef(false);
  const clipSampleRateRef = useRef(TARGET_SAMPLE_RATE);

  const pttActive = Boolean(controlState?.mic?.pttActive);

  const selectedForwardState = useMemo(
    () => (roverId ? audioForwardByRover?.[roverId] || null : null),
    [audioForwardByRover, roverId],
  );

  const pipelineConnected = Boolean(
    selectedForwardState && selectedForwardState.state !== 'offline' && !selectedForwardState.error,
  );
  const uploadPlaying = Boolean(
    selectedForwardState?.source === 'upload' && selectedForwardState?.state === 'playing',
  );
  const micRelayActive = Boolean(
    selectedForwardState?.source === 'mic-whip' &&
      (selectedForwardState?.state === 'starting' || selectedForwardState?.state === 'playing'),
  );
  const micHot = Boolean(!clipMode && audioTrackRef.current && (openMicEnabled || pttActive));
  const whipLinkActive = !clipMode && (micState === 'live' || micState === 'starting');
  const clipRecording = clipMode && clipState === 'recording';
  const clipSending = clipMode && clipState === 'sending';
  const pttKeyLabel = formatKeyLabel(controlState?.keymap?.micPtt?.[0]) || 'M';

  const setPttMode = useCallback(
    (nextMode) => {
      const mode = nextMode === 'clip' ? 'clip' : 'live';
      saveVipAudio((current) => ({ ...(current || {}), pttMode: mode }));
    },
    [saveVipAudio],
  );

  const handleUploadPlay = async () => {
    if (!roverId) {
      setMessage('Take control of your rover first.');
      return;
    }
    if (!selectedUpload) {
      setMessage('Select an audio file first.');
      return;
    }
    if (selectedUpload.size > MAX_UPLOAD_BYTES) {
      setMessage(`File too large (max ${MAX_UPLOAD_BYTES} bytes).`);
      return;
    }

    setWorking(true);
    setMessage('');
    try {
      const buffer = await selectedUpload.arrayBuffer();
      const dataBase64 = bytesToBase64(new Uint8Array(buffer));
      await playUploadedAudio?.({
        roverId,
        name: selectedUpload.name,
        mime: selectedUpload.type || '',
        dataBase64,
      });
      setMessage('Upload playback started.');
    } catch (err) {
      setMessage(err?.message || 'Failed to play upload.');
    } finally {
      setWorking(false);
    }
  };

  const handleUploadStop = async () => {
    if (!roverId) {
      setMessage('Take control of your rover first.');
      return;
    }

    setWorking(true);
    setMessage('');
    try {
      await stopUploadedAudio?.(roverId);
      setMessage('Upload playback stopped.');
    } catch (err) {
      setMessage(err?.message || 'Failed to stop upload.');
    } finally {
      setWorking(false);
    }
  };

  const stopMicCapture = useCallback(
    async (targetRoverId) => {
      const target = String(targetRoverId || activeRoverRef.current || '').trim();
      micActiveRef.current = false;
      setMicState('idle');
      if (whipPcRef.current) {
        try {
          whipPcRef.current.getSenders().forEach((sender) => sender.track?.stop());
        } catch {
          // noop
        }
        try {
          whipPcRef.current.close();
        } catch {
          // noop
        }
      }
      whipPcRef.current = null;
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((track) => track.stop());
        } catch {
          // noop
        }
      }
      streamRef.current = null;
      audioTrackRef.current = null;
      if (target) {
        try {
          await stopMicWhip?.(target);
        } catch {
          // noop
        }
      }
      activeRoverRef.current = '';
    },
    [stopMicWhip],
  );

  const startWhipMic = useCallback(
    async (target) => {
      const startPayload = await startMicWhip?.(target);
      const whipUrl = String(startPayload?.whipUrl || '').trim();
      const token = String(startPayload?.token || '').trim();
      if (!whipUrl || !token) {
        throw new Error('WHIP endpoint unavailable');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: TARGET_SAMPLE_RATE,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      const track = stream.getAudioTracks()?.[0];
      audioTrackRef.current = track || null;
      if (track) {
        track.enabled = Boolean(openMicEnabled || pttActive);
      }
      if (track?.applyConstraints) {
        try {
          await track.applyConstraints({
            channelCount: 1,
            sampleRate: TARGET_SAMPLE_RATE,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          });
        } catch {
          // noop
        }
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      whipPcRef.current = pc;
      pc.onconnectionstatechange = () => {
        if (!micActiveRef.current) return;
        const state = pc.connectionState;
        if (state === 'connected') {
          setMicState('live');
          return;
        }
        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          setMicState('error');
          setMessage(`WHIP transport ${state}.`);
        }
      };
      stream.getAudioTracks().forEach((audioTrack) => {
        const sender = pc.addTrack(audioTrack, stream);
        configureSenderForLowLatency(sender);
      });

      const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc, 1800);

      const response = await fetch(whipUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
          ...buildAuthHeader(token),
        },
        body: pc.localDescription?.sdp || offer.sdp,
      });
      if (!response.ok) {
        throw new Error(`WHIP request failed: ${response.status}`);
      }
      const answerSdp = await response.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      await waitForPeerConnected(pc, 10000);
      await waitForOutboundAudioFlow(pc, 6000);
      await readyMicWhip?.(target);
    },
    [openMicEnabled, pttActive, readyMicWhip, startMicWhip],
  );

  const teardownClipPipeline = useCallback(async () => {
    clipRecordingRef.current = false;
    if (clipProcessorRef.current) {
      try {
        clipProcessorRef.current.disconnect();
      } catch {
        // noop
      }
      clipProcessorRef.current.onaudioprocess = null;
    }
    if (clipSourceRef.current) {
      try {
        clipSourceRef.current.disconnect();
      } catch {
        // noop
      }
    }
    if (clipMuteGainRef.current) {
      try {
        clipMuteGainRef.current.disconnect();
      } catch {
        // noop
      }
    }
    if (clipStreamRef.current) {
      try {
        clipStreamRef.current.getTracks().forEach((track) => track.stop());
      } catch {
        // noop
      }
    }
    if (clipAudioContextRef.current) {
      try {
        await clipAudioContextRef.current.close();
      } catch {
        // noop
      }
    }

    clipChunksRef.current = [];
    clipProcessorRef.current = null;
    clipSourceRef.current = null;
    clipMuteGainRef.current = null;
    clipStreamRef.current = null;
    clipAudioContextRef.current = null;
    clipSampleRateRef.current = TARGET_SAMPLE_RATE;
  }, []);

  const ensureClipPipeline = useCallback(async () => {
    if (clipStreamRef.current && clipAudioContextRef.current && clipProcessorRef.current) {
      return;
    }

    setClipState((prev) => (prev === 'recording' ? prev : 'arming'));

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: TARGET_SAMPLE_RATE,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const context = new AudioContext({ latencyHint: 'interactive' });
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(1024, 1, 1);
    const muteGain = context.createGain();
    muteGain.gain.value = 0;

    processor.onaudioprocess = (event) => {
      if (!clipRecordingRef.current) return;
      const input = event.inputBuffer.getChannelData(0);
      clipChunksRef.current.push(new Float32Array(input));
    };

    source.connect(processor);
    processor.connect(muteGain);
    muteGain.connect(context.destination);

    clipStreamRef.current = stream;
    clipAudioContextRef.current = context;
    clipSourceRef.current = source;
    clipProcessorRef.current = processor;
    clipMuteGainRef.current = muteGain;
    clipSampleRateRef.current = context.sampleRate || TARGET_SAMPLE_RATE;
  }, []);

  const finishClipRecording = useCallback(
    async ({ send }) => {
      const wasRecording = clipRecordingRef.current;
      clipRecordingRef.current = false;
      if (!wasRecording) {
        if (!send) setClipState('idle');
        return;
      }

      const chunks = clipChunksRef.current;
      clipChunksRef.current = [];

      if (!send) {
        setClipState('idle');
        return;
      }

      if (!roverId) {
        setClipState('idle');
        return;
      }

      if (!chunks.length) {
        setClipState('idle');
        return;
      }

      setClipState('sending');
      try {
        const merged = mergeFloatChunks(chunks);
        const wavBytes = encodeWavMono16(merged, clipSampleRateRef.current || TARGET_SAMPLE_RATE);
        const dataBase64 = bytesToBase64(wavBytes);
        await playUploadedAudio?.({
          roverId,
          name: `ptt-${Date.now()}.wav`,
          mime: 'audio/wav',
          dataBase64,
        });
        setClipState('idle');
      } catch (err) {
        setClipState('error');
        setMessage(err?.message || 'Failed to send PTT clip.');
      }
    },
    [playUploadedAudio, roverId],
  );

  const startClipRecording = useCallback(async () => {
    if (!roverId) {
      setMessage('Take control of your rover first.');
      return;
    }
    await ensureClipPipeline();
    clipChunksRef.current = [];
    clipRecordingRef.current = true;
    setClipState('recording');
  }, [ensureClipPipeline, roverId]);

  useEffect(() => {
    let cancelled = false;

    async function syncLiveMic() {
      if (clipMode) {
        await stopMicCapture(activeRoverRef.current || roverId);
        return;
      }

      if (!roverId) {
        await stopMicCapture(activeRoverRef.current);
        return;
      }
      if (micActiveRef.current && activeRoverRef.current === roverId) return;
      if (!openMicEnabled && !pttActive) return;

      try {
        setMicState('starting');
        setMessage('');
        micActiveRef.current = true;
        activeRoverRef.current = roverId;
        await startWhipMic(roverId);
        if (!cancelled) {
          setMicState('live');
        }
      } catch (err) {
        if (!cancelled) {
          setMicState('error');
          setMessage(err?.message || 'Failed to start mic forwarding.');
        }
        await stopMicCapture(roverId);
      }
    }

    syncLiveMic();
    return () => {
      cancelled = true;
    };
  }, [clipMode, openMicEnabled, pttActive, roverId, startWhipMic, stopMicCapture]);

  useEffect(() => {
    const track = audioTrackRef.current;
    if (!track) return;
    track.enabled = Boolean(!clipMode && (openMicEnabled || pttActive));
  }, [clipMode, openMicEnabled, pttActive]);

  useEffect(() => {
    let cancelled = false;

    async function prewarmClip() {
      if (!clipMode || !roverId) {
        if (clipRecordingRef.current) {
          await finishClipRecording({ send: false });
        }
        setClipState('idle');
        return;
      }
      try {
        await ensureClipPipeline();
        if (!cancelled && !clipRecordingRef.current) {
          setClipState('idle');
        }
      } catch (err) {
        if (!cancelled) {
          setClipState('error');
          setMessage(err?.message || 'Microphone access failed for clip mode.');
        }
      }
    }

    prewarmClip();
    return () => {
      cancelled = true;
    };
  }, [clipMode, ensureClipPipeline, finishClipRecording, roverId]);

  useEffect(() => {
    let cancelled = false;

    async function syncClipPtt() {
      if (!clipMode) return;
      if (!roverId) {
        if (clipRecordingRef.current) {
          await finishClipRecording({ send: false });
        }
        return;
      }

      if (pttActive) {
        if (!clipRecordingRef.current) {
          try {
            setMessage('');
            await startClipRecording();
          } catch (err) {
            if (!cancelled) {
              setClipState('error');
              setMessage(err?.message || 'Failed to start clip recording.');
            }
          }
        }
      } else if (clipRecordingRef.current) {
        await finishClipRecording({ send: true });
      }
    }

    syncClipPtt();
    return () => {
      cancelled = true;
    };
  }, [clipMode, finishClipRecording, pttActive, roverId, startClipRecording]);

  useEffect(
    () => () => {
      stopMicCapture(activeRoverRef.current || roverId);
      teardownClipPipeline();
    },
    [roverId, stopMicCapture, teardownClipPipeline],
  );

  return (
    <section className="surface">
      <div className="grid gap-1">
        <p className="text-sm text-slate-100 text-center">Audio Controls</p>
        <section className="surface">
          <div className="flex items-center justify-center gap-0.5 py-0.25 text-xs text-slate-300">
            <span>Push-to-Talk Key</span>
            <KeyPill label={pttKeyLabel} />
          </div>
        </section>

        <div className="grid gap-0.5 grid-cols-1 lg:grid-cols-2">
          <section className="surface h-full">
            <div className="grid h-full gap-0.5 grid-rows-[auto_auto_1fr]">
              <p className="text-sm text-slate-200 text-center">PTT Mode</p>
              <p className="text-xs text-slate-400 text-center">
                Choose how holding your PTT key behaves: live mic stream, or record-and-send clip. If the live stream doesn't work, switch to clip mode.
              </p>
              <div className="grid grid-cols-2 gap-0.5">
                <button
                  type="button"
                  className={`button-dark w-full text-sm ${!clipMode ? 'bg-emerald-500 text-white hover:bg-emerald-500' : ''}`}
                  onClick={() => setPttMode('live')}
                >
                  Live Mic (WHIP)
                </button>
                <button
                  type="button"
                  className={`button-dark w-full text-sm ${clipMode ? 'bg-emerald-500 text-white hover:bg-emerald-500' : ''}`}
                  onClick={() => setPttMode('clip')}
                >
                  Record Clip
                </button>
              </div>
            </div>
          </section>

          <section className="surface h-full">
            <div className="grid h-full gap-0.5 grid-rows-[auto_1fr]">
              <p className="text-sm text-slate-200 text-center">PTT Clip Status</p>
              <div className="grid gap-0.5 content-start">
                <StatusIndicator label="Mode" active={clipMode} detail={clipMode ? 'record clip' : 'live mic'} />
                <StatusIndicator label="PTT hold" active={pttActive} detail={pttActive ? 'held' : 'released'} />
                <StatusIndicator label="Recording" active={clipRecording} detail={clipRecording ? 'capturing' : 'idle'} />
                <StatusIndicator label="Playback" active={clipMode && uploadPlaying} detail={clipMode && uploadPlaying ? 'playing' : 'idle'} />
              </div>
            </div>
          </section>
        </div>

        <div className="grid gap-0.5 grid-cols-1 lg:grid-cols-2">
          <section className="surface h-full">
            <div className="grid h-full gap-0.5 grid-rows-[auto_auto_1fr_auto]">
              <p className="text-sm text-slate-200 text-center">Audio Upload</p>

              <label className="mx-auto grid w-full max-w-sm gap-0.5 text-xs text-slate-300 text-center">
                <span>Audio file (mp3 / wav / ogg)</span>
                <input
                  className={`${fieldClass} text-center`}
                  type="file"
                  accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"
                  disabled={working || !roverId}
                  onChange={(event) => setSelectedUpload(event.target.files?.[0] || null)}
                />
              </label>

              <div className="mx-auto w-full max-w-sm text-center">
                {selectedUpload ? (
                  <div className="surface-muted text-xs text-slate-300">
                    {selectedUpload.name} ({selectedUpload.size} bytes)
                  </div>
                ) : (
                  <div className="surface-muted text-xs text-slate-500">No file selected</div>
                )}
              </div>

              <div className="flex justify-center gap-0.5">
                <button type="button" className="button-dark text-sm" disabled={working || !roverId} onClick={handleUploadPlay}>
                  {working ? 'Working...' : 'Play Upload'}
                </button>
                <button type="button" className="button-dark text-sm" disabled={working || !roverId} onClick={handleUploadStop}>
                  Stop
                </button>
              </div>
            </div>
          </section>

          <section className="surface h-full">
            <div className="grid h-full gap-0.5 grid-rows-[auto_auto_1fr]">
              <p className="text-sm text-slate-200 text-center">Live Microphone</p>
              <label className="surface-muted mx-auto flex w-full max-w-sm items-center justify-center gap-0.5 px-0.5 py-0.5 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={openMicEnabled}
                  disabled={!roverId || clipMode}
                  onChange={(event) =>
                    saveVipAudio((current) => ({ ...(current || {}), openMicEnabled: Boolean(event.target.checked) }))
                  }
                />
                <span>{clipMode ? 'Open mic (live mode only)' : 'Open mic'}</span>
              </label>
              <div className="grid gap-0.5 content-start">
                <StatusIndicator label="WHIP link" active={whipLinkActive} detail={micState} />
                <StatusIndicator label="Mic hot" active={micHot} detail={micHot ? 'transmitting' : 'muted'} />
                <div className="surface-muted text-center text-xs text-slate-400">Hold <KeyPill label={pttKeyLabel} /> to talk</div>
              </div>
            </div>
          </section>
        </div>

        <section className="surface">
          <div className="space-y-0.5">
            <p className="text-sm text-slate-200 text-center">Audio Status</p>
            <div className="grid gap-0.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-6">
              <StatusIndicator label="Forward pipe" active={pipelineConnected} detail={pipelineConnected ? 'connected' : 'offline'} />
              <StatusIndicator label="Upload playback" active={uploadPlaying} detail={uploadPlaying ? 'playing' : 'idle'} />
              <StatusIndicator label="Mic relay" active={micRelayActive} detail={micRelayActive ? 'active' : 'idle'} />
              <StatusIndicator label="WHIP transport" active={whipLinkActive} detail={micState} />
              <StatusIndicator label="Clip recording" active={clipRecording} detail={clipRecording ? 'recording' : 'idle'} />
              <StatusIndicator label="Clip sending" active={clipSending} detail={clipSending ? 'sending' : 'idle'} />
            </div>
            {message ? <div className="text-xs text-slate-400 text-center">{message}</div> : null}
          </div>
        </section>
      </div>
    </section>
  );
}
