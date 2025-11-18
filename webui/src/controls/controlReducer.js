import { DEFAULT_KEYMAP, DEFAULT_MACROS } from './constants.js';

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
  };
}

export const initialControlState = {
  roverId: null,
  mode: 'drive',
  drive: createDriveState(),
  aux: createAuxState(),
  camera: createCameraState(),
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
      };
    default:
      return state;
  }
}
