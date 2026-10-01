"""Training objective and bounded, observational learning diagnostics."""
import copy
import time

import numpy as np
import torch
from torch.nn import functional as F

from policy import SLOTS, VALUES, select_slots, decode_command, is_stop


def loss_setup(samples, schema):
    numeric_mask = torch.zeros(SLOTS, VALUES)
    for slot, descriptor in enumerate(schema):
        numeric_mask[slot, :len(descriptor['fields'])] = 1
    positives = np.sum([sample[2] for sample in samples], axis=0)
    opportunities = np.sum([sample[4] for sample in samples], axis=0)
    weight = torch.from_numpy(np.clip((opportunities - positives) / np.maximum(positives, 1), 1, 20)).float()
    return numeric_mask, weight


def tensors(samples):
    images, states, targets, values, available = [torch.from_numpy(np.stack(items)) for items in zip(*samples)]
    return images.float().div_(255), states, targets, values, available


def losses(logits, predictions, targets, values, available, numeric_mask, positive_weight):
    events = F.binary_cross_entropy_with_logits(logits, targets, pos_weight=positive_weight, reduction='none')
    events = (events * available).sum() / available.sum().clamp_min(1)
    mask = numeric_mask.unsqueeze(0) * targets.unsqueeze(-1)
    parameters = ((predictions - values).square() * mask).sum() / mask.sum().clamp_min(1)
    return events, parameters


def distribution(values):
    values = np.asarray(values, dtype=np.float64)
    if not values.size:
        return {'count': 0, 'mean': None, 'p50': None, 'p95': None, 'max': None}
    return {'count': int(values.size), 'mean': float(values.mean()),
            'p50': float(np.quantile(values, .5)), 'p95': float(np.quantile(values, .95)), 'max': float(values.max())}


def decisions(scores, schema, threshold):
    selected = np.zeros_like(scores, dtype=bool)
    for row, vector in enumerate(scores):
        for slot in select_slots(vector, schema, threshold):
            selected[row, slot] = True
    return selected


def counts(predicted, actual):
    matched = int((predicted & actual).sum())
    proposed, wanted = int(predicted.sum()), int(actual.sum())
    empty = ~actual.any(axis=1)
    return {'predictedActions': proposed, 'positiveActions': wanted, 'matchedActions': matched,
            'precision': matched / max(1, proposed), 'recall': matched / max(1, wanted),
            'f1': 2 * matched / max(1, proposed + wanted),
            'falsePositiveActions': proposed - matched,
            'noCommandWindows': int(empty.sum()), 'unwantedCommandWindows': int((empty & predicted.any(axis=1)).sum())}


def summarize(scores, actual, schema, threshold, frequencies):
    active_scores = scores[:, :len(schema)]
    labels = actual[:, :len(schema)]
    thresholds = sorted(set([.1, .3, .5, .7, .9, threshold]))
    sweep = [{'threshold': value, **counts(decisions(scores, schema, value), actual)} for value in thresholds]
    frequent = np.broadcast_to(frequencies, scores.shape)
    baseline = [{'threshold': value, **counts(decisions(frequent, schema, value), actual)} for value in thresholds]
    return {'scoreOnHumanCommands': distribution(active_scores[labels]),
            'scoreOnAbsentCommands': distribution(active_scores[~labels]),
            'maxScoreOnNoCommandWindows': distribution(active_scores[~actual.any(axis=1)].max(axis=1)) if (~actual.any(axis=1)).any() else distribution([]),
            'thresholds': sweep, 'baselines': {'sendNothing': counts(np.zeros_like(actual), actual),
                'trainingFrequency': baseline, 'frequencySource': 'Training windows only; no held-out fitting'},
            'perCommandScores': [{'slot': slot, 'onHumanCommand': distribution(scores[actual[:, slot], slot]),
                                   'otherwise': distribution(scores[~actual[:, slot], slot])} for slot in range(len(schema))]}


