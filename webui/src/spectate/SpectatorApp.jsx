import { useMemo } from 'react';
import { useSession } from '../context/SessionContext.jsx';
import { useSpectatorMode } from '../hooks/useSpectatorMode.js';
import { useTelemetryFrames } from '../context/TelemetryContext.jsx';
import { useVideoRequests } from '../hooks/useVideoRequests.js';
import VideoTile from '../components/VideoTile.jsx';

function SpectatorStatus({ connected, ready, rosterCount }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className={`rounded-full px-3 py-1 font-semibold ${connected ? 'bg-emerald-500/20 text-emerald-200' : 'bg-red-500/20 text-red-200'}`}>
        {connected ? 'Connected' : 'Disconnected'}
      </span>
      <span className={`rounded-full px-3 py-1 ${ready ? 'bg-blue-600/40 text-blue-100' : 'bg-slate-700 text-slate-200'}`}>
        Spectator mode {ready ? 'active' : 'pending…'}
      </span>
      <span className="rounded-full bg-slate-800 px-3 py-1 text-slate-200">
        Rovers: {rosterCount}
      </span>
    </div>
  );
}

function LogStream({ logs }) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Server logs</h2>
        <span className="text-xs uppercase tracking-[0.3em] text-slate-500">latest {logs.length}</span>
      </header>
      <div className="h-60 overflow-y-auto rounded-2xl bg-slate-950/40 p-3 text-xs font-mono text-slate-300">
        {logs.length === 0 ? (
          <p>No log entries yet.</p>
        ) : (
          logs
            .slice()
            .reverse()
            .map((entry) => (
              <div key={entry.id} className="mb-2">
                <span className="text-slate-500">{entry.timestamp}</span>{' '}
                <span className="text-cyan-300">[{entry.level}]</span>{' '}
                {entry.label && <span className="text-pink-300">[{entry.label}]</span>}{' '}
                <span>{entry.message}</span>
              </div>
            ))
        )}
      </div>
    </section>
  );
}

function formatSensors(sensors = {}) {
  return Object.entries(sensors).map(([key, value]) => ({
    key,
    value: typeof value === 'object' ? JSON.stringify(value) : value,
  }));
}

function RoverSpectatorCard({ rover, frame, videoInfo }) {
  const sensorList = formatSensors(frame?.sensors);
  return (
    <article className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <header className="flex flex-col gap-1">
        <h3 className="text-2xl font-semibold text-white">{rover.name}</h3>
        <p className="text-sm text-slate-400">
          {frame?.receivedAt ? `Updated ${new Date(frame.receivedAt).toLocaleTimeString()}` : 'Waiting for telemetry…'}
        </p>
      </header>
      <VideoTile sessionInfo={videoInfo} label={rover.name} forceMute />
      <section className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Telemetry</p>
        {sensorList.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No sensor data yet.</p>
        ) : (
          <dl className="mt-3 grid gap-2 text-sm text-slate-200">
            {sensorList.map(({ key, value }) => (
              <div key={key} className="flex justify-between gap-4">
                <dt className="text-slate-500">{key}</dt>
                <dd className="text-right font-semibold text-white">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </article>
  );
}

export default function SpectatorApp() {
  const { connected, session, logs } = useSession();
  const spectatorReady = useSpectatorMode();
  const frames = useTelemetryFrames();
  const roster = session?.roster ?? [];
  const videoSources = useVideoRequests(roster.map((rover) => rover.id));

  const status = useMemo(
    () => ({ connected, ready: spectatorReady, rosterCount: roster.length }),
    [connected, spectatorReady, roster.length],
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-10">
        <header className="space-y-3">
          <h1 className="text-4xl font-semibold text-white">Spectator Console</h1>
          <p className="text-slate-400">Live rover telemetry & logs. This view is read-only.</p>
          <SpectatorStatus {...status} />
        </header>
        <section className="grid gap-6 lg:grid-cols-3">
          {roster.length === 0 ? (
            <p className="col-span-full text-slate-400">No rovers registered.</p>
          ) : (
            roster.map((rover) => (
              <RoverSpectatorCard
                key={rover.id}
                rover={rover}
                frame={frames[rover.id]}
                videoInfo={videoSources[rover.id]}
              />
            ))
          )}
        </section>
        <LogStream logs={logs} />
      </main>
    </div>
  );
}
