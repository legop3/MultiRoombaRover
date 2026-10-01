#!/usr/bin/env python3
"""CPU benchmark of published NoMaD exploration, without ROS or rover connections.

Run: python3 perf/nomad-benchmark.py --setup
Subsequent runs: python3 perf/nomad-benchmark.py
Quick run: python3 perf/nomad-benchmark.py --threads 4 --samples 1 --seconds 2 --iterations 2

--setup installs CPU dependencies in a private cached venv and downloads pinned
upstream source plus the official checkpoint. Nothing touches server packages.
Synthetic images measure compute, NOT navigation quality. Excludes capture,
video decode, network, physical control, training, and concurrent rover load.
"""
import argparse
import hashlib
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
import time
import urllib.request
import venv

VINT = 'dca79815b704e5aa9c6bdc3082351f9e3b2848c2'
DIFFUSION = '5ba07ac6661db573af695b419a7947ecb704690f'
CHECKPOINT_ID = '1YJhkkMJAYOiKNyCaelbS_alpUpAJsOUb'
SOURCES = {
    ('robodhruv/visualnav-transformer', VINT): [
        'train/config/nomad.yaml', 'train/vint_train/data/data_config.yaml',
        'train/vint_train/models/nomad/nomad.py',
        'train/vint_train/models/nomad/nomad_vint.py',
        'train/vint_train/models/vint/self_attention.py',
    ],
    ('real-stanford/diffusion_policy', DIFFUSION): [
        'diffusion_policy/model/diffusion/conditional_unet1d.py',
        'diffusion_policy/model/diffusion/conv1d_components.py',
        'diffusion_policy/model/diffusion/positional_embedding.py',
    ],
}


def positive(value):
    result = int(value)
    if result < 1:
        raise argparse.ArgumentTypeError('Must be positive')
    return result


def arguments():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--setup', action='store_true')
    p.add_argument('--cache', type=Path, default=Path.home() / '.cache/rover-nomad-benchmark')
    p.add_argument('--threads', type=positive, nargs='+', default=[4, 8, 16])
    p.add_argument('--samples', type=positive, nargs='+', default=[1, 8], help='Candidate trajectories per decision, not rover count')
    p.add_argument('--seconds', type=positive, default=10)
    p.add_argument('--iterations', type=positive, default=10)
    p.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    p.add_argument('--result', type=Path, help=argparse.SUPPRESS)
    return p.parse_args()


def download(url, path):
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.part')
    print('Downloading', path.name, flush=True)
    with urllib.request.urlopen(url, timeout=120) as response, temporary.open('wb') as output:
        import shutil
        shutil.copyfileobj(response, output)
    temporary.replace(path)


def prepare(args):
    python = args.cache / 'venv/bin/python'
    if not python.exists():
        venv.EnvBuilder(with_pip=True).create(args.cache / 'venv')
    subprocess.run([str(python), '-m', 'pip', 'install', 'torch', 'torchvision',
                    '--index-url', 'https://download.pytorch.org/whl/cpu'], check=True)
    subprocess.run([str(python), '-m', 'pip', 'install', 'numpy', 'diffusers',
                    'efficientnet-pytorch', 'einops', 'PyYAML', 'gdown'], check=True)
    for (repo, revision), paths in SOURCES.items():
        for path in paths:
            download(f'https://raw.githubusercontent.com/{repo}/{revision}/{path}', args.cache / 'source' / revision / path)
    checkpoint = args.cache / 'nomad.pth'
    if not checkpoint.exists():
        temporary = checkpoint.with_suffix('.part')
        subprocess.run([str(python), '-m', 'gdown', CHECKPOINT_ID, '-O', str(temporary)], check=True)
        temporary.replace(checkpoint)


