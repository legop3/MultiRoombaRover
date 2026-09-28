"""Versioned, fixed-size vision/control policy and command encoding.

Slots describe command shapes, not arbitrary executable instructions. Numeric
leaves are regressed; string/bool/list values remain exact template constants.
No command is sent by this module. Execution must use server authorization.
"""
import copy
import json
import math

import numpy as np
import torch
from torch import nn

VERSION = 1
SLOTS = 64
VALUES = 8
FRAMES = 4
HEIGHT, WIDTH = 120, 160
OPERATING_TYPES = {"drive", "motors", "servo", "headlight", "laser", "horn", "peripheral", "song", "raw"}
SENSORS = [
    ("bumpsAndWheelDrops.bumpLeft", 1), ("bumpsAndWheelDrops.bumpRight", 1),
    ("bumpsAndWheelDrops.wheelDropLeft", 1), ("bumpsAndWheelDrops.wheelDropRight", 1),
    ("cliffLeft", 1), ("cliffFrontLeft", 1), ("cliffFrontRight", 1), ("cliffRight", 1),
    ("wall", 1), ("virtualWall", 1), ("wallSignal", 4096),
    ("voltageMv", 16000), ("currentMa", 3000), ("batteryChargeMah", 4000),
    ("batteryCapacityMah", 4000), ("batteryTemperatureC", 50),
    ("chargingState.code", 5), ("chargingSources.homeBase", 1), ("oiMode.code", 4),
    ("wheelSpeedsMmPerSecond.left", 500), ("wheelSpeedsMmPerSecond.right", 500),
    ("wheelLeftCurrentMa", 2000), ("wheelRightCurrentMa", 2000),
    ("mainBrushCurrentMa", 2000), ("sideBrushCurrentMa", 2000),
    ("lightBumpLeftSignal", 4096), ("lightBumpRightSignal", 4096),
    ("cliffLeftSignal", 4096), ("cliffRightSignal", 4096),
    ("distanceMm", 500), ("angleDeg", 180), ("stasis", 1),
]
STATE_SIZE = len(SENSORS) * 2 + SLOTS * (VALUES + 2)


def normalize(value, scale):
    return math.atan(float(value) / scale) * 2 / math.pi


def sensor_vector(sensors):
    values, present = [], []
    for name, scale in SENSORS:
        value = sensors
        for key in name.split('.'):
            value = value.get(key) if isinstance(value, dict) else None
        known = isinstance(value, (int, float)) and math.isfinite(value)
        values.append(normalize(value, scale) if known else 0)
        present.append(float(known))
    return np.array(values + present, dtype=np.float32)


def describe_command(command):
    if command.get('type') not in OPERATING_TYPES:
        return None
    if len(json.dumps(command)) > 4096:
        raise ValueError('Operating command exceeds 4096-byte schema limit')
    values, fields = [], []

    def visit(value, path=()):
        if isinstance(value, dict):
            return {key: visit(item, (*path, key)) for key, item in sorted(value.items())}
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if not math.isfinite(value) or len(values) >= VALUES:
                raise ValueError('Nonfinite command or too many numeric control fields')
            scale = {'drive': 500, 'motors': 255, 'servo': 180, 'peripheral': 255,
                     'horn': 1000, 'song': 127}.get(command['type'], 1)
            fields.append({'path': list(path), 'scale': scale, 'integer': isinstance(value, int)})
            values.append(normalize(value, scale))
            return {'$number': len(values) - 1}
        # Arrays (e.g. songs) are discrete exact demonstrations, not variable
        # length regression outputs. Never reinterpret raw OI bytes as numbers.
        return copy.deepcopy(value)

    template = visit(command)
    return {'template': template, 'fields': fields}, values


def encode_command(command, schema, extend=False):
    described = describe_command(command)
    if described is None:
        return None
    descriptor, values = described
    try:
        slot = schema.index(descriptor)
    except ValueError:
        if not extend:
            raise ValueError('Command shape missing from model schema')
        if len(schema) >= SLOTS:
            raise ValueError('64 command shapes exhausted; recording skipped, not silently truncated')
        slot = len(schema)
        schema.append(descriptor)
    vector = np.zeros(VALUES, dtype=np.float32)
    vector[:len(values)] = values
    return slot, vector


class Policy(nn.Module):
    def __init__(self):
        super().__init__()
        self.vision = nn.Sequential(
            nn.Conv2d(3, 24, 5, 2, 2), nn.ReLU(),
            nn.Conv2d(24, 48, 3, 2, 1), nn.ReLU(),
            nn.Conv2d(48, 96, 3, 2, 1), nn.ReLU(),
            nn.Conv2d(96, 128, 3, 2, 1), nn.ReLU(),
            nn.AdaptiveAvgPool2d((3, 4)), nn.Flatten(),
            nn.Linear(128 * 3 * 4, 128), nn.ReLU(),
        )
        self.history = nn.GRU(128 + STATE_SIZE, 128, batch_first=True)
        self.actions = nn.Linear(128, SLOTS)
        self.values = nn.Linear(128, SLOTS * VALUES)

    def forward(self, images, state):
        batch, frames = images.shape[:2]
        encoded = self.vision(images.reshape(-1, 3, HEIGHT, WIDTH)).reshape(batch, frames, -1)
        history, _ = self.history(torch.cat((encoded, state), dim=-1))
        last = history[:, -1]
        return self.actions(last), self.values(last).reshape(batch, SLOTS, VALUES).tanh()


def specification(schema):
    return {'version': VERSION, 'architecture': 'spatial-cnn-gru-v1',
            'frames': FRAMES, 'height': HEIGHT, 'width': WIDTH,
            'historyStrideMs': 300, 'decisionIntervalMs': 100,
            'stateSize': STATE_SIZE, 'sensorFields': SENSORS,
            'normalization': '2/pi * atan(value/scale); missing sensors have mask=0',
            'maxCommandShapes': SLOTS, 'numericFieldsPerShape': VALUES,
            'commands': schema, 'actionSemantics': 'Events in the next 100 ms; zero means no new command',
            'timing': 'Server-receipt alignment; browser display latency unmeasured'}
