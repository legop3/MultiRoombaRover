import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { DEFAULT_DEVICE_CONTROL_PORT } from './constants.js';

const REQUIRED_FIELDS = ['id'];

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(moduleDir, '..');

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

function resolveConfig() {
  const candidates = [
    path.join(serverRoot, 'robots.json'),
    path.join(serverRoot, 'robots.example.json'),
    path.join(process.cwd(), 'server', 'robots.json'),
    path.join(process.cwd(), 'server', 'robots.example.json'),
  ];

  for (const candidate of candidates) {
    const data = readJson(candidate);
    if (data) {
      if (candidate.endsWith('robots.example.json')) {
        console.warn('[robots] robots.json missing, using example configuration');
      }
      return data;
    }
  }
  return null;
}

export function loadRobots() {
  const payload = resolveConfig();
  if (!payload) {
    throw new Error('robots configuration file not found');
  }
  if (!Array.isArray(payload)) {
    throw new Error('robots configuration must be an array');
  }
  return payload.map((entry) => {
    for (const field of REQUIRED_FIELDS) {
      if (!entry[field]) {
        throw new Error(`robot entry missing field ${field}`);
      }
    }
    return {
      id: entry.id,
      host: entry.deviceHost || entry.host || null,
      controlPort: Number(entry.deviceControlPort || entry.controlPort || DEFAULT_DEVICE_CONTROL_PORT),
      maxWheelSpeed: Number(entry.maxWheelSpeed || 500),
    };
  });
}
