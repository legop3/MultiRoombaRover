#!/usr/bin/env python3
"""
Chrome Google TTS WAV renderer.

Purpose: Converts the same local ChromeOS Google TTS assets used by rovers into
server-side WAV files that can be handed to another playback transport.
Scope: This script only renders one utterance to a file; device playback and
camera delivery stay owned by Node services.
"""
import argparse
import ctypes
import os
import struct
import sys
import wave


ASSET_ROOT = "/opt/roverd/googletts"
LIB_PATH = os.path.join(ASSET_ROOT, "libchrometts.so")
VOICE_DIR = os.path.join(ASSET_ROOT, "en-us-x-multi-r30")
PIPELINE = "pipeline.pb"
SAMPLE_RATE = 24000
MAX_TEXT_CHARS = 512

VOICES = {
    "sfg": "female",
    "iob": "female",
    "iog": "female",
    "iol": "male",
    "iom": "male",
    "tpc": "female",
    "tpd": "male",
    "tpf": "female",
}
DEFAULT_VOICE = "tpf"
DEFAULT_PITCH = 1.0
DEFAULT_SPEED = 1.0
MIN_PITCH = 0.5
MAX_PITCH = 2.0
MIN_SPEED = 0.5
MAX_SPEED = 2.0


def varint(value):
    out = bytearray()
    while value >= 0x80:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    out.append(value)
    return bytes(out)


def field_bytes(number, payload):
    return varint((number << 3) | 2) + varint(len(payload)) + payload


def field_float(number, value):
    return varint((number << 3) | 5) + struct.pack("<f", float(value))


def build_utterance(text, pitch=1.0, speed=1.0):
    params = field_float(2, pitch) + field_float(3, speed)
    msg_b = field_bytes(1, text.encode("utf-8")) + field_bytes(20, params)
    msg_a = field_bytes(1, msg_b)
    return field_bytes(1, msg_a)


def build_speaker(name, gender):
    return field_bytes(1, name.encode("utf-8")) + field_bytes(2, gender.encode("utf-8"))


def clamp_float(value, minimum, maximum, fallback):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return fallback
    if value <= 0:
        return fallback
    if value < minimum:
        return minimum
    if value > maximum:
        return maximum
    return value


def float_to_s16le(samples):
    pcm = bytearray()
    for sample in samples:
        clipped = max(-1.0, min(1.0, float(sample)))
        pcm.extend(struct.pack("<h", int(clipped * 32767)))
    return bytes(pcm)


class ChromeTTS:
    def __init__(self):
        self.lib = ctypes.CDLL(LIB_PATH)
        self.lib.GoogleTtsInit.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
        self.lib.GoogleTtsInit.restype = ctypes.c_bool
        self.lib.GoogleTtsInitBuffered.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int, ctypes.c_int]
        self.lib.GoogleTtsInitBuffered.restype = ctypes.c_bool
        self.lib.GoogleTtsGetFramesInAudioBuffer.argtypes = []
        self.lib.GoogleTtsGetFramesInAudioBuffer.restype = ctypes.c_size_t
        self.lib.GoogleTtsReadBuffered.argtypes = [
            ctypes.POINTER(ctypes.c_float),
            ctypes.POINTER(ctypes.c_size_t),
        ]
        self.lib.GoogleTtsReadBuffered.restype = ctypes.c_int
        self.lib.GoogleTtsShutdown.argtypes = []
        self.lib.GoogleTtsShutdown.restype = None

        voice_dir = os.path.abspath(VOICE_DIR) + os.sep
        pipeline = os.path.join(voice_dir, PIPELINE)
        if not self.lib.GoogleTtsInit(pipeline.encode("utf-8"), voice_dir.encode("utf-8")):
            raise RuntimeError("GoogleTtsInit failed")
        self.frames = int(self.lib.GoogleTtsGetFramesInAudioBuffer())
        if self.frames <= 0:
            raise RuntimeError("invalid Google TTS audio buffer size")
        self.buffer = (ctypes.c_float * self.frames)()

    def render_wav(self, text, output_path, voice, pitch=DEFAULT_PITCH, speed=DEFAULT_SPEED):
        voice = voice if voice in VOICES else DEFAULT_VOICE
        pitch = clamp_float(pitch, MIN_PITCH, MAX_PITCH, DEFAULT_PITCH)
        speed = clamp_float(speed, MIN_SPEED, MAX_SPEED, DEFAULT_SPEED)
        text = text.strip()
        if not text:
            raise ValueError("text required")
        text = text[:MAX_TEXT_CHARS]

        utterance = build_utterance(text, pitch=pitch, speed=speed)
        speaker = build_speaker(voice, VOICES[voice])
        if not self.lib.GoogleTtsInitBuffered(utterance, speaker, len(utterance), len(speaker)):
            raise RuntimeError("GoogleTtsInitBuffered failed")

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        with wave.open(output_path, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(SAMPLE_RATE)
            frames_written = ctypes.c_size_t(0)
            while self.lib.GoogleTtsReadBuffered(self.buffer, ctypes.byref(frames_written)) > 0:
                count = int(frames_written.value)
                if count > 0:
                    wav.writeframes(float_to_s16le(self.buffer[:count]))

    def shutdown(self):
        self.lib.GoogleTtsShutdown()


def main():
    parser = argparse.ArgumentParser(description="Render Chrome Google TTS to a WAV file.")
    parser.add_argument("--text", required=True)
    parser.add_argument("--voice", default=DEFAULT_VOICE)
    parser.add_argument("--pitch", type=float, default=DEFAULT_PITCH)
    parser.add_argument("--speed", type=float, default=DEFAULT_SPEED)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    tts = ChromeTTS()
    try:
        tts.render_wav(args.text, args.output, args.voice, args.pitch, args.speed)
    finally:
        tts.shutdown()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        sys.stderr.write(f"chromegtts-wav failed: {exc}\n")
        raise SystemExit(1)
