#!/usr/bin/env python3
"""Finite CPU benchmark of LeRobot ACT with ImageNet-pretrained ResNet-18.

First run: python3 perf/act-benchmark.py --setup
Repeat:    python3 perf/act-benchmark.py
Quick:     python3 perf/act-benchmark.py --threads 4 --seconds 2 --iterations 2 --batch-size 2

Python >=3.12, Linux. Setup uses a private cached environment. Only the visual
backbone is pretrained; the action policy is randomly initialized. Synthetic
in-memory inputs measure compute, NOT learning quality or driving competence.
No rover connections, server changes, training checkpoints, or background jobs.
"""
import argparse
import contextlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import resource
import statistics
import subprocess
import sys
import tempfile
import time
import venv

REVISION = '146d8474932c8b566717eb2738ba459337ab71c4'


def positive(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError('Must be positive')
    return number


def arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--setup', action='store_true')
    parser.add_argument('--cache', type=Path, default=Path.home() / '.cache/rover-act-benchmark')
    parser.add_argument('--threads', nargs='+', type=positive, default=[4, 8, 16])
    parser.add_argument('--seconds', type=positive, default=10)
    parser.add_argument('--iterations', type=positive, default=10)
    parser.add_argument('--batch-size', type=positive, default=8, help='Training only; inference batch is always one rover')
    parser.add_argument('--chunk-size', type=positive, default=10, help='Future command steps per prediction, not observed history')
    parser.add_argument('--width', type=positive, default=160)
    parser.add_argument('--height', type=positive, default=120)
    parser.add_argument('--sensors', type=positive, default=30)
    parser.add_argument('--mode', choices=['both', 'inference', 'training'], default='both')
    parser.add_argument('--timeout', type=positive, default=900, help='Hard per-case wall time limit in seconds')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--result', type=Path, help=argparse.SUPPRESS)
    return parser.parse_args()


def setup(args):
    python = args.cache / 'venv/bin/python'
    if not python.exists():
        venv.EnvBuilder(with_pip=True).create(args.cache / 'venv')
    subprocess.run([str(python), '-m', 'pip', 'install', '--no-compile', 'torch', 'torchvision',
                    '--index-url', 'https://download.pytorch.org/whl/cpu'], check=True)
    # Install only ACT's import dependencies: the full robotics/dataset stack has
    # unrelated version constraints and is not exercised by this benchmark.
    subprocess.run([str(python), '-m', 'pip', 'install', '--no-compile', 'numpy', 'einops>=0.8,<0.9',
                    'draccus>=0.11.6,<0.12', 'huggingface-hub>=1.6,<2', 'safetensors',
                    'packaging', 'termcolor', 'tqdm', 'gymnasium'], check=True)
    subprocess.run([str(python), '-m', 'pip', 'install', '--no-compile', '--no-deps',
                    f'https://github.com/huggingface/lerobot/archive/{REVISION}.zip'], check=True)
    (args.cache / 'source-revision').write_text(REVISION)


def worker(args):
    import torch
    from lerobot.configs import FeatureType, PolicyFeature
    from lerobot.policies.act.configuration_act import ACTConfig
    from lerobot.policies.act.modeling_act import ACTPolicy

    torch.set_num_threads(args.threads[0])
    torch.set_num_interop_threads(1)
    torch.manual_seed(7)
    training = args.mode == 'training'
    batch_size = args.batch_size if training else 1
    config = ACTConfig(device='cpu', chunk_size=args.chunk_size, n_action_steps=1,
        input_features={
            'observation.images.front': PolicyFeature(type=FeatureType.VISUAL, shape=(3, args.height, args.width)),
            'observation.state': PolicyFeature(type=FeatureType.STATE, shape=(args.sensors,)),
        }, output_features={'action': PolicyFeature(type=FeatureType.ACTION, shape=(2,))})
    policy = ACTPolicy(config).cpu().float()
    policy.train(training)
    optimizer_config = config.get_optimizer_preset()
    optimizer = optimizer_config.build(policy.get_optim_params()) if training else None
    # Already-normalized tensors stand in for a decoded observation and target
    # sequence. Avoid video/dataset overhead in this compute-only measurement.
    images = torch.rand(batch_size, 3, args.height, args.width)
    mean = torch.tensor([.485, .456, .406]).view(1, 3, 1, 1)
    std = torch.tensor([.229, .224, .225]).view(1, 3, 1, 1)
    batch = {'observation.images.front': (images - mean) / std,
             'observation.state': torch.randn(batch_size, args.sensors)}
    if training:
        batch['action'] = torch.rand(batch_size, args.chunk_size, 2) * 2 - 1
        batch['action_is_pad'] = torch.zeros(batch_size, args.chunk_size, dtype=torch.bool)

    def step():
        if training:
            optimizer.zero_grad(set_to_none=True)
            loss, _ = policy(batch)
            if not torch.isfinite(loss):
                raise RuntimeError('Non-finite training loss')
            loss.backward()
            norm = torch.nn.utils.clip_grad_norm_(policy.parameters(), optimizer_config.grad_clip_norm,
                                                   error_if_nonfinite=True)
            optimizer.step()
            return {'loss': loss.item(), 'gradientNorm': norm.item()}
        # select_action can serve cached actions; directly time a full chunk.
        prediction = policy.predict_action_chunk(batch)
        if prediction.shape != (1, args.chunk_size, 2) or not torch.isfinite(prediction).all():
            raise RuntimeError('Invalid action output')
        return {'outputShape': list(prediction.shape)}

    with (contextlib.nullcontext() if training else torch.inference_mode()):
        for _ in range(3):
            step()
        timings = []
        started, cpu_started = time.perf_counter(), time.process_time()
        while len(timings) < args.iterations or time.perf_counter() - started < args.seconds:
            tick = time.perf_counter()
            last = step()
            timings.append((time.perf_counter() - tick) * 1000)
        elapsed, cpu = time.perf_counter() - started, time.process_time() - cpu_started
    timings.sort()
    result = dict(mode=args.mode, threads=args.threads[0], batchSize=batch_size,
        iterations=len(timings), elapsedSeconds=elapsed, p50Ms=statistics.median(timings),
        p95Ms=timings[math.ceil(.95*len(timings))-1], maxMs=max(timings),
        stepsPerSecond=len(timings)/elapsed, examplesPerSecond=len(timings)*batch_size/elapsed,
        cpuCores=cpu/elapsed, peakMiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,
        parameters=sum(p.numel() for p in policy.parameters()),
        trainableParameters=sum(p.numel() for p in policy.parameters() if p.requires_grad),
        lastStep=last, config={
            'chunkSize': config.chunk_size, 'dimModel': config.dim_model, 'klWeight': config.kl_weight,
            'pretrainedBackbone': config.pretrained_backbone_weights, 'useVae': config.use_vae,
            'encoderLayers': config.n_encoder_layers, 'decoderLayers': config.n_decoder_layers,
            'feedforwardDimension': config.dim_feedforward, 'observationSteps': config.n_obs_steps,
            'learningRate': optimizer_config.lr, 'backboneLearningRate': config.optimizer_lr_backbone},
        versions={key: importlib.metadata.version(key) for key in ['torch','torchvision','lerobot','numpy','einops','draccus']})
    args.result.write_text(json.dumps(result))


def main():
    args = arguments()
    if sys.version_info < (3, 12):
        raise RuntimeError('Use Python 3.12 or newer')
    args.cache = args.cache.expanduser().resolve()
    os.environ['TORCH_HOME'] = str(args.cache / 'torch')
    if args.worker:
        worker(args)
        return
    if args.setup:
        setup(args)
    python = args.cache / 'venv/bin/python'
    marker = args.cache / 'source-revision'
    if not python.exists() or not marker.exists() or marker.read_text() != REVISION:
        raise RuntimeError('Run python3 perf/act-benchmark.py --setup first')
    print('CPU FP32 ACT: pretrained visual backbone, untrained action policy; synthetic data.', flush=True)
    print(f'One {args.width}x{args.height} image + {args.sensors} sensors; {args.chunk_size} future left/right command pairs.', flush=True)
    print('Inference times a fresh full prediction. Training includes backbone gradients and optimizer update.', flush=True)
    print('mode       threads batch p50 ms p95 ms max ms steps/s examples/s CPU cores peak MiB', flush=True)
    modes = ['inference', 'training'] if args.mode == 'both' else [args.mode]
    results, failures = [], []
    initial_load = os.getloadavg()
    with tempfile.TemporaryDirectory(prefix='act-benchmark-') as directory:
        for mode in modes:
            for threads in args.threads:
                result_path = Path(directory) / 'result.json'
                command = [str(python), str(Path(__file__).resolve()), '--worker', '--cache', str(args.cache),
                    '--mode', mode, '--threads', str(threads), '--result', str(result_path)]
                for option in ['seconds','iterations','batch_size','chunk_size','width','height','sensors']:
                    command += ['--'+option.replace('_','-'), str(getattr(args, option))]
                try:
                    subprocess.run(command, check=True, timeout=args.timeout,
                                   env={**os.environ, 'PYTHONDONTWRITEBYTECODE':'1'})
                    r = json.loads(result_path.read_text())
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
                    failures.append(dict(mode=mode, threads=threads, error=str(error)))
                    print(f'Case failed: {mode}, {threads} threads: {error}', flush=True)
                    break  # Avoid repeating the same setup/import/OOM error.
                results.append(r)
                print(f"{mode:10} {threads:7} {r['batchSize']:5} {r['p50Ms']:6.1f} {r['p95Ms']:6.1f} {r['maxMs']:6.1f} {r['stepsPerSecond']:7.2f} {r['examplesPerSecond']:10.2f} {r['cpuCores']:9.2f} {r['peakMiB']:8.0f}", flush=True)
            if failures:
                break
    report = dict(benchmark='act-cpu-v1', sourceRevision=REVISION, platform=platform.platform(),
        python=sys.version, logicalCpus=os.cpu_count(), initialLoadAverage=initial_load,
        finalLoadAverage=os.getloadavg(), imageSize=[args.width,args.height], sensors=args.sensors,
        chunkSize=args.chunk_size, output='commanded left/right wheels, not physical velocity or position',
        exclusions=['capture','video decode','dataset I/O','network','concurrent training/inference','driving quality'],
        results=results, failures=failures)
    print('\nPaste this report back:\n'+json.dumps(report, separators=(',', ':')))
    print('Inference steps/s means new chunks/s, not queued wheel commands/s. Training loss on random data is not a quality score.')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print(f'Benchmark failed: {error}', file=sys.stderr)
        sys.exit(1)
