// Control Command Pipeline
// Purpose: Converts normalized inputs into command packets sent to the server. Scope: Applies throttling/coalescing/safety filters before socket command emission.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useSessionSelector } from '../context/SessionContext.jsx';
import {
  AUX_LIMITS,
  COMMAND_DELAY_MS,
  OI_COMMANDS,
  SONG_DEFAULT_DURATION,
  SONG_DEFAULT_NOTE,
  SONG_NOTE_RANGE,
} from './constants.js';
import { bytesToBase64, clampRange, sleep } from './controlMath.js';

export function useCommandPipeline(options = {}) {
  const { driveTransform, auxTransform } = options;
  const socket = useSocket();
  const roverId = useSessionSelector((state) => state.session?.assignment?.roverId ?? null);
  const roster = useSessionSelector((state) => state.session?.roster ?? []);
  const ptzCamera = useSessionSelector((state) => state.session?.ptzCamera ?? null);
  const ptzStopTimerRef = useRef(null);
  const ptzServoBaselineRef = useRef(null);

  const rosterEntry = useMemo(() => {
    if (!roverId || !Array.isArray(roster)) return null;
    return roster.find((entry) => String(entry.id) === String(roverId)) || null;
  }, [roverId, roster]);

  const servoConfig = useMemo(() => {
    if (!rosterEntry?.cameraServo || !rosterEntry.cameraServo.enabled) return null;
    return rosterEntry.cameraServo;
  }, [rosterEntry]);

  const headlight = useMemo(() => {
    if (!rosterEntry?.headlight || !rosterEntry.headlight.enabled) return null;
    return rosterEntry.headlight;
  }, [rosterEntry]);

  const laser = useMemo(() => {
    if (!rosterEntry?.laser || !rosterEntry.laser.enabled) return null;
    return rosterEntry.laser;
  }, [rosterEntry]);

  const horn = useMemo(() => {
    if (!rosterEntry?.horn || !rosterEntry.horn.enabled) return null;
    return rosterEntry.horn;
  }, [rosterEntry]);

  const headlightState = useMemo(() => rosterEntry?.headlight?.state ?? null, [rosterEntry]);
  const laserState = useMemo(() => rosterEntry?.laser?.state ?? null, [rosterEntry]);
  const isPtzOperator = Boolean(ptzCamera?.isOperator);

  const emitPtzCommand = useCallback(
    (eventName, payload = {}, cb) => {
      socket.emit(eventName, payload, cb);
    },
    [socket],
  );

  const emitCommand = useCallback(
    (payload, cb) => {
      if (!roverId) return;
      socket.emit('command', { roverId, ...payload }, cb);
    },
    [socket, roverId],
  );

  useEffect(() => {
    return () => {
      /*
        PTZ zoom is implemented as short velocity pulses. Clear any pending stop
        timer when the pipeline unmounts so old callbacks cannot fire after a
        page navigation or React remount.
      */
      if (ptzStopTimerRef.current) {
        clearTimeout(ptzStopTimerRef.current);
        ptzStopTimerRef.current = null;
      }
    };
  }, []);

  const enableSensorStream = useCallback(() => {
    if (!roverId) return;
    emitCommand({
      type: 'sensorStream',
      data: { sensorStream: { enable: true } },
    });
  }, [emitCommand, roverId]);

  const sendDriveDirect = useCallback(
    (speeds) => {
      const rawPayload = {
        left: clampRange(speeds?.left ?? 0, [-500, 500]),
        right: clampRange(speeds?.right ?? 0, [-500, 500]),
      };
      const transformed = driveTransform ? driveTransform(rawPayload) : rawPayload;
      const payload = {
        left: clampRange(transformed?.left ?? 0, [-500, 500]),
        right: clampRange(transformed?.right ?? 0, [-500, 500]),
      };
      if (isPtzOperator) {
        /*
          Convert the final wheel-speed command into PTZ velocity after every
          normal rover speed modifier has already run. Differential drive math
          gives us a signed turn amount from left-minus-right and a signed
          forward amount from their average, which maps cleanly to pan/tilt.
        */
        const pan = clampRange((payload.left - payload.right) / 1000, [-1, 1]);
        const tilt = clampRange((payload.left + payload.right) / 1000, [-1, 1]);
        if (Math.abs(pan) < 0.01 && Math.abs(tilt) < 0.01) {
          emitPtzCommand('ptzCamera:stop');
        } else {
          emitPtzCommand('ptzCamera:move', { pan, tilt });
        }
        return payload;
      }
      if (!roverId) return null;
      emitCommand({
        type: 'drive',
        data: { driveDirect: payload },
      });
      return payload;
    },
    [driveTransform, emitCommand, emitPtzCommand, isPtzOperator, roverId],
  );

  const sendAuxMotors = useCallback(
    ({ main = 0, side = 0, vacuum = 0 } = {}) => {
      if (!roverId) return null;
      const rawPayload = {
        main: clampRange(main, AUX_LIMITS.main),
        side: clampRange(side, AUX_LIMITS.side),
        vacuum: clampRange(vacuum, AUX_LIMITS.vacuum),
      };
      const transformed = auxTransform ? auxTransform(rawPayload) : rawPayload;
      const payload = {
        main: clampRange(transformed?.main ?? 0, AUX_LIMITS.main),
        side: clampRange(transformed?.side ?? 0, AUX_LIMITS.side),
        vacuum: clampRange(transformed?.vacuum ?? 0, AUX_LIMITS.vacuum),
      };
      emitCommand({
        type: 'motors',
        data: { motorPwm: payload },
      });
      return payload;
    },
    [auxTransform, emitCommand, roverId],
  );

  const sendServoAngle = useCallback(
    (angle) => {
      if (isPtzOperator) {
        /*
          Existing rover camera inputs express intent as an angle target. The
          PTZ camera expects zoom velocity, so compare against the previous
          target and emit a short zoom pulse in that direction. The delayed stop
          keeps keyboard and gamepad nudge behavior responsive without leaving
          the ONVIF zoom motor running after input stops.
        */
        const numericAngle = Number(angle);
        if (!Number.isFinite(numericAngle)) return null;
        const previous = typeof ptzServoBaselineRef.current === 'number' ? ptzServoBaselineRef.current : numericAngle;
        const delta = numericAngle - previous;
        ptzServoBaselineRef.current = numericAngle;
        if (Math.abs(delta) >= 0.01) {
          emitPtzCommand('ptzCamera:move', { zoom: delta > 0 ? 0.45 : -0.45 });
          if (ptzStopTimerRef.current) {
            clearTimeout(ptzStopTimerRef.current);
          }
          ptzStopTimerRef.current = setTimeout(() => {
            ptzStopTimerRef.current = null;
            emitPtzCommand('ptzCamera:stop');
          }, 220);
        }
        return angle;
      }
      if (!roverId || !servoConfig) return null;
      emitCommand({
        type: 'servo',
        data: { servo: { angle } },
      });
      return angle;
    },
    [emitCommand, emitPtzCommand, isPtzOperator, roverId, servoConfig],
  );

  const sendOiCommand = useCallback(
    (keyOrBytes) => {
      if (!roverId) return false;
      const bytes = Array.isArray(keyOrBytes)
        ? keyOrBytes
        : typeof keyOrBytes === 'string'
        ? OI_COMMANDS[keyOrBytes]
        : null;
      if (!bytes) return false;
      emitCommand({
        type: 'raw',
        data: { raw: bytesToBase64(bytes) },
      });
      enableSensorStream();
      return true;
    },
    [emitCommand, enableSensorStream, roverId],
  );

  const runMacroSteps = useCallback(
    async (macro) => {
      if (!macro || !Array.isArray(macro.steps) || !roverId) return;
      for (const step of macro.steps) {
        if (!roverId) break;
        switch (step.type) {
          case 'oi':
            sendOiCommand(step.command);
            break;
          case 'drive':
            sendDriveDirect(step.speeds ?? { left: 0, right: 0 });
            break;
          case 'motors':
            sendAuxMotors(step.values ?? {});
            break;
          case 'servo':
            sendServoAngle(step.angle);
            break;
          case 'pause':
            await sleep(step.duration ?? COMMAND_DELAY_MS); // eslint-disable-line no-await-in-loop
            break;
          default:
            break;
        }
        if (step.delay || step.delayMs) {
          const delay = step.delayMs ?? step.delay;
          if (typeof delay === 'number' && delay > 0) {
            await sleep(delay); // eslint-disable-line no-await-in-loop
          }
        }
      }
    },
    [roverId, sendOiCommand, sendDriveDirect, sendAuxMotors, sendServoAngle],
  );

  const sendHeadlight = useCallback(
    (action = 'toggle') => {
      if (isPtzOperator) {
        /*
          The rover headlight button is the natural physical control for the
          camera spotlight. Resolve toggle client-side from the latest session
          state, then let the server serialize and verify the Reolink API call.
        */
        const currentOn = Boolean(ptzCamera?.light?.state);
        const nextState = action === 'on' ? 1 : action === 'off' ? 0 : currentOn ? 0 : 1;
        emitPtzCommand('ptzCamera:spotlight', { state: nextState });
        return action;
      }
      if (!roverId || !headlight) return null;
      emitCommand({
        type: 'headlight',
        data: { headlight: { action } },
      });
      return action;
    },
    [emitCommand, emitPtzCommand, headlight, isPtzOperator, ptzCamera?.light?.state, roverId],
  );

  const sendLaser = useCallback(
    (action = 'toggle') => {
      if (isPtzOperator) {
        /*
          There is no laser on the PTZ camera, so reuse that secondary light
          control for IR mode. Toggle switches between Auto and Off, matching
          the simplified UI control used by the PTZ panel.
        */
        const currentOff = String(ptzCamera?.ir?.state || '').toLowerCase() === 'off';
        const nextState = action === 'on' ? 'Auto' : action === 'off' ? 'Off' : currentOff ? 'Auto' : 'Off';
        emitPtzCommand('ptzCamera:ir', { state: nextState });
        return action;
      }
      if (!roverId || !laser) return null;
      emitCommand({
        type: 'laser',
        data: { laser: { action } },
      });
      return action;
    },
    [emitCommand, emitPtzCommand, isPtzOperator, laser, ptzCamera?.ir?.state, roverId],
  );

  const sendHorn = useCallback(
    (payload) => {
      if (!roverId) return null;
      emitCommand({
        type: 'horn',
        data: { horn: payload },
      });
      return payload;
    },
    [emitCommand, roverId],
  );

  const sendSong = useCallback(
    (notes = [], options = {}) => {
      if (!roverId) return null;
      const prepared =
        Array.isArray(notes) && notes.length > 0
          ? notes
          : [{ note: SONG_DEFAULT_NOTE, duration: SONG_DEFAULT_DURATION }];
      const payloadNotes = prepared.slice(0, 16).map((entry) => ({
        note: clampRange(Math.round(entry?.note ?? SONG_DEFAULT_NOTE), SONG_NOTE_RANGE),
        duration: clampRange(Math.round(entry?.duration ?? SONG_DEFAULT_DURATION), [1, 255]),
      }));
      emitCommand({
        type: 'song',
        data: {
          song: {
            notes: payloadNotes,
            slot: options.slot,
            loop: options.loop,
          },
        },
      });
      return payloadNotes;
    },
    [emitCommand, roverId],
  );

  return useMemo(
    () => ({
      roverId,
      isPtzOperator,
      rosterEntry,
      servoConfig,
      headlight,
      headlightState,
      laser,
      laserState,
      horn,
      emitCommand,
      enableSensorStream,
      sendDriveDirect,
      sendAuxMotors,
      sendServoAngle,
      sendOiCommand,
      sendHeadlight,
      sendLaser,
      sendHorn,
      sendSong,
      runMacroSteps,
    }),
    [
      roverId,
      isPtzOperator,
      rosterEntry,
      servoConfig,
      headlight,
      headlightState,
      laser,
      laserState,
      horn,
      emitCommand,
      enableSensorStream,
      sendDriveDirect,
      sendAuxMotors,
      sendServoAngle,
      sendOiCommand,
      sendHeadlight,
      sendLaser,
      sendHorn,
      runMacroSteps,
    ],
  );
}
