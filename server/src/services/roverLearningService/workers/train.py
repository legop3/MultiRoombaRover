#!/usr/bin/env python3
"""One finite CPU training job; Node owns scheduling, leases, and shutdown.

Usage: python train.py --job /path/to/job.json
Dependencies are packaged at image build time, never installed at runtime.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import random
import signal
import time
import uuid


def emit(kind, **data):
    print(json.dumps({'kind': kind, **data}, allow_nan=False), flush=True)


def atomic_torch_save(torch, value, path):
    temporary = path.with_suffix('.tmp')
    with temporary.open('wb') as stream:
        torch.save(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job')
    parser.add_argument('--check-dependencies', action='store_true', help='Describe the installed production policy and exit without creating storage')
    args = parser.parse_args()
    # --help works even before Python dependencies are installed.
    import numpy as np
    import av
    import torch
    from torch.nn import functional as functional
    from dataset import windows
    from policy import Policy, VERSION, SLOTS, VALUES, specification

    if args.check_dependencies:
        emit('dependencies', torch=str(torch.__version__), numpy=str(np.__version__), av=str(av.__version__),
             parameters=sum(p.numel() for p in Policy().parameters()), specification=specification([]))
        return
    if not args.job:
        parser.error('--job is required unless --check-dependencies is used')

    job = json.loads(Path(args.job).read_text())
    root = Path(job['root'])
    config = job['config']
    torch.set_num_threads(config['threads'])
    torch.set_num_interop_threads(1)
    # Training yields CPU priority to the Node/media processes. Thread count is
    # an additional bound, not a claim to reserve specific physical cores.
    os.nice(10)
    stopped = False

    def stop(_signal, _frame):
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    started = time.monotonic()
    cancelled = lambda: stopped or time.monotonic() - started >= config['maxJobSeconds']
    model = Policy().cpu()
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.0001)
    # A fresh training lineage prevents previously trained footage leaking into validation.
    resume_path = root / 'training' / 'resume-v2.pt'
    schema, steps, examples, last_published = [], 0, 0, 0
    trained_rovers = set()
    control_profiles = []
    distinct_windows = {}
    published_windows = 0
    if resume_path.exists():
        saved = torch.load(resume_path, map_location='cpu', weights_only=True)
        if saved['version'] != VERSION:
            raise ValueError('Resume schema incompatible; refusing to reinterpret existing weights')
        model.load_state_dict(saved['weights'])
        optimizer.load_state_dict(saved['optimizer'])
        schema = saved['schema']
        steps, examples = saved['steps'], saved['examples']
        last_published = saved['lastPublished']
        trained_rovers = set(saved['trainedRovers'])
        control_profiles = saved.get('controlProfiles', [])
        distinct_windows = saved.get('distinctWindows', {})
        published_windows = saved.get('publishedWindows', 0)
    initial_steps = steps
    pool, validation, accepted, rejected = [], [], [], {}
    observed_windows = {}
    sessions = list(job['sessions'])
    random.shuffle(sessions)
    is_held_out = lambda session_id: int(hashlib.sha256(session_id.encode()).hexdigest()[:8], 16) % 5 == 0
    sessions.sort(key=is_held_out)
    per_session = max(1, config['maxSamples'] // max(1, len(sessions)))
    for session_id in sessions:
        if cancelled():
            break
        candidate_schema = copy.deepcopy(schema)
        samples, seen = [], 0
        try:
            directory = root / 'recordings' / session_id
            for sample in windows(directory, candidate_schema, cancelled):
                seen += 1
                # Uniform reservoir across the whole recording, not just the
                # opening seconds. Frames remain uint8 until a batch is used.
                if len(samples) < per_session:
                    samples.append(sample)
                else:
                    index = random.randrange(seen)
                    if index < per_session:
                        samples[index] = sample
            if cancelled():
                break  # Do not call a partially decoded recording validated.
            if not samples:
                raise ValueError('No complete, aligned observation/action windows')
            # Entire sessions stay in one partition across all jobs. Neighboring
            # video windows must never straddle training and validation.
            held_out = is_held_out(session_id)
            if held_out:
                if candidate_schema != schema:
                    continue  # Retry after training data introduces these command shapes.
                validation.extend(samples)
            else:
                schema = candidate_schema
                pool.extend(samples)
                observed_windows[session_id] = seen
            accepted.append(session_id)
            metadata = json.loads((directory / 'session.json').read_text())
            if not held_out:
                trained_rovers.add(str(metadata['roverId']))
            profile = metadata.get('controlProfile')
            if not held_out and profile is not None and profile not in control_profiles:
                control_profiles.append(profile)
            emit('dataset', sessionId=session_id, windows=seen, sampled=len(samples))
        except (ValueError, KeyError, TypeError, OSError, EOFError, IndexError, OverflowError, av.error.FFmpegError) as error:
            rejected[session_id] = str(error)[:500]
            emit('skipped', sessionId=session_id, reason=rejected[session_id])
    if len(pool) < config['minimumSamples'] or not any(sample[2].any() for sample in pool) or cancelled():
        emit('complete', trained=False, accepted=[], rejected=rejected, samples=len(pool),
             reason='Stopped/time limit' if cancelled() else 'Waiting for enough training-partition samples with human actions')
        return

    numeric_mask = torch.zeros(SLOTS, VALUES)
    for slot, descriptor in enumerate(schema):
        numeric_mask[slot, :len(descriptor['fields'])] = 1
    # Balance sparse events without assuming that every time step should fire
    # every control. This is training loss, not a driving-quality evaluation.
    positives = np.sum([sample[2] for sample in pool], axis=0)
    opportunities = np.sum([sample[4] for sample in pool], axis=0)
    positive_weight = torch.from_numpy(np.clip((opportunities - positives) / np.maximum(positives, 1), 1, 20)).float()
    losses = []
    model.train()
    for _ in range(config['passesPerJob']):
        random.shuffle(pool)
        for offset in range(0, len(pool), config['batchSize']):
            if cancelled() or steps - initial_steps >= config['maxStepsPerJob']:
                break
            batch = pool[offset:offset + config['batchSize']]
            images, states, targets, values, available = [torch.from_numpy(np.stack(items)) for items in zip(*batch)]
            images = images.float().div_(255)
            optimizer.zero_grad(set_to_none=True)
            action_logits, predictions = model(images, states)
            event_loss = functional.binary_cross_entropy_with_logits(action_logits, targets,
                                                                       pos_weight=positive_weight, reduction='none')
            event_loss = (event_loss * available).sum() / available.sum().clamp_min(1)
            mask = numeric_mask.unsqueeze(0) * targets.unsqueeze(-1)
            value_loss = ((predictions - values).square() * mask).sum() / mask.sum().clamp_min(1)
            loss = event_loss + value_loss
            if not torch.isfinite(loss):
                raise ValueError('Nonfinite training loss; checkpoint not saved')
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1)
            optimizer.step()
            steps += 1
            examples += len(batch)
            losses.append(loss.item())
            if steps % 10 == 0:
                emit('progress', steps=steps, examples=examples, loss=loss.item())
        if cancelled() or steps - initial_steps >= config['maxStepsPerJob']:
            break
    if steps == initial_steps:
        emit('complete', trained=False, accepted=[], rejected=rejected, reason='No training steps completed')
        return

    distinct_windows.update(observed_windows)
    unique_count = sum(distinct_windows.values())
    evaluation = {'status': 'waiting for held-out sessions', 'windows': len(validation)}
    if validation and not cancelled():
        model.eval()
        true_positive = predicted_positive = actual_positive = 0
        value_error = value_count = 0
        evaluated = 0
        with torch.inference_mode():
            for offset in range(0, len(validation), config['batchSize']):
                if cancelled():
                    break
                batch = validation[offset:offset + config['batchSize']]
                images, states, targets, values, available = [torch.from_numpy(np.stack(items)) for items in zip(*batch)]
                logits, predictions = model(images.float() / 255, states)
                predicted = (logits.sigmoid() >= job['actionThreshold']) & available.bool()
                actual = targets.bool() & available.bool()
                true_positive += (predicted & actual).sum().item()
                predicted_positive += predicted.sum().item()
                actual_positive += actual.sum().item()
                mask = numeric_mask.unsqueeze(0) * targets.unsqueeze(-1)
                value_error += ((predictions - values).square() * mask).sum().item()
                value_count += mask.sum().item()
                evaluated += len(batch)
        precision = true_positive / max(1, predicted_positive)
        recall = true_positive / max(1, actual_positive)
        mse = value_error / max(1, value_count)
        # A basic imitation gate, not an autonomous-driving certification.
        passed = (evaluated == len(validation) and evaluated >= 128 and actual_positive >= 32
                  and precision >= .5 and recall >= .5 and value_count > 0 and mse <= .1)
        evaluation = {'status': 'passed imitation gate' if passed else 'imitation gate not met',
                      'windows': evaluated, 'precision': precision, 'recall': recall,
                      'numericMse': mse, 'positiveActions': actual_positive}
    publication = {'distinctMinutes': unique_count / 600,
                   'newMinutes': (unique_count - published_windows) / 600,
                   'minimumMinutes': config['minimumDrivingMinutes'],
                   'requiredNewMinutes': config['newDrivingMinutesPerModel']}
    reasons = []
    if publication['distinctMinutes'] < config['minimumDrivingMinutes']:
        reasons.append('Collecting distinct driving footage')
    if publication['newMinutes'] < config['newDrivingMinutesPerModel']:
        reasons.append('Waiting for new driving footage since last publication')
    if steps - last_published < config['checkpointEverySteps']:
        reasons.append('Training steps below publication interval')
    if evaluation['status'] != 'passed imitation gate':
        reasons.append(evaluation['status'])
    if cancelled():
        reasons.append('Job time budget reached')
    publication['reason'] = '; '.join(reasons) or 'Published'
    published = None
    if not reasons:
        adjectives = ['amber', 'curious', 'gentle', 'quiet', 'silver', 'bright', 'merry', 'sleepy']
        animals = ['otter', 'finch', 'badger', 'robin', 'fox', 'heron', 'marten', 'wren']
        model_id = str(uuid.uuid4())
        name = f'{random.choice(adjectives)}-{random.choice(animals)}-{model_id[:8]}'
        staging = root / 'models' / f'.{model_id}.pending'
        staging.mkdir()
        weights_path = staging / 'weights.pt'
        atomic_torch_save(torch, model.state_dict(), weights_path)
        published = {
            'id': model_id, 'name': name, 'createdAt': int(time.time() * 1000),
            'trainingSteps': steps, 'examplesProcessed': examples,
            'parameters': sum(p.numel() for p in model.parameters()),
            'weightBytes': weights_path.stat().st_size,
            'sha256': hashlib.sha256(weights_path.read_bytes()).hexdigest(),
            'specification': specification(schema), 'trainedRovers': sorted(trained_rovers),
            'controlProfiles': control_profiles,
            'sourceSessions': accepted, 'trainingLoss': sum(losses) / len(losses),
            'evaluation': evaluation['status'], 'validation': evaluation, 'distinctMinutes': publication['distinctMinutes'], 'dtype': 'float32', 'torchVersion': str(torch.__version__),
        }
        (staging / 'model.json').write_text(json.dumps(published, indent=2, allow_nan=False))
        # A catalog reader sees both weights and metadata, or neither. Existing
        # versions are never overwritten or deleted by the trainer.
        staging.rename(root / 'models' / model_id)
        last_published = steps
        published_windows = unique_count
    atomic_torch_save(torch, {
        'version': VERSION, 'weights': model.state_dict(), 'optimizer': optimizer.state_dict(),
        'schema': schema, 'steps': steps, 'examples': examples,
        'lastPublished': last_published, 'trainedRovers': sorted(trained_rovers),
        'controlProfiles': control_profiles, 'distinctWindows': distinct_windows,
        'publishedWindows': published_windows,
    }, resume_path)
    emit('complete', trained=True, accepted=accepted, rejected=rejected,
         steps=steps, examples=examples, loss=sum(losses) / len(losses),
         published=published, publication=publication, evaluation=evaluation, elapsedSeconds=time.monotonic() - started)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit('error', message=str(error))
        raise SystemExit(1)
