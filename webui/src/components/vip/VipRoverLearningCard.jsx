// One service snapshot supplies this entire card. Favorites never leave settings.
import { useEffect, useState } from 'react';
import { useSessionSelector } from '../../context/SessionContext.jsx';
import { isFeatureEnabled } from '../../lib/features.js';
import { useSocket } from '../../context/SocketContext.jsx';
import { useSettingsNamespace } from '../../settings/index.js';
import CardFrame from '../CardFrame/index.jsx';
import { fieldClass } from './constants.js';

const display = (value) => value == null ? 'Unavailable' : String(value);
const bytes = (value) => value == null ? 'Unavailable' : `${(value / 1024 ** 2).toFixed(1)} MiB`;
const time = (value) => value ? new Date(value).toLocaleString() : 'Unavailable';
const age = (now, value) => value ? `${Math.max(0, (now - value) / 1000).toFixed(1)} s` : 'Unavailable';

function Row({ label, children }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 py-0.5">
    <dt className="text-slate-400">{label}</dt>
    <dd className="min-w-0 break-words text-right text-slate-200">{children}</dd>
  </div>;
}

function Group({ title, children }) {
  return <section className="surface-muted min-w-0 space-y-1">
    <h4 className="font-semibold text-slate-200">{title}</h4>{children}
  </section>;
}

export default function VipRoverLearningCard() {
  const enabled = useSessionSelector((state) => isFeatureEnabled(state, 'roverLearning') && Boolean(state.session?.isVerified));
  const roverId = useSessionSelector((state) => state.session?.assignment?.roverId || null);
  if (!enabled) return null;
  return <LearningCard roverId={roverId} />;
}