def evaluate(model, samples, schema, threshold, frequencies, batch_size, cancelled):
    """Same score selection as runtime; isolated windows cannot measure latching."""
    model.eval()
    score_rows, target_rows = [], []
    value_error = value_count = 0
    decoded = {}
    with torch.inference_mode():
        for offset in range(0, len(samples), batch_size):
            if cancelled():
                break
            images, states, targets, values, _ = tensors(samples[offset:offset + batch_size])
            logits, numeric = model(images, states)
            if not torch.isfinite(logits).all() or not torch.isfinite(numeric).all():
                raise ValueError('Nonfinite evaluation output')
            score_rows.append(logits.sigmoid().numpy())
            target_rows.append(targets.numpy().astype(bool))
            for row, slot in targets.nonzero().tolist():
                descriptor = schema[slot]
                n = len(descriptor['fields'])
                value_error += (numeric[row, slot, :n] - values[row, slot, :n]).square().sum().item()
                value_count += n
                prediction = decode_command(descriptor, numeric[row, slot])
                expected = decode_command(descriptor, values[row, slot])
                for field in descriptor['fields']:
                    a, b = prediction, expected
                    for key in field['path']:
                        a, b = a[key], b[key]
                    key = descriptor['template']['type'] + '.' + '.'.join(map(str, field['path']))
                    total, count = decoded.get(key, (0, 0))
                    decoded[key] = (total + abs(a - b), count + 1)
    if not score_rows:
        return {'windows': 0, 'complete': False}
    scores, actual = np.concatenate(score_rows), np.concatenate(target_rows)
    predicted = decisions(scores, schema, threshold)
    stop_slots = [i for i, d in enumerate(schema) if is_stop(d)]
    move_slots = [i for i, d in enumerate(schema) if d['template']['type'] == 'drive' and not is_stop(d)]
    stop_count = int(actual[:, stop_slots].sum())
    stop_match = int((actual[:, stop_slots] & predicted[:, stop_slots]).sum())
    move_count = int(actual[:, move_slots].sum())
    move_match = int((actual[:, move_slots] & predicted[:, move_slots]).sum())
    return {'windows': len(scores), 'complete': len(scores) == len(samples),
            'stopEvents': stop_count, 'missedStops': stop_count - stop_match,
            'stopRecall': stop_match / max(1, stop_count),
            'falseStops': int((predicted[:, stop_slots] & ~actual[:, stop_slots]).sum()),
            'movementEvents': move_count, 'movementRecall': move_match / max(1, move_count),
            'commands': [{'slot': i, 'command': d['template'], 'actual': int(actual[:, i].sum()),
                          'predicted': int(predicted[:, i].sum()),
                          'matched': int((actual[:, i] & predicted[:, i]).sum())} for i, d in enumerate(schema)],
            'numericMse': value_error / max(1, value_count),
            'decodedParameterMaeBeforeServerLimits': {key: total / count for key, (total, count) in decoded.items()},
            **counts(decisions(scores, schema, threshold), actual),
            **summarize(scores, actual, schema, threshold, frequencies)}


def probe(model, samples, schema, threshold, frequencies, cancelled, max_seconds=20):
    """Try fitting a small real training subset on a disposable copy, never publish it."""
    started = time.monotonic()
    # Include both event and quiet windows; source is training only. No random
    # state/optimizer changes escape into the continuing learner.
    quiet = [row for row in samples if not row[2].any()][:4]
    # A reservoir is grouped by category: taking its first events could probe
    # only zero-speed drive and falsely suggest all controls were learnable.
    by_slot = [[i for i, row in enumerate(samples) if row[2][slot]] for slot in range(len(schema))]
    chosen = []
    for rank in range(8):
        for indices in by_slot:
            if rank < len(indices) and indices[rank] not in chosen and len(chosen) < 8:
                chosen.append(indices[rank])
    subset = [samples[i] for i in chosen] + quiet
    if not chosen:
        return {'status': 'No command examples', 'steps': 0}
    with torch.random.fork_rng(devices=[]):
        candidate = copy.deepcopy(model)
        optimizer = torch.optim.AdamW(candidate.parameters(), lr=.001)
        numeric_mask, weights = loss_setup(subset, schema)
        images, states, targets, values, available = tensors(subset)
        initial_loss = final_loss = gradient_norm = None
        completed = 0
        expired = lambda: cancelled() or time.monotonic() - started >= max_seconds
        for _ in range(80):
            if expired():
                break
            candidate.train()
            optimizer.zero_grad(set_to_none=True)
            logits, predictions = candidate(images, states)
            event_loss, value_loss = losses(logits, predictions, targets, values, available, numeric_mask, weights)
            loss = event_loss + value_loss
            if not torch.isfinite(loss):
                raise ValueError('Nonfinite learning probe loss')
            if initial_loss is None:
                initial_loss = loss.item()
            loss.backward()
            norm = torch.nn.utils.clip_grad_norm_(candidate.parameters(), 1)
            if not torch.isfinite(norm):
                raise ValueError('Nonfinite learning probe gradient')
            gradient_norm = float(norm)
            optimizer.step()
            final_loss = loss.item()
            completed += 1
        result = evaluate(candidate, subset, schema, threshold, frequencies, 16, cancelled)
    return {'status': 'completed' if completed == 80 else 'budget limited', 'steps': completed,
            'windows': len(subset), 'initialLoss': initial_loss, 'lastStepLoss': final_loss,
            'lastGradientNormBeforeClipping': gradient_norm, 'elapsedSeconds': time.monotonic() - started,
            'evaluation': result, 'meaning': 'Memorization on a disposable copy of training data, not generalization'}
