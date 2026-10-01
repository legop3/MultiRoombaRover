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
import resource
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
    from learning import loss_setup, tensors, losses as policy_losses, evaluate, probe
    from dataset import windows
    from policy import Policy, VERSION, SLOTS, VALUES, specification, is_stop, select_slots, initial_schema

    if args.check_dependencies:
        emit('dependencies', torch=str(torch.__version__), numpy=str(np.__version__), av=str(av.__version__),
             parameters=sum(p.numel() for p in Policy().parameters()), specification=specification(initial_schema()))
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
    # The command-event policy has different inputs, targets and weights. Keep its
    # optimizer lineage separate; reuse recordings with their unchanged partition.
    resume_path = root / 'training' / 'resume-v6.pt'
    schema, steps, examples, last_published = initial_schema(), 0, 0, 0
    trained_rovers = set()
    control_profiles = []
    distinct_windows = {}
    published_windows = 0
    last_probe_steps, learning_probe = 0, None
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
        last_probe_steps = saved.get('lastProbeSteps', 0)
        learning_probe = saved.get('learningProbe')
    cpu_started = time.process_time()
    decode_started = time.monotonic()
    dataset_stats = []
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
        stats = {}
        buckets = {key: [] for key in ('stop', 'command', 'none')}
        counts = dict.fromkeys(buckets, 0)
        held_out = is_held_out(session_id)
        try:
            directory = root / 'recordings' / session_id
            for sample in windows(directory, candidate_schema, cancelled, stats, extend=not held_out):
                seen += 1
                # Keep evaluation naturally distributed. Training reserves space
                # for recorded commands and releases so periods without commands
                # cannot consume the entire sample budget. No scripted driving required.
                if held_out:
                    reservoir, count, capacity = samples, seen, per_session
                else:
                    category = ('stop' if any(sample[2][slot] and is_stop(descriptor)
                                              for slot, descriptor in enumerate(candidate_schema)) else
                                'command' if sample[2].any() else 'none')
                    counts[category] += 1
                    reservoir, count, capacity = buckets[category], counts[category], max(1, per_session // 3)
                if len(reservoir) < capacity:
                    reservoir.append(sample)
                else:
                    index = random.randrange(count)
                    if index < capacity:
                        reservoir[index] = sample
            if not held_out:
                samples = [sample for bucket in buckets.values() for sample in bucket]
            if cancelled():
                break  # Do not call a partially decoded recording validated.
            if not samples:
                if held_out and stats.get('unsupportedCommandEvents'):
                    dataset_stats.append({**stats, 'partition': 'heldOut', 'sampledWindows': 0,
                                          'skipReason': 'No supported aligned windows'})
                    continue
                raise ValueError('No complete, aligned observation/action windows')
            # Entire sessions stay in one partition across all jobs. Neighboring
            # video windows must never straddle training and validation.
            held_out = is_held_out(session_id)
            if held_out:
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
            stats.update({'partition': 'heldOut' if held_out else 'training', 'sampledWindows': len(samples)})
            dataset_stats.append(stats)
            emit('dataset', sessionId=session_id, windows=seen, sampled=len(samples), diagnostics=stats)
        except (ValueError, KeyError, TypeError, OSError, EOFError, IndexError, OverflowError, av.error.FFmpegError) as error:
            rejected[session_id] = str(error)[:500]
            emit('skipped', sessionId=session_id, reason=rejected[session_id])
    if len(pool) < config['minimumSamples'] or not any(sample[2].any() for sample in pool) or cancelled():
        emit('complete', trained=False, accepted=[], rejected=rejected, samples=len(pool),
             diagnostics={'dataset': dataset_stats, 'decodeSeconds': time.monotonic() - decode_started},
             reason='Stopped/time limit' if cancelled() else 'Waiting for enough training-partition samples with human actions')
        return

    decode_seconds = time.monotonic() - decode_started
    audit_started = time.monotonic()
    numeric_mask, positive_weight = loss_setup(pool, schema)
    training_rows = [row for row in dataset_stats if row.get('partition') == 'training']
    natural_count = sum(row.get('usableWindows', 0) for row in training_rows)
    frequencies = np.sum([row.get('commandEventCounts', [0] * SLOTS) for row in training_rows], axis=0) / max(1, natural_count)
    audit_subset = pool[::max(1, len(pool) // 96)][:96]
    before_training = evaluate(model, audit_subset, schema, job['actionThreshold'], frequencies, config['batchSize'], cancelled)
    before_audit_seconds = time.monotonic() - audit_started
    train_started = time.monotonic()
    gradient_norms = []
    losses = []
    model.train()
    for _ in range(config['passesPerJob']):
        random.shuffle(pool)
        for offset in range(0, len(pool), config['batchSize']):
            if cancelled() or steps - initial_steps >= config['maxStepsPerJob']:
                break
            batch = pool[offset:offset + config['batchSize']]
            images, states, targets, values, available = tensors(batch)
            optimizer.zero_grad(set_to_none=True)
            action_logits, predictions = model(images, states)
            event_loss, value_loss = policy_losses(action_logits, predictions, targets, values, available, numeric_mask, positive_weight)
            loss = event_loss + value_loss
            if not torch.isfinite(loss):
                raise ValueError('Nonfinite training loss; checkpoint not saved')
            loss.backward()
            gradient_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 1)
            if not torch.isfinite(gradient_norm):
                raise ValueError('Nonfinite training gradient; checkpoint not saved')
            gradient_norms.append(float(gradient_norm))
            optimizer.step()
            steps += 1
            examples += len(batch)
            losses.append(loss.item())
            if steps % 10 == 0:
                emit('progress', steps=steps, examples=examples, loss=loss.item(),
                     losses={'events': event_loss.item(), 'commandValues': value_loss.item()})
        if cancelled() or steps - initial_steps >= config['maxStepsPerJob']:
            break
    if steps == initial_steps:
        emit('complete', trained=False, accepted=[], rejected=rejected, reason='No training steps completed')
        return

    training_seconds = time.monotonic() - train_started
    evaluation_started = time.monotonic()
    distinct_windows.update(observed_windows)
    unique_count = sum(distinct_windows.values())
    coverage = [row for row in dataset_stats if row.get('partition') == 'heldOut']
    unsupported_events = sum(row.get('unsupportedCommandEvents', 0) for row in coverage)
    unsupported_windows = sum(row.get('unsupportedWindows', 0) for row in coverage)
    evaluation = {'status': 'No supported held-out windows' if unsupported_events and not validation else 'waiting for held-out sessions',
                  'windows': len(validation), 'unsupportedCommandEvents': unsupported_events,
                  'unsupportedWindows': unsupported_windows}
    if validation and not cancelled():
        measured = evaluate(model, validation, schema, job['actionThreshold'], frequencies, config['batchSize'], cancelled)
        evaluated = measured['windows']
        precision, recall = measured.get('precision', 0), measured.get('recall', 0)
        actual_positive = measured.get('positiveActions', 0)
        mse = measured.get('numericMse', 0)
        stop_actual = measured.get('stopEvents', 0)
        stop_recall = measured.get('stopRecall', 0)
        drive_actual = measured.get('movementEvents', 0)
        drive_recall = measured.get('movementRecall', 0)
        frequency_f1 = max((row['f1'] for row in measured.get('baselines', {}).get('trainingFrequency', [])), default=0)
        held_out_sessions = sum(row.get('partition') == 'heldOut' and not row.get('skipReason') for row in dataset_stats)
        gate_reasons = []
        for condition, reason in [
            (unsupported_events == 0, 'Held-out controls are not fully represented; see unsupportedCommands'),
            (evaluated == len(validation), 'Evaluation interrupted'),
            (held_out_sessions >= 2, 'Need two usable held-out recordings'),
            (evaluated >= 128, 'Need 128 held-out windows'),
            (actual_positive >= 32, 'Need 32 held-out command events'),
            (stop_actual >= 8, 'Need eight held-out stop events'),
            (drive_actual >= 16, 'Need 16 held-out movement commands'),
            (drive_recall >= .5, 'Movement command recall below 0.5'),
            (precision >= .5, 'Command precision below 0.5'),
            (recall >= .5, 'Command recall below 0.5'),
            (stop_recall >= .5, 'Stop recall below 0.5'),
            (measured.get('f1', 0) > frequency_f1, 'Command F1 does not beat the training-frequency baseline'),
            (mse <= .1, 'Command parameter error above 0.1'),
        ]:
            if not condition:
                gate_reasons.append(reason)
        evaluation = {**measured, 'status': 'imitation gate not met' if gate_reasons else 'passed imitation gate',
                      'unsupportedCommandEvents': unsupported_events, 'unsupportedWindows': unsupported_windows,
                      'method': 'Isolated held-out 100ms events; live selection, no temporal latch/physical rollout',
                      'threshold': job['actionThreshold'], 'heldOutSessions': held_out_sessions,
                      'gateReasons': gate_reasons}
    after_training = evaluate(model, audit_subset, schema, job['actionThreshold'], frequencies, config['batchSize'], cancelled)
    probe_seconds = 0
    if not cancelled() and (learning_probe is None or steps - last_probe_steps >= 1000):
        remaining = config['maxJobSeconds'] - (time.monotonic() - started)
        if remaining > 10:
            probe_started = time.monotonic()
            learning_probe = probe(model, audit_subset, schema, job['actionThreshold'], frequencies,
                                   cancelled, max_seconds=min(20, remaining / 2))
            learning_probe['atTrainingStep'] = steps
            last_probe_steps = steps
            probe_seconds = time.monotonic() - probe_started
    training_audit = {'before': before_training, 'after': after_training,
                      'gradientNormBeforeClipping': {'min': min(gradient_norms), 'max': max(gradient_norms)},
                      'positiveWeights': positive_weight[:len(schema)].tolist(),
                      'naturalTrainingCommandFrequency': frequencies[:len(schema)].tolist(),
                      'sampledCommandFrequency': np.mean([row[2] for row in pool], axis=0)[:len(schema)].tolist(),
                      'learningProbe': learning_probe}
    evaluation_seconds = time.monotonic() - evaluation_started - probe_seconds
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
    publication['reason'] = '; '.join(reasons) or 'Latest updated'
    save_started = time.monotonic()
    published = None
    # Every completed job exports an immutable candidate; Node owns promotion and retention.
    adjectives = ['amber', 'curious', 'gentle', 'quiet', 'silver', 'bright', 'merry', 'sleepy']
    animals = ['otter', 'finch', 'badger', 'robin', 'fox', 'heron', 'marten', 'wren']
    model_id = str(uuid.uuid4())
    name = f'{random.choice(adjectives)}-{random.choice(animals)}-{model_id[:8]}'
    checkpoint_root = root / 'training' / 'checkpoints'
    checkpoint_root.mkdir(exist_ok=True)
    staging = checkpoint_root / f'.{model_id}.pending'
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
    staging.rename(checkpoint_root / model_id)
    if not reasons:
        last_published = steps
        published_windows = unique_count
    atomic_torch_save(torch, {
        'version': VERSION, 'weights': model.state_dict(), 'optimizer': optimizer.state_dict(),
        'schema': schema, 'steps': steps, 'examples': examples,
        'lastPublished': last_published, 'trainedRovers': sorted(trained_rovers),
        'controlProfiles': control_profiles, 'distinctWindows': distinct_windows,
        'publishedWindows': published_windows, 'lastProbeSteps': last_probe_steps, 'learningProbe': learning_probe,
    }, resume_path)
    diagnostics = {'dataset': dataset_stats, 'trainingAudit': training_audit, 'probeSeconds': probe_seconds, 'beforeAuditSeconds': before_audit_seconds, 'decodeSeconds': decode_seconds,
                   'trainingSeconds': training_seconds, 'evaluationSeconds': evaluation_seconds, 'checkpointSeconds': time.monotonic() - save_started,
                   'cpuSeconds': time.process_time() - cpu_started,
                   'peakRssMiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
                   'dependencies': {'torch': str(torch.__version__), 'numpy': str(np.__version__), 'av': str(av.__version__)},
                   'policy': specification(schema), 'browserVideoLatencyMs': None}
    emit('complete', trained=True, accepted=accepted, rejected=rejected,
         steps=steps, examples=examples, loss=sum(losses) / len(losses),
         published=published, promote=not reasons, publication=publication, evaluation=evaluation, diagnostics=diagnostics, elapsedSeconds=time.monotonic() - started)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit('error', message=str(error))
        raise SystemExit(1)
