#!/usr/bin/env python3
"""Finite, CPU-only rover policy compute benchmark. No rover/server connections.

Run from the repo root on Linux:
  python3 -m venv ~/.venvs/rover-bench
  ~/.venvs/rover-bench/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
  ~/.venvs/rover-bench/bin/python perf/rover-model-benchmark.py

Quick run:
  .../python perf/rover-model-benchmark.py --threads 4 --rovers 1 --seconds 2

Random inputs/weights measure compute cost ONLY, not learned driving ability.
This is a representative architecture, not a selected production policy.
Video decoding, network delay, dataset I/O, and simultaneous training/inference
are excluded. No packages are installed automatically and no files are written.
"""

import argparse
import json
import math
import os
import platform
import resource
import statistics
import subprocess
import sys
import time


def positive_int(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def positive_seconds(value):
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError("must be finite and positive")
    return number


def arguments():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--threads", type=positive_int, nargs="+", default=[4, 8, 16])
    parser.add_argument("--rovers", type=positive_int, nargs="+", default=[1, 2, 4])
    parser.add_argument("--seconds", type=positive_seconds, default=10,
                        help="minimum measured seconds per case (default: 10)")
    parser.add_argument("--frames", type=positive_int, default=4)
    parser.add_argument("--height", type=positive_int, default=120)
    parser.add_argument("--width", type=positive_int, default=160)
    parser.add_argument("--batch-size", type=positive_int, default=16,
                        help="training batch size")
    parser.add_argument("--hz", type=positive_int, default=10,
                        help="target decision frequency per rover")
    parser.add_argument("--worker", choices=["inference", "training"],
                        help=argparse.SUPPRESS)
    return parser.parse_args()


def worker(args):
    import torch
    from torch import nn

    torch.set_num_threads(args.threads[0])
    torch.set_num_interop_threads(1)
    torch.manual_seed(42)

    class Policy(nn.Module):
        def __init__(self):
            super().__init__()
            # Preserve coarse spatial layout: global pooling alone would discard
            # information about which side of the image contains an obstacle.
            self.vision = nn.Sequential(
                nn.Conv2d(3, 24, 5, stride=2, padding=2), nn.ReLU(),
                nn.Conv2d(24, 48, 3, stride=2, padding=1), nn.ReLU(),
                nn.Conv2d(48, 96, 3, stride=2, padding=1), nn.ReLU(),
                nn.Conv2d(96, 128, 3, stride=2, padding=1), nn.ReLU(),
                nn.AdaptiveAvgPool2d((3, 4)), nn.Flatten(),
                nn.Linear(128 * 3 * 4, 128), nn.ReLU(),
            )
            # 32 sensor values + 32 previous-control/state values per frame.
            self.history = nn.GRU(128 + 64, 128, batch_first=True)
            self.continuous = nn.Linear(128, 8)
            self.buttons = nn.Linear(128, 16)

        def forward(self, images, state):
            batch, frames, channels, height, width = images.shape
            features = self.vision(images.reshape(-1, channels, height, width))
            features = features.reshape(batch, frames, -1)
            history, _ = self.history(torch.cat((features, state), dim=-1))
            last = history[:, -1]
            return self.continuous(last).tanh(), self.buttons(last)

    model = Policy().cpu().float()
    training = args.worker == "training"
    model.train(training)
    batch = args.batch_size if training else args.rovers[0]
    # Keep several independent windows in RAM. Allocation/random generation is
    # outside timing; full frame-history encoding IS included on every decision.
    windows = [(
        torch.rand(batch, args.frames, 3, args.height, args.width),
        torch.rand(batch, args.frames, 64),
    ) for _ in range(4)]
    targets = (torch.rand(batch, 8) * 2 - 1, torch.randint(0, 2, (batch, 16)).float())
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4) if training else None

    def step(index):
        if training:
            optimizer.zero_grad(set_to_none=True)
        continuous, buttons = model(*windows[index % len(windows)])
        if training:
            loss = (nn.functional.mse_loss(continuous, targets[0])
                    + nn.functional.binary_cross_entropy_with_logits(buttons, targets[1]))
            loss.backward()
            optimizer.step()

    context = torch.enable_grad if training else torch.inference_mode
    with context():
        for index in range(5):
            step(index)
        timings = []
        cpu_start = time.process_time()
        start = time.perf_counter()
        # CPU execution is synchronous, so these durations include completion.
        while time.perf_counter() - start < args.seconds or len(timings) < 10:
            before = time.perf_counter()
            step(len(timings))
            timings.append(time.perf_counter() - before)
        elapsed = time.perf_counter() - start
        cpu_elapsed = time.process_time() - cpu_start

    ordered = sorted(timings)
    print(json.dumps({
        "mode": args.worker, "threads": args.threads[0], "batch": batch,
        "parameters": sum(p.numel() for p in model.parameters()),
        "torch": torch.__version__, "iterations": len(timings),
        "p50_ms": statistics.median(timings) * 1000,
        "p95_ms": ordered[math.ceil(len(ordered) * .95) - 1] * 1000,
        "max_ms": max(timings) * 1000,
        "steps_s": len(timings) / elapsed,
        "examples_s": len(timings) * batch / elapsed,
        "cpu_cores": cpu_elapsed / elapsed,
        "peak_mib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
    }))


