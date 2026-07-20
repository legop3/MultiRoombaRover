// Fleet Report Builder
// Purpose: Produces dense read models from stored evidence without leaking presentation logic into collection.
// Scope: Owns totals, rover comparisons, attention findings, and exact supporting datasets for UI/Discord consumers.

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row?.[key]) || 0), 0);
}

function groupByRover(minutes, roster = []) {
  const rosterById = new Map(roster.map((rover) => [String(rover.id), rover]));
  const grouped = new Map();
  minutes.forEach((minute) => {
    const roverId = String(minute.roverId);
    if (!grouped.has(roverId)) grouped.set(roverId, []);
    grouped.get(roverId).push(minute);
  });
  return Array.from(new Set([...rosterById.keys(), ...grouped.keys()])).map((roverId) => {
    const rows = grouped.get(roverId) || [];
    const samples = sum(rows, 'sampleCount');
    const voltageWeighted = rows.reduce(
      (total, row) => total + (Number(row.avgVoltageMv) || 0) * (Number(row.sampleCount) || 0),
      0,
    );
    const temperatureWeighted = rows.reduce(
      (total, row) => total + (Number(row.avgTemperatureC) || 0) * (Number(row.sampleCount) || 0),
      0,
    );
    const latest = rows[rows.length - 1] || null;
    return {
      roverId,
      name: rosterById.get(roverId)?.name || roverId,
      color: rosterById.get(roverId)?.color || null,
      online: Boolean(rosterById.get(roverId)),
      sampleCount: samples,
      coverageMs: sum(rows, 'coverageMs'),
      gapCount: sum(rows, 'gapCount'),
      commandCount: sum(rows, 'commandCount'),
      driveCommandCount: sum(rows, 'driveCommandCount'),
      rejectedCommandCount: sum(rows, 'rejectedCommandCount'),
      distanceMm: sum(rows, 'distanceMm'),
      bumpCount: sum(rows, 'bumpCount'),
      cliffCount: sum(rows, 'cliffCount'),
      wheelDropCount: sum(rows, 'wheelDropCount'),
      virtualWallCount: sum(rows, 'virtualWallCount'),
      overcurrentEpisodeCount: sum(rows, 'overcurrentEpisodeCount'),
      chargedMah: sum(rows, 'chargedMah'),
      dischargedMah: sum(rows, 'dischargedMah'),
      averageVoltageMv: samples ? voltageWeighted / samples : null,
      minimumVoltageMv: rows.reduce((value, row) => row.minVoltageMv == null ? value : Math.min(value ?? Infinity, row.minVoltageMv), null),
      maximumVoltageMv: rows.reduce((value, row) => row.maxVoltageMv == null ? value : Math.max(value ?? -Infinity, row.maxVoltageMv), null),
      averageTemperatureC: samples ? temperatureWeighted / samples : null,
      minimumTemperatureC: rows.reduce((value, row) => row.minTemperatureC == null ? value : Math.min(value ?? Infinity, row.minTemperatureC), null),
      maximumTemperatureC: rows.reduce((value, row) => row.maxTemperatureC == null ? value : Math.max(value ?? -Infinity, row.maxTemperatureC), null),
      latestChargeMah: latest?.lastChargeMah ?? null,
      reportedCapacityMah: latest?.reportedCapacityMah ?? null,
      lastSampleAt: latest ? latest.bucketTs + 60000 : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function buildFindings({ roverRows, events, now }) {
  const findings = [];
  roverRows.forEach((rover) => {
    if (!rover.sampleCount) {
      findings.push({
        key: `no-telemetry:${rover.roverId}`,
        roverId: rover.roverId,
        severity: rover.online ? 'warning' : 'notice',
        confidence: 'high',
        status: 'ongoing',
        title: rover.online ? 'No battery telemetry in selected range' : 'Rover offline or absent',
        evidence: { sampleCount: 0 },
      });
      return;
    }
    if (rover.maximumTemperatureC != null && rover.maximumTemperatureC >= 45) {
      findings.push({
        key: `battery-temperature:${rover.roverId}`,
        roverId: rover.roverId,
        severity: rover.maximumTemperatureC >= 50 ? 'critical' : 'warning',
        confidence: 'high',
        status: 'observed',
        title: 'High battery temperature observed',
        evidence: { maximumTemperatureC: rover.maximumTemperatureC, sampleCount: rover.sampleCount },
      });
    }
    if (rover.gapCount > 0) {
      findings.push({
        key: `telemetry-gaps:${rover.roverId}`,
        roverId: rover.roverId,
        severity: 'notice',
        confidence: 'high',
        status: 'observed',
        title: 'Battery integration contains telemetry gaps',
        evidence: { gapCount: rover.gapCount, coverageMs: rover.coverageMs },
      });
    }
    if (rover.lastSampleAt && now - rover.lastSampleAt > 5 * 60 * 1000 && rover.online) {
      findings.push({
        key: `stale-telemetry:${rover.roverId}`,
        roverId: rover.roverId,
        severity: 'warning',
        confidence: 'high',
        status: 'ongoing',
        title: 'Telemetry is stale while rover is online',
        evidence: { lastSampleAt: rover.lastSampleAt },
      });
    }
  });

  const criticalEvents = events.filter((event) => event.severity === 'critical');
  if (criticalEvents.length) {
    findings.push({
      key: 'critical-events',
      roverId: null,
      severity: 'critical',
      confidence: 'high',
      status: 'observed',
      title: `${criticalEvents.length} critical event${criticalEvents.length === 1 ? '' : 's'} in selected range`,
      evidence: { eventIds: criticalEvents.slice(0, 25).map((event) => event.id) },
    });
  }
  const rank = { critical: 0, warning: 1, notice: 2, informational: 3 };
  return findings.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildBatteryHealth({ sessions, roverRows, batteryRegistry }) {
  return roverRows.map((rover) => {
    const roverSessions = sessions.filter((session) => String(session.roverId) === String(rover.roverId));
    const qualified = roverSessions
      .filter((session) => session.kind === 'discharging' && session.details?.capacityTestQualified)
      .sort((a, b) => a.startedAt - b.startedAt);
    // The first three qualified tests establish the learned healthy baseline.
    // A median resists one unusually light/heavy run while remaining auditable
    // in the session table. Battery replacement identity will start a separate
    // key, so only sessions for the current key should contribute once one is
    // registered.
    const activeRegistryEntry = batteryRegistry.find((battery) =>
      String(battery.roverId) === String(rover.roverId) && battery.retiredAt == null,
    );
    const currentKey = activeRegistryEntry?.batteryKey || qualified[qualified.length - 1]?.batteryKey || roverSessions[0]?.batteryKey || `unregistered:${rover.roverId}`;
    const sameBattery = qualified.filter((session) => session.batteryKey === currentKey);
    const baselineTests = sameBattery.slice(0, 3);
    const baselineMah = median(baselineTests.map((session) => Number(session.dischargedMah)));
    const latest = sameBattery[sameBattery.length - 1] || null;
    const measuredUsableMah = latest ? Number(latest.dischargedMah) : null;
    const capacityRetentionPercent = baselineMah && measuredUsableMah != null
      ? measuredUsableMah / baselineMah * 100
      : null;
    const throughputMah = roverSessions.reduce((total, session) => total + (Number(session.dischargedMah) || 0), 0);
    const cycleReferenceMah = baselineMah || Number(rover.reportedCapacityMah) || null;
    return {
      roverId: rover.roverId,
      batteryKey: currentKey,
      qualifiedTestCount: sameBattery.length,
      baselineTestCount: baselineTests.length,
      baselineMah,
      measuredUsableMah,
      capacityRetentionPercent,
      equivalentFullCycles: cycleReferenceMah ? throughputMah / cycleReferenceMah : null,
      dischargedThroughputMah: throughputMah,
      latestQualifiedTestAt: latest?.endedAt || null,
      confidence: sameBattery.length >= 3 ? 'high' : sameBattery.length >= 1 ? 'medium' : 'low',
      confidenceReason: sameBattery.length >= 3
        ? 'at least three qualified full-to-low tests'
        : sameBattery.length >= 1
          ? 'fewer than three qualified tests'
          : 'no qualified full-to-low capacity test',
    };
  });
}

function createReportBuilder({ storage, collector, roverManager }) {
  function build({ since, until, roverIds, includeEvents = true, eventLimit = 500 }) {
    const visibleRoster = Array.from(roverManager.rovers?.values?.() || []).map((record) => ({
      id: record.id,
      name: record.name || record.id,
      color: record.color || record.meta?.color || null,
    }));
    const requestedIds = Array.isArray(roverIds) ? roverIds.map(String) : null;
    const roster = requestedIds
      ? visibleRoster.filter((rover) => requestedIds.includes(String(rover.id)))
      : visibleRoster;
    const effectiveIds = requestedIds || roster.map((rover) => String(rover.id));
    const minutes = storage.listMinutes({ since, until, roverIds: effectiveIds });
    const events = includeEvents
      ? storage.listEvents({ since, until, roverIds: effectiveIds, limit: eventLimit })
      : [];
    const batterySessions = storage.listBatterySessions({ since, until, roverIds: effectiveIds, limit: 500 });
    const roverRows = groupByRover(minutes, roster);
    const batteryRegistry = storage.listBatteries(effectiveIds);
    const batteryHealth = buildBatteryHealth({ sessions: batterySessions, roverRows, batteryRegistry });
    const findings = buildFindings({ roverRows, events, now: Date.now() });
    return {
      generatedAt: Date.now(),
      range: { since, until },
      totals: {
        roverCount: roverRows.length,
        onlineRoverCount: roverRows.filter((rover) => rover.online).length,
        sampleCount: sum(minutes, 'sampleCount'),
        coverageMs: sum(minutes, 'coverageMs'),
        telemetryGapCount: sum(minutes, 'gapCount'),
        commandCount: sum(minutes, 'commandCount'),
        driveCommandCount: sum(minutes, 'driveCommandCount'),
        rejectedCommandCount: sum(minutes, 'rejectedCommandCount'),
        distanceMm: sum(minutes, 'distanceMm'),
        bumpCount: sum(minutes, 'bumpCount'),
        cliffCount: sum(minutes, 'cliffCount'),
        wheelDropCount: sum(minutes, 'wheelDropCount'),
        virtualWallCount: sum(minutes, 'virtualWallCount'),
        overcurrentEpisodeCount: sum(minutes, 'overcurrentEpisodeCount'),
        chargedMah: sum(minutes, 'chargedMah'),
        dischargedMah: sum(minutes, 'dischargedMah'),
        eventCountReturned: events.length,
        batterySessionCount: batterySessions.length,
        criticalFindingCount: findings.filter((finding) => finding.severity === 'critical').length,
        warningFindingCount: findings.filter((finding) => finding.severity === 'warning').length,
      },
      rovers: roverRows,
      findings,
      minutes,
      batterySessions,
      batteryHealth,
      batteryRegistry,
      dailyReportHistory: storage.listDailyReports(365),
      events,
      live: collector.getLiveState(),
      diagnostics: {
        collector: collector.getDiagnostics(),
        storage: storage.getDiagnostics(),
      },
    };
  }

  return { build };
}

module.exports = {
  createReportBuilder,
};
