#!/usr/bin/env python3
import base64
import json
import sys
from datetime import datetime, timezone

import cv2
import numpy as np


MAX_EDGE = 640


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def emit(payload):
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def decode_image(image_b64):
    raw = base64.b64decode(image_b64)
    arr = np.frombuffer(raw, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("failed to decode image")
    return frame


def resize_for_inference(frame):
    h, w = frame.shape[:2]
    max_side = max(h, w)
    if max_side <= MAX_EDGE:
        return frame
    scale = float(MAX_EDGE) / float(max_side)
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    return cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_AREA)


def encode_jpeg(frame):
    ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 78])
    if not ok:
        raise ValueError("failed to encode image")
    return base64.b64encode(encoded.tobytes()).decode("ascii")


def annotate_frame(frame, camera_id, confidence):
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    msg = f"person {confidence:.2f} | {camera_id} | {stamp}"
    cv2.rectangle(frame, (8, 8), (min(frame.shape[1] - 8, 540), 42), (0, 0, 0), -1)
    cv2.putText(
        frame,
        msg,
        (14, 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (0, 255, 0),
        2,
        cv2.LINE_AA,
    )
    return frame


hog = cv2.HOGDescriptor()
hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

emit({"type": "ready", "ts": now_iso()})

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = None
    try:
        req = json.loads(line)
        req_id = req.get("reqId")
        cam_id = str(req.get("cameraId", "unknown"))
        conf_threshold = float(req.get("confidenceThreshold", 0.55))
        frame = decode_image(req["imageBase64"])
        working = resize_for_inference(frame)
        rects, weights = hog.detectMultiScale(
            working,
            winStride=(8, 8),
            padding=(8, 8),
            scale=1.05,
        )
        best = 0.0
        detections = []
        if weights is None:
            weights = []
        for i, rect in enumerate(rects):
            weight = float(weights[i]) if i < len(weights) else 0.0
            best = max(best, weight)
            if weight < conf_threshold:
                continue
            x, y, w, h = rect
            detections.append({"x": int(x), "y": int(y), "w": int(w), "h": int(h), "confidence": weight})
            cv2.rectangle(working, (int(x), int(y)), (int(x + w), int(y + h)), (0, 255, 0), 2)
            cv2.putText(
                working,
                f"{weight:.2f}",
                (int(x), max(12, int(y) - 6)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 255, 0),
                1,
                cv2.LINE_AA,
            )
        detected = len(detections) > 0
        if detected:
            working = annotate_frame(working, cam_id, max(d["confidence"] for d in detections))
        emit(
            {
                "ok": True,
                "reqId": req_id,
                "cameraId": cam_id,
                "personDetected": detected,
                "bestConfidence": best,
                "detections": detections,
                "annotatedBase64": encode_jpeg(working),
                "ts": int(datetime.now(tz=timezone.utc).timestamp() * 1000),
            }
        )
    except Exception as err:
        emit(
            {
                "ok": False,
                "reqId": req.get("reqId") if isinstance(req, dict) else None,
                "error": str(err),
                "ts": int(datetime.now(tz=timezone.utc).timestamp() * 1000),
            }
        )
