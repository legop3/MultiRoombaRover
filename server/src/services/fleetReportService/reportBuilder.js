// Fleet Report Builder
// Purpose: Produces fleet-wide battery-health and energy-efficiency read models from passive evidence.
// Scope: Keeps estimation, confidence, and comparison policy out of collection, transport, Discord, and UI code.

const MINIMUM_EFFICIENCY_DISTANCE_MM = 25 * 1000;

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row?.[key]) || 0), 0);
}

function median(values) {
  const usable = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!usable.length) return null;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
}

function weightedAverage(rows, valueKey, weightKey = 'sampleCount') {
  const weighted = rows.reduce((result, row) => {
    const value = Number(row[valueKey]);
    const weight = Number(row[weightKey]);
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) return result;
    result.total += value * weight;
    result.weight += weight;
    return result;
  }, { total: 0, weight: 0 });
  return weighted.weight ? weighted.total / weighted.weight : null;
}

function minimum(rows, key) {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

function maximum(rows, key) {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function confidenceForObservationCount(count, averageDepthPercent) {
  /*
    Confidence is intentionally continuous evidence summarized into a label,
    not a pass/fail cycle judgment. Multiple partial observations can become
    strong evidence, while shallow observations remain visible and useful.
  */
  if (count >= 5 && averageDepthPercent >= 25) return 'high';
  if (count >= 2 && averageDepthPercent >= 10) return 'medium';
  return 'low';
}

function buildBatteryHealth({ rover, sessions, registryEntry }) {
  const referenceMah = Number(registryEntry?.ratedCapacityMah) || Number(rover.reportedCapacityMah) || null;
  const batteryKey = registryEntry?.batteryKey
    || sessions[0]?.batteryKey
    || `unregistered:${rover.roverId}`;
  const sameBattery = sessions.filter((session) => session.batteryKey === batteryKey);
  const observations = sameBattery.flatMap((session) => {
    if (session.kind !== 'discharging' || !referenceMah) return [];
    const chargeDropMah = Number(session.startChargeMah) - Number(session.endChargeMah);
    const dischargedMah = Number(session.dischargedMah);
    if (!Number.isFinite(chargeDropMah) || chargeDropMah < 100 || !Number.isFinite(dischargedMah) || dischargedMah <= 0) {
      return [];
    }
    const depthPercent = chargeDropMah / referenceMah * 100;
    /*
      Packet 25 provides the changing charge position while signed current
      supplies an independent coulomb count. Extrapolating each partial slice
      produces a capacity observation without requiring a full-to-empty run.
      Depth is retained so callers can see exactly how much evidence supports
      the estimate.
    */
    return [{
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      depthPercent,
      estimatedUsableMah: dischargedMah / (chargeDropMah / referenceMah),
      gapCount: Number(session.gapCount) || 0,
    }];
  });
  const cleanObservations = observations.filter((observation) => observation.gapCount <= 1);
  const measuredUsableMah = median(cleanObservations.map((observation) => observation.estimatedUsableMah));
  const observedChargeHighMah = maximum(rover.minutes, 'maxChargeMah');
  const observedChargeLowMah = minimum(rover.minutes, 'minChargeMah');
  const observedUsableFloorMah = observedChargeHighMah != null && observedChargeLowMah != null
    ? Math.max(0, observedChargeHighMah - observedChargeLowMah)
    : null;
  const averageDepthPercent = cleanObservations.length
    ? sum(cleanObservations, 'depthPercent') / cleanObservations.length
    : 0;
  const baselineMah = Number(registryEntry?.healthyBaselineMah) || referenceMah;
  const capacityRetentionPercent = measuredUsableMah && baselineMah
    ? measuredUsableMah / baselineMah * 100
    : null;
  const nominalVoltageMv = rover.averageVoltageMv;

  return {
    batteryKey,
    referenceMah,
    baselineMah,
    measuredUsableMah,
    measuredUsableWh: measuredUsableMah && nominalVoltageMv
      ? measuredUsableMah * nominalVoltageMv / 1e6
      : null,
    capacityRetentionPercent,
    observedUsableFloorMah,
    observedChargeHighMah,
    observedChargeLowMah,
    observationCount: cleanObservations.length,
    averageObservationDepthPercent: averageDepthPercent,
    confidence: confidenceForObservationCount(cleanObservations.length, averageDepthPercent),
    confidenceReason: cleanObservations.length
      ? `${cleanObservations.length} partial current/charge observations averaging ${averageDepthPercent.toFixed(1)}% depth`
      : 'collecting partial discharge evidence',
    dischargedThroughputMah: sum(sameBattery, 'dischargedMah'),
    latestObservationAt: cleanObservations.reduce(
      (latest, observation) => Math.max(latest, Number(observation.endedAt) || Number(observation.startedAt) || 0),
      0,
    ) || null,
    observations: cleanObservations,
  };
}

function groupByRover({ minutes, sessions, roster, batteryRegistry }) {
  const rosterById = new Map(roster.map((rover) => [String(rover.id), rover]));
  const minuteGroups = new Map();
  minutes.forEach((minute) => {
    const roverId = String(minute.roverId);
    if (!minuteGroups.has(roverId)) minuteGroups.set(roverId, []);
    minuteGroups.get(roverId).push(minute);
  });

  return Array.from(new Set([...rosterById.keys(), ...minuteGroups.keys()])).map((roverId) => {
    const rows = minuteGroups.get(roverId) || [];
    const distanceMm = sum(rows, 'distanceMm');
    const dischargedWh = sum(rows, 'dischargedWh');
    const movingDischargedWh = sum(rows, 'movingDischargedWh');
    const movingMs = sum(rows, 'movingMs');
    const latest = rows[rows.length - 1] || null;
    const base = {
      roverId,
      name: rosterById.get(roverId)?.name || roverId,
      color: rosterById.get(roverId)?.color || null,
      online: Boolean(rosterById.get(roverId)),
      minutes: rows,
      sampleCount: sum(rows, 'sampleCount'),
      coverageMs: sum(rows, 'coverageMs'),
      gapCount: sum(rows, 'gapCount'),
      distanceMm,
      movingMs,
      averageSpeedMmPerSecond: movingMs ? distanceMm / (movingMs / 1000) : null,
      maximumSpeedMmPerSecond: maximum(rows, 'maximumSpeedMmPerSecond'),
      chargedMah: sum(rows, 'chargedMah'),
      dischargedMah: sum(rows, 'dischargedMah'),
      chargedWh: sum(rows, 'chargedWh'),
      dischargedWh,
      movingDischargedWh,
      stationaryDischargedWh: sum(rows, 'stationaryDischargedWh'),
      overallWhPerKm: distanceMm >= MINIMUM_EFFICIENCY_DISTANCE_MM
        ? dischargedWh / (distanceMm / 1e6)
        : null,
      movingWhPerKm: distanceMm >= MINIMUM_EFFICIENCY_DISTANCE_MM
        ? movingDischargedWh / (distanceMm / 1e6)
        : null,
      efficiencyDistanceRequiredMm: Math.max(0, MINIMUM_EFFICIENCY_DISTANCE_MM - distanceMm),
      averageVoltageMv: weightedAverage(rows, 'avgVoltageMv'),
      averageCurrentMa: weightedAverage(rows, 'avgCurrentMa'),
      minimumVoltageMv: minimum(rows, 'minVoltageMv'),
      maximumVoltageMv: maximum(rows, 'maxVoltageMv'),
      averageTemperatureC: weightedAverage(rows, 'avgTemperatureC'),
      minimumTemperatureC: minimum(rows, 'minTemperatureC'),
      maximumTemperatureC: maximum(rows, 'maxTemperatureC'),
      latestChargeMah: latest?.lastChargeMah ?? null,
      reportedCapacityMah: latest?.reportedCapacityMah ?? null,
      lastSampleAt: latest ? latest.bucketTs + 60000 : null,
    };
    const registryEntry = batteryRegistry.find((battery) =>
      String(battery.roverId) === roverId && battery.retiredAt == null,
    );
    base.batteryHealth = buildBatteryHealth({
      rover: base,
      sessions: sessions.filter((session) => String(session.roverId) === roverId),
      registryEntry,
    });
    delete base.minutes;
    return base;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function buildAttention(roverRows, now) {
  const attention = [];
  roverRows.forEach((rover) => {
    if (!rover.sampleCount) {
      attention.push({
        key: `telemetry:${rover.roverId}`,
        roverId: rover.roverId,
        severity: 'notice',
        title: rover.online ? 'Battery metrics unavailable in this range' : 'Rover was not observed in this range',
      });
    }
    if (rover.maximumTemperatureC >= 45) {
      attention.push({
        key: `temperature:${rover.roverId}`,
        roverId: rover.roverId,
        severity: rover.maximumTemperatureC >= 50 ? 'critical' : 'warning',
        title: `Battery reached ${rover.maximumTemperatureC} °C`,
      });
    }
    if (rover.batteryHealth.capacityRetentionPercent != null
      && rover.batteryHealth.confidence !== 'low'
      && rover.batteryHealth.capacityRetentionPercent < 80) {
      attention.push({
        key: `capacity:${rover.roverId}`,
        roverId: rover.roverId,
        severity: rover.batteryHealth.capacityRetentionPercent < 65 ? 'critical' : 'warning',
        title: `Estimated usable capacity is ${rover.batteryHealth.capacityRetentionPercent.toFixed(1)}% of baseline`,
      });
    }
    if (rover.online && rover.lastSampleAt && now - rover.lastSampleAt > 5 * 60 * 1000) {
      attention.push({
        key: `stale:${rover.roverId}`,
        roverId: rover.roverId,
        severity: 'warning',
        title: 'Battery metrics are stale',
      });
    }
  });
  const rank = { critical: 0, warning: 1, notice: 2 };
  return attention.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function createReportBuilder({ storage, collector, roverManager }) {
  function build({ since, until, roverIds, includeEvents = false, eventLimit = 500 }) {
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
    const batterySessions = storage.listBatterySessions({ since, until, roverIds: effectiveIds, limit: 2000 });
    const batteryRegistry = storage.listBatteries(effectiveIds);
    const roverRows = groupByRover({ minutes, sessions: batterySessions, roster, batteryRegistry });
    const attention = buildAttention(roverRows, Date.now());
    const distanceMm = sum(roverRows, 'distanceMm');
    const dischargedWh = sum(roverRows, 'dischargedWh');
    const movingDischargedWh = sum(roverRows, 'movingDischargedWh');

    return {
      generatedAt: Date.now(),
      range: { since, until },
      methodology: {
        minimumEfficiencyDistanceMm: MINIMUM_EFFICIENCY_DISTANCE_MM,
        historicalWhAvailable: false,
      },
      totals: {
        roverCount: roverRows.length,
        onlineRoverCount: roverRows.filter((rover) => rover.online).length,
        distanceMm,
        movingMs: sum(roverRows, 'movingMs'),
        chargedWh: sum(roverRows, 'chargedWh'),
        dischargedWh,
        movingDischargedWh,
        stationaryDischargedWh: sum(roverRows, 'stationaryDischargedWh'),
        overallWhPerKm: distanceMm >= MINIMUM_EFFICIENCY_DISTANCE_MM
          ? dischargedWh / (distanceMm / 1e6)
          : null,
        movingWhPerKm: distanceMm >= MINIMUM_EFFICIENCY_DISTANCE_MM
          ? movingDischargedWh / (distanceMm / 1e6)
          : null,
        attentionCount: attention.filter((item) => item.severity !== 'notice').length,
      },
      rovers: roverRows,
      attention,
      batteryRegistry,
      dailyReportHistory: storage.listDailyReports(365),
      // Events remain available only for explicit advanced/debug consumers.
      // Neither the normal UI nor Discord requests them.
      events: includeEvents
        ? storage.listEvents({ since, until, roverIds: effectiveIds, limit: eventLimit })
        : [],
      diagnostics: {
        collector: collector.getDiagnostics(),
        storage: storage.getDiagnostics(),
      },
    };
  }

  return { build };
}

module.exports = {
  MINIMUM_EFFICIENCY_DISTANCE_MM,
  createReportBuilder,
};
