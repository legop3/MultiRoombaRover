// Control State Reducer
// Purpose: Implements reducer transitions for control-system runtime state. Scope: Centralizes deterministic state updates for input, mode, and dispatch events.
import { DEFAULT_KEYMAP, DEFAULT_MACROS, SONG_DEFAULT_NOTE } from './constants.js';

function createDriveState() {
  return {
    vector: { x: 0, y: 0, boost: false },
    speeds: { left: 0, right: 0 },
    source: null,
    lastUpdatedAt: 0,
  };
}

function createAuxState() {
  return { main: 0, side: 0, vacuum: 0 };
}

function createCameraState() {
  return {
    enabled: false,
    angle: null,
    config: null,
    /*
      Servo precision is UI/control state, not rover hardware state. Keeping it
      beside the camera angle lets every camera-tilt surface use the same
      precision setting while still sending the normal decimal angle commands.
    */
    precisionMode: false,
  };
}

function createSongState() {
  return {
    note: SONG_DEFAULT_NOTE,
  };
}

function createHornState() {
  return {
    active: false,
    heat: 0,
    overheated: false,
  };
}

function createMicState() {
  return {
    pttActive: false,
  };
}

function createManualDockAssistState() {
  return {
    active: false,
  };
}

export const initialControlState = {
  roverId: null,
  mode: 'drive',
  drive: createDriveState(),
  aux: createAuxState(),
  camera: createCameraState(),
  song: createSongState(),
  horn: createHornState(),
  mic: createMicState(),
  manualDockAssist: createManualDockAssistState(),
  lastControlIntentAt: 0,
  macros: DEFAULT_MACROS,
  keymap: DEFAULT_KEYMAP,
  inputs: {},
};

export function controlReducer(state, action) {
  switch (action.type) {
    case 'control/set-rover':
      return {
        ...state,
        roverId: action.payload ?? null,
        drive: action.payload ? state.drive : createDriveState(),
        aux: action.payload ? state.aux : createAuxState(),
        song: action.payload ? state.song : createSongState(),
        horn: action.payload ? state.horn : createHornState(),
        mic: action.payload ? state.mic : createMicState(),
        manualDockAssist: action.payload ? state.manualDockAssist : createManualDockAssistState(),
        lastControlIntentAt: action.payload ? state.lastControlIntentAt : 0,
      };
    case 'control/set-mode':
      return state.mode === action.payload
        ? state
        : { ...state, mode: action.payload === 'dock' ? 'dock' : 'drive' };
    case 'control/update-drive': {
      const { vector, speeds, source } = action.payload;
      return {
        ...state,
        drive: {
          vector: vector ?? state.drive.vector,
          speeds: speeds ?? state.drive.speeds,
          source: source ?? state.drive.source,
          lastUpdatedAt: Date.now(),
        },
      };
    }
    case 'control/set-aux-motors':
      return {
        ...state,
        aux: {
          ...state.aux,
          ...action.payload,
        },
      };
    case 'control/set-camera-config':
      return {
        ...state,
        camera: {
          ...state.camera,
          enabled: Boolean(action.payload?.config),
          config: action.payload?.config ?? null,
          precisionMode: action.payload?.config ? state.camera.precisionMode : false,
          angle:
            typeof action.payload?.angle === 'number'
              ? action.payload.angle
              : action.payload?.config
              ? action.payload.config.homeAngle ?? state.camera.angle
              : null,
        },
      };
    case 'control/set-camera-angle':
      return {
        ...state,
        camera: { ...state.camera, angle: action.payload },
      };
    case 'control/set-camera-precision-mode':
      if (state.camera.precisionMode === Boolean(action.payload)) {
        return state;
      }
      return {
        ...state,
        camera: {
          ...state.camera,
          /*
            Movement inputs own this flag because precision camera mode is meant
            to follow movement precision mode automatically instead of becoming a
            separate toggle the driver has to remember to reset.
          */
          precisionMode: Boolean(action.payload),
        },
      };
    case 'control/register-input-state': {
      const sourceKey = action.payload?.source || 'unknown';
      return {
        ...state,
        inputs: {
          ...state.inputs,
          [sourceKey]: {
            ...(state.inputs[sourceKey] ?? {}),
            ...action.payload?.state,
            updatedAt: Date.now(),
          },
        },
      };
    }
    case 'control/set-keymap':
      return {
        ...state,
        keymap: { ...state.keymap, ...(action.payload ?? {}) },
      };
    case 'control/set-macros':
      return {
        ...state,
        macros: Array.isArray(action.payload) ? action.payload : state.macros,
      };
    case 'control/reset':
      return {
        ...state,
        drive: createDriveState(),
        aux: createAuxState(),
        song: createSongState(),
        horn: createHornState(),
        mic: createMicState(),
        lastControlIntentAt: 0,
      };
    case 'control/set-horn-active':
      return {
        ...state,
        horn: {
          ...(state.horn || createHornState()),
          active: Boolean(action.payload),
        },
      };
    case 'control/set-horn-heat':
      return {
        ...state,
        horn: {
          ...(state.horn || createHornState()),
          heat: typeof action.payload?.heat === 'number' ? action.payload.heat : 0,
          overheated: Boolean(action.payload?.overheated),
        },
      };
    case 'control/record-intent':
      return {
        ...state,
        lastControlIntentAt: Date.now(),
      };
    case 'control/set-song-note':
      return {
        ...state,
        song: {
          ...(state.song || createSongState()),
          note: action.payload ?? SONG_DEFAULT_NOTE,
        },
      };
    case 'control/set-mic-ptt':
      return {
        ...state,
        mic: {
          ...(state.mic || createMicState()),
          pttActive: Boolean(action.payload),
        },
      };
    case 'control/set-manual-dock-assist':
      return {
        ...state,
        manualDockAssist: {
          ...(state.manualDockAssist || createManualDockAssistState()),
          active: Boolean(action.payload),
        },
      };
    default:
      return state;
  }
}