function LearningCard({ roverId }) {
  const socket = useSocket();
  const [snapshot, setSnapshot] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const { value: settings, save } = useSettingsNamespace('roverLearning', { favorites: [] });
  const favorites = Array.isArray(settings?.favorites) ? settings.favorites : [];

  useEffect(() => {
    let active = true;
    const receive = (state) => { if (active) setSnapshot(state); };
    const subscribe = () => {
      if (!socket.connected) return;
      socket.timeout(5000).emit('roverLearning:subscribe', { roverId, live: detailsOpen }, (failure, response) => {
        if (!failure && response?.state) receive(response.state);
      });
    };
    const disconnected = () => receive(null);
    socket.on('roverLearning:state', receive);
    socket.on('connect', subscribe);
    socket.on('disconnect', disconnected);
    subscribe();
    // A config enable can mount this card before async service startup has
    // attached handlers. Resubscribe periodically without another data API.
    const timer = setInterval(subscribe, 10000);
    return () => {
      active = false;
      clearInterval(timer);
      socket.off('roverLearning:state', receive);
      socket.off('connect', subscribe);
      socket.off('disconnect', disconnected);
      socket.emit('roverLearning:unsubscribe');
    };
  }, [socket, roverId, detailsOpen]);

  const state = snapshot?.roverId === roverId ? snapshot : null;
  const models = [...(state?.models || [])].sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)) || b.createdAt - a.createdAt);
  const chosen = models.find((model) => model.id === selectedId) || models.find((model) => model.compatible) || models[0];
  const session = state?.session;
  const training = state?.training;
  const recording = state?.recording;
  const limits = state?.limits;
  const now = state?.updatedAt || 0;

  const act = (action) => {
    setWorking(true);
    setError('');
    socket.timeout(10000).emit('roverLearning:action', { action, roverId, modelId: chosen?.id }, (failure, response) => {
      setWorking(false);
      if (failure || response?.error) setError(response?.error || 'The server did not respond. Check the controller status before trying again.');
      else if (response?.state) setSnapshot(response.state);
    });
  };
  const favorite = () => {
    if (!chosen) return;
    save((current) => {
      const ids = Array.isArray(current?.favorites) ? current.favorites : [];
      return { ...current, favorites: ids.includes(chosen.id) ? ids.filter((id) => id !== chosen.id) : [...ids, chosen.id] };
    });
  };

  return <CardFrame title="Rover learning" className="w-full" bodyClassName="text-sm text-slate-300">
    <div className="space-y-2">
      <p className="text-center text-xs text-slate-400">
        {session ? `${session.modelName} · ${session.status}` : state ? 'Choose a model to control your rover.' : 'Waiting for rover learning status…'}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-1">
        <select aria-label="Rover model" className={fieldClass} value={chosen?.id || ''} onChange={(event) => setSelectedId(event.target.value)} disabled={working || !models.length}>
          {!models.length && <option value="">No published models yet</option>}
          {models.map((model) => <option key={model.id} value={model.id}>{favorites.includes(model.id) ? '★ ' : ''}{model.name}{model.compatible ? '' : ' (incompatible)'}</option>)}
        </select>
        <button type="button" className="button-dark text-sm disabled:opacity-50" aria-pressed={Boolean(chosen && favorites.includes(chosen.id))} disabled={!chosen} onClick={favorite}>
          {chosen && favorites.includes(chosen.id) ? '★ Favorite' : '☆ Favorite'}
        </button>
      </div>
      <div className="flex justify-center gap-1">
        <button type="button" className="button-dark text-sm disabled:opacity-50" disabled={working || !state?.control?.canStart || !chosen?.compatible} onClick={() => act('start')}>Start</button>
        <button type="button" className="button-dark text-sm disabled:opacity-50" disabled={working || !state?.control?.canStop} onClick={() => act('stop')}>Stop</button>
      </div>
      {state?.control?.reason && <p className="text-center text-xs text-slate-400">{state.control.reason}</p>}
      {/* <p className="text-center text-xs text-slate-500">Manual controls stay available and do not stop the model.</p> */}
      <p className="text-center text-xs text-slate-400">Recording: {recording ? recording.paused ? 'paused for disk space' : `${recording.sessions.filter((item) => item.video === 'Recording human driving').length} driving · ${recording.sessions.filter((item) => item.video === 'Dock lead-in buffer').length} dock buffer(s)` : 'unavailable'} · Training: {training?.status || 'unavailable'}</p>
      {(error || state?.catalogError) && <p role="alert" className="break-words text-xs text-amber-300">{error || state.catalogError}</p>}
      <details className="surface-muted text-xs" onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer py-1 font-semibold text-slate-200">System details</summary>
        <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 @[36rem]:grid-cols-2">
          <Group title="Recording and storage"><dl>
            <Row label="Recording size">{bytes(recording?.bytes)}</Row>
            <Row label="Disk budget">{limits ? `${limits.recording.maxGiB} GiB` : 'Unavailable'}</Row>
            <Row label="Free disk space">{bytes(recording?.freeBytes)}</Row>
            <Row label="Minimum free space">{limits ? `${limits.recording.minimumFreeGiB} GiB` : 'Unavailable'}</Row>
            <Row label="Session rotation">{limits ? `${limits.recording.sessionSeconds} s` : 'Unavailable'}</Row>
            <Row label="Buffered events">{bytes(recording?.pendingBytes)}</Row>
            <Row label="Dropped buffered events">{display(recording?.droppedPending)}</Row>
          </dl>{recording?.sessions.map((item) => <div key={item.id} className="mt-1 border-t border-slate-700 pt-1">
            <p>{item.roverId} · {item.video} · {age(now, item.startedAt)}</p>
            <p>Dropped events: {item.droppedEvents}</p>{item.error && <p className="text-amber-300">{item.error}</p>}
          </div>)}</Group>
          <Group title="Dataset and training"><dl>
            <Row label="Status">{training?.status || 'Unavailable'}</Row>
            <Row label="Steps">{display(training?.steps)}</Row>
            <Row label="Examples processed">{display(training?.examples)}</Row>
            <Row label="Training loss">{training?.loss == null ? 'Unavailable' : training.loss.toFixed(4)}</Row>
            <Row label="Current job age">{training?.status === 'training' ? age(now, training.startedAt) : 'Not running'}</Row>
            <Row label="Next attempt">{time(training?.nextAttemptAt)}</Row>
            <Row label="Visited / skipped sessions">{training ? `${training.visitedSessions} / ${training.skippedSessions}` : 'Unavailable'}</Row>
            <Row label="Sessions protected from retention">{display(training?.leasedSessions)}</Row>
            <Row label="Last windows available / sampled">{training?.lastAvailableWindows == null ? 'Unavailable' : `${training.lastAvailableWindows} / ${training.lastSampledWindows}`}</Row>
            <Row label="CPU threads / batch size">{limits ? `${limits.training.threads} / ${limits.training.batchSize}` : 'Unavailable'}</Row>
            <Row label="Samples / passes per job">{limits ? `${limits.training.maxSamples} / ${limits.training.passesPerJob}` : 'Unavailable'}</Row>
            <Row label="Distinct training minutes">{training?.publication?.distinctMinutes?.toFixed(1) ?? 'Unavailable'}</Row>
            <Row label="Publication minimum / new minutes">{limits ? `${limits.training.minimumDrivingMinutes} / ${limits.training.newDrivingMinutesPerModel}` : 'Unavailable'}</Row>
            <Row label="Publication status">{training?.publication?.reason || 'Collecting data'}</Row>
            <Row label="Held-out evaluation">{training?.evaluation?.status || 'Waiting for held-out data'}</Row>
            <Row label="Held-out precision / recall">{training?.evaluation?.precision == null ? 'Unavailable' : `${training.evaluation.precision.toFixed(3)} / ${training.evaluation.recall.toFixed(3)}`}</Row>
            <Row label="Steps between publications">{display(limits?.training.checkpointEverySteps)}</Row>
          </dl>{training?.error && <p className="break-words text-amber-300">{training.error}</p>}
            {training?.reason && <p>{training.reason}</p>}
            {training?.rejectionReasons?.map((reason) => <p className="break-words text-amber-300" key={reason}>{reason}</p>)}
          </Group>
          <Group title="Selected model"><dl>
            <Row label="Name">{chosen?.name || 'None'}</Row>
            <Row label="Created">{time(chosen?.createdAt)}</Row>
            <Row label="Size">{bytes(chosen?.weightBytes)}</Row>
            <Row label="Parameters">{chosen?.parameters?.toLocaleString() || 'Unavailable'}</Row>
            <Row label="Steps / examples">{chosen ? `${chosen.trainingSteps} / ${chosen.examplesProcessed}` : 'Unavailable'}</Row>
            <Row label="Control shapes">{display(chosen?.controls)}</Row>
            <Row label="Evaluation">{chosen?.evaluation || 'Unavailable'}</Row>
            <Row label="Distinct training minutes">{chosen?.distinctMinutes?.toFixed(1) ?? 'Unavailable'}</Row>
            <Row label="Held-out precision / recall">{chosen?.validation?.precision == null ? 'Unavailable' : `${chosen.validation.precision.toFixed(3)} / ${chosen.validation.recall.toFixed(3)}`}</Row>
            <Row label="Published models">{models.length}</Row>
          </dl></Group>
          <Group title="Live controller"><dl>
            <Row label="Latest prediction">{session?.predictionStatus || 'Unavailable'}</Row>
            <Row label="Action threshold">{display(session?.threshold)}</Row>
            <Row label="State">{session?.status || 'Stopped'}</Row>
            <Row label="Started by">{session?.startedBy || 'Unavailable'}</Row>
            <Row label="Duration">{age(now, session?.startedAt)}</Row>
            <Row label="Inference time">{session?.latencyMs == null ? 'Unavailable' : `${session.latencyMs.toFixed(1)} ms`}</Row>
            <Row label="Video age">{age(now, session?.frameAt)}</Row>
            <Row label="Sensor age">{age(now, session?.sensorAt)}</Row>
            <Row label="Last command result">{session?.lastResult || 'Unavailable'}</Row>
            <Row label="CPU threads">{display(limits?.driving.threads)}</Row>
          </dl>{session?.lastAction && <pre className="mt-1 whitespace-pre-wrap break-all text-slate-400">{JSON.stringify(session.lastAction.command, null, 2)}</pre>}
            {session?.proposals?.length > 0 && <div className="mt-2 max-h-72 space-y-1 overflow-auto">
              {session.proposals.map((proposal) => <div key={proposal.slot} className="border-t border-slate-700 py-1">
                <p>{proposal.command.type} · score {proposal.score.toFixed(3)} · {proposal.reason}</p>
                <pre className="whitespace-pre-wrap break-all text-slate-400">{JSON.stringify(proposal.command)}</pre>
              </div>)}
            </div>}
            {session?.submissions?.map((item, index) => <p key={index}>Submitted {item.command.type}: {item.result}</p>)}
            {session?.stopReason && <p>{session.stopReason}</p>}
          </Group>
          <div className="@[36rem]:col-span-2"><Group title="Recent activity">
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {state?.activity?.map((entry, index) => <li key={`${entry.at}-${index}`} className="break-words">
                <span className="text-slate-500">{time(entry.at)}</span> · {entry.message}{entry.roverId ? ` · ${entry.roverId}` : ''}{entry.detail ? ` · ${entry.detail}` : ''}
              </li>)}
            </ul>
          </Group></div>
        </div>
      </details>
    </div>
  </CardFrame>;
}
