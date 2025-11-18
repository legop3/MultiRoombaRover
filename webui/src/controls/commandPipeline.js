import { useCallback, useMemo } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { AUX_LIMITS, COMMAND_DELAY_MS, OI_COMMANDS } from './constants.js';
import { bytesToBase64, clampRange, sleep } from './controlMath.js';

export function useCommandPipeline() {
  const socket = useSocket();
  const { session } = useSession();
  const roverId = session?.assignment?.roverId;

  const rosterEntry = useMemo(() => {
    if (!roverId || !Array.isArray(session?.roster)) return null;
    return session.roster.find((entry) => String(entry.id) === String(roverId)) || null;
  }, [roverId, session?.roster]);

  const servoConfig = useMemo(() => {
    if (!rosterEntry?.cameraServo || !rosterEntry.cameraServo.enabled) return null;
    return rosterEntry.cameraServo;
  }, [rosterEntry]);

  const emitCommand = useCallback(
    (payload, cb) => {
      if (!roverId) return;
      socket.emit('command', { roverId, ...payload }, cb);
    },
    [socket, roverId],
  );

  const enableSensorStream = useCallback(() => {
    if (!roverId) return;
    emitCommand({
      type: 'sensorStream',
      data: { sensorStream: { enable: true } },
    });
  }, [emitCommand, roverId]);

  const sendDriveDirect = useCallback(
    (speeds) => {
      if (!roverId) return null;
      const payload = {
        left: clampRange(speeds?.left ?? 0, [-500, 500]),
        right: clampRange(speeds?.right ?? 0, [-500, 500]),
      };
      emitCommand({
        type: 'drive',
        data: { driveDirect: payload },
      });
      return payload;
    },
    [emitCommand, roverId],
  );

  const sendAuxMotors = useCallback(
    ({ main = 0, side = 0, vacuum = 0 } = {}) => {
      if (!roverId) return null;
      const payload = {
        main: clampRange(main, AUX_LIMITS.main),
        side: clampRange(side, AUX_LIMITS.side),
        vacuum: clampRange(vacuum, AUX_LIMITS.vacuum),
      };
      emitCommand({
        type: 'motors',
        data: { motorPwm: payload },
      });
      return payload;
    },
    [emitCommand, roverId],
  );

  const sendServoAngle = useCallback(
    (angle) => {
      if (!roverId || !servoConfig) return null;
      emitCommand({
        type: 'servo',
        data: { servo: { angle } },
      });
      return angle;
    },
    [emitCommand, roverId, servoConfig],
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

  return useMemo(
    () => ({
      roverId,
      rosterEntry,
      servoConfig,
      emitCommand,
      enableSensorStream,
      sendDriveDirect,
      sendAuxMotors,
      sendServoAngle,
      sendOiCommand,
      runMacroSteps,
    }),
    [
      roverId,
      rosterEntry,
      servoConfig,
      emitCommand,
      enableSensorStream,
      sendDriveDirect,
      sendAuxMotors,
      sendServoAngle,
      sendOiCommand,
      runMacroSteps,
    ],
  );
}