def main():
    args = arguments()
    if args.worker:
        worker(args)
        return
    try:
        import torch
    except ImportError:
        sys.exit("PyTorch is required. Run the three setup/run commands shown by --help.")

    print(f"CPU-only FP32 | {platform.platform()} | Python {platform.python_version()}"
          f" | PyTorch {torch.__version__}", flush=True)
    print(f"Logical CPUs: {os.cpu_count()} | initial load averages: {os.getloadavg()}")
    print(f"Input: {args.frames} RGB frames at {args.width}x{args.height},"
          " 32 sensors + 32 controls/state per frame")
    print("Output: 8 continuous controls + 16 button logits (placeholder dimensions)")
    print("Synthetic in-memory data; full history re-encoded each decision.")
    print("Excludes video decode/network/dataset I/O and concurrent training/inference.")
    print("Each case has 5 warmups, then at least 10 iterations and the requested duration.")
    print("CPU cores = process CPU seconds / wall seconds; peak MiB includes runtime/data.")
    print("Multi-rover inference batches one independent history per rover per step.\n")
    print("mode       threads batch  p50 ms  p95 ms  max ms  steps/s examples/s CPU cores peak MiB", flush=True)
    results = []
    for mode in ("inference", "training"):
        batches = args.rovers if mode == "inference" else [args.batch_size]
        for threads in args.threads:
            for batch in batches:
                # Fresh processes isolate thread pools and peak memory per case.
                command = [sys.executable, os.path.abspath(__file__), "--worker", mode,
                           "--threads", str(threads), "--rovers", str(batch),
                           "--batch-size", str(args.batch_size), "--seconds", str(args.seconds),
                           "--frames", str(args.frames), "--height", str(args.height),
                           "--width", str(args.width)]
                process = subprocess.run(command, capture_output=True, text=True)
                if process.returncode:
                    print(process.stderr, file=sys.stderr)
                    sys.exit(f"Failed: {mode}, threads={threads}, batch={batch}"
                             " (if killed for memory use, reduce --batch-size or --rovers).")
                result = json.loads(process.stdout)
                results.append(result)
                print(f"{mode:10} {threads:7} {batch:5}"
                      f" {result['p50_ms']:7.1f} {result['p95_ms']:7.1f}"
                      f" {result['max_ms']:7.1f} {result['steps_s']:8.2f}"
                      f" {result['examples_s']:10.2f} {result['cpu_cores']:9.2f}"
                      f" {result['peak_mib']:8.0f}", flush=True)

    print(f"\nModel parameters: {results[0]['parameters']:,}")
    print(f"At {args.hz} Hz, each rover batch must finish every {1000 / args.hz:.1f} ms;")
    print("p95 needs headroom for the excluded pipeline. This is not a deployment pass/fail.")
    fastest = max((r for r in results if r['mode'] == 'training'), key=lambda r: r['examples_s'])
    examples = 3600 * args.hz
    minutes = examples / fastest['examples_s'] / 60
    print(f"Best measured training: {fastest['examples_s']:.1f} windows/s at"
          f" {fastest['threads']} threads.")
    print(f"One pass over one rover-hour sampled at {args.hz} Hz ({examples:,} windows):"
          f" about {minutes:.1f} compute-only minutes.")
    print("Multiply by dataset hours and training passes; this does not predict convergence.")
    print("Paste this complete output, along with the command/options used.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\nBenchmark interrupted.")