def worker(args):
    import numpy as np
    import torch
    import yaml
    from diffusers.schedulers.scheduling_ddpm import DDPMScheduler
    sys.path[:0] = [str(args.cache / 'source' / VINT / 'train'), str(args.cache / 'source' / DIFFUSION)]
    from vint_train.models.nomad.nomad import NoMaD, DenseNetwork
    from vint_train.models.nomad.nomad_vint import NoMaD_ViNT, replace_bn_with_gn
    from diffusion_policy.model.diffusion.conditional_unet1d import ConditionalUnet1D

    threads, samples = args.threads[0], args.samples[0]
    torch.set_num_threads(threads)
    torch.set_num_interop_threads(1)
    torch.manual_seed(0)
    c = yaml.safe_load((args.cache / 'source' / VINT / 'train/config/nomad.yaml').read_text())
    vision = replace_bn_with_gn(NoMaD_ViNT(
        context_size=c['context_size'], obs_encoding_size=c['encoding_size'],
        mha_num_attention_heads=c['mha_num_attention_heads'],
        mha_num_attention_layers=c['mha_num_attention_layers'], mha_ff_dim_factor=c['mha_ff_dim_factor']))
    model = NoMaD(vision, ConditionalUnet1D(input_dim=2, global_cond_dim=c['encoding_size'],
        down_dims=c['down_dims'], cond_predict_scale=c['cond_predict_scale']), DenseNetwork(c['encoding_size'])).eval()
    # Strict loading prevents accidentally benchmarking a partly random model.
    model.load_state_dict(torch.load(args.cache / 'nomad.pth', map_location='cpu', weights_only=True), strict=True)
    scheduler = DDPMScheduler(num_train_timesteps=c['num_diffusion_iters'],
        beta_schedule='squaredcos_cap_v2', clip_sample=True, prediction_type='epsilon')
    width, height = c['image_size']
    frames = torch.rand(c['context_size'] + 1, 3, height, width)
    mean = torch.tensor([.485, .456, .406]).view(1, 3, 1, 1)
    std = torch.tensor([.229, .224, .225]).view(1, 3, 1, 1)
    mask = torch.ones(1, dtype=torch.long)
    stats = yaml.safe_load((args.cache / 'source' / VINT / 'train/vint_train/data/data_config.yaml').read_text())['action_stats']
    low, high = np.array(stats['min']), np.array(stats['max'])

    def decision():
        start = time.perf_counter()
        obs = ((frames - mean) / std).reshape(1, -1, height, width)
        goal = torch.randn(1, 3, height, width)
        cond = model('vision_encoder', obs_img=obs, goal_img=goal, input_goal_mask=mask).repeat(samples, 1)
        encoded = time.perf_counter()
        action = torch.randn(samples, c['len_traj_pred'], 2)
        scheduler.set_timesteps(c['num_diffusion_iters'])
        for step in scheduler.timesteps:
            noise = model('noise_pred_net', sample=action, timestep=step, global_cond=cond)
            action = scheduler.step(noise, step, action).prev_sample
        # Match upstream get_action: unnormalize deltas then accumulate waypoints.
        waypoints = np.cumsum((action.numpy() + 1) / 2 * (high - low) + low, axis=1)
        if not np.isfinite(waypoints).all():
            raise RuntimeError('Non-finite model output')
        end = time.perf_counter()
        return (end - start) * 1000, (encoded - start) * 1000, (end - encoded) * 1000

    rows = []
    with torch.inference_mode():
        for _ in range(3):
            decision()
        start, cpu = time.perf_counter(), time.process_time()
        while len(rows) < args.iterations or time.perf_counter() - start < args.seconds:
            rows.append(decision())
        elapsed, cpu = time.perf_counter() - start, time.process_time() - cpu
    total = sorted(r[0] for r in rows)
    result = dict(threads=threads, candidateTrajectories=samples, iterations=len(rows),
        p50Ms=statistics.median(total), p95Ms=total[math.ceil(.95 * len(total)) - 1], maxMs=max(total),
        decisionsPerSecond=len(rows)/elapsed, cpuCores=cpu/elapsed,
        peakMiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,
        visionMeanMs=statistics.mean(r[1] for r in rows), diffusionAndDecodeMeanMs=statistics.mean(r[2] for r in rows),
        parameters=sum(p.numel() for p in model.parameters()), diffusionSteps=c['num_diffusion_iters'],
        imageSize=c['image_size'], frames=c['context_size']+1,
        versions={name: importlib.metadata.version(name) for name in ['torch','torchvision','diffusers','numpy','efficientnet-pytorch','einops']})
    args.result.write_text(json.dumps(result))


def main():
    args = arguments()
    args.cache = args.cache.expanduser().resolve()
    if args.worker:
        worker(args)
        return
    if args.setup:
        prepare(args)
    python = args.cache / 'venv/bin/python'
    if not python.exists() or not (args.cache / 'nomad.pth').exists():
        raise RuntimeError('First run: python3 perf/nomad-benchmark.py --setup')
    print('CPU FP32 NoMaD exploration; synthetic images; no driving-quality measurement.', flush=True)
    print('Candidates are trajectories for ONE rover. Includes vision + all 10 diffusion steps.', flush=True)
    print('threads candidates  p50 ms  p95 ms  max ms decisions/s CPU cores peak MiB', flush=True)
    results = []
    import tempfile
    with tempfile.TemporaryDirectory(prefix='nomad-bench-') as directory:
        for threads in args.threads:
            for samples in args.samples:
                path = Path(directory) / 'result.json'
                subprocess.run([str(python), str(Path(__file__).resolve()), '--worker', '--cache', str(args.cache),
                    '--threads', str(threads), '--samples', str(samples), '--seconds', str(args.seconds),
                    '--iterations', str(args.iterations), '--result', str(path)], check=True,
                    timeout=max(600, args.seconds*20), env={**os.environ, 'PYTHONDONTWRITEBYTECODE':'1'})
                r = json.loads(path.read_text()); results.append(r)
                print(f"{threads:7} {samples:10} {r['p50Ms']:7.1f} {r['p95Ms']:7.1f} {r['maxMs']:7.1f} {r['decisionsPerSecond']:11.2f} {r['cpuCores']:9.2f} {r['peakMiB']:8.0f}", flush=True)
    with (args.cache / 'nomad.pth').open('rb') as f:
        digest = hashlib.file_digest(f, 'sha256').hexdigest()
    report = dict(benchmark='nomad-cpu-v1', platform=platform.platform(), logicalCpus=os.cpu_count(),
        loadAverage=os.getloadavg(), sourceRevisions=dict(vint=VINT,diffusion=DIFFUSION), checkpointSha256=digest,
        exclusions=['capture','video decode','network','physical control','training','concurrent model workloads'], results=results)
    print('\nPaste this report back:\n' + json.dumps(report, separators=(',', ':')))
    print('At 10 decisions/s the total budget is 100ms; at 5/s it is 200ms. Leave room for the excluded pipeline.')


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print(f'Benchmark failed: {error}', file=sys.stderr)
        sys.exit(1)
