// Fleet Report Storage
// Purpose: Owns the reporting database, schema, bounded writes, and read queries.
// Scope: Keeps SQLite details out of telemetry collection, analysis, UI transport, and Discord delivery.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { resolveDataPath } = require('../../helpers/dataPaths');

const DB_PATH = resolveDataPath('fleet-reports.sqlite');

function safeJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch (_err) {
    // An unusual circular payload must not break the event subscriber. The
    // placeholder still records that an event occurred and explains why its
    // supporting payload is unavailable.
    return JSON.stringify({ serializationError: true });
  }
}

function parseJson(value, fallback = null) {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch (_err) {
    return fallback;
  }
}

function createStorage({ logger }) {
  let db = null;
  let statements = null;

  function open() {
    if (db) return true;
    try {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      db = new Database(DB_PATH);
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('foreign_keys = ON');
      db.exec(`
        CREATE TABLE IF NOT EXISTS fleet_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          source TEXT NOT NULL,
          type TEXT NOT NULL,
          rover_id TEXT,
          visibility TEXT NOT NULL DEFAULT 'global',
          severity TEXT NOT NULL DEFAULT 'informational',
          correlation_id TEXT,
          payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_fleet_events_ts ON fleet_events(ts DESC);
        CREATE INDEX IF NOT EXISTS idx_fleet_events_rover_ts ON fleet_events(rover_id, ts DESC);
        CREATE INDEX IF NOT EXISTS idx_fleet_events_type_ts ON fleet_events(type, ts DESC);

        CREATE TABLE IF NOT EXISTS fleet_minute_samples (
          rover_id TEXT NOT NULL,
          bucket_ts INTEGER NOT NULL,
          sample_count INTEGER NOT NULL,
          coverage_ms INTEGER NOT NULL,
          gap_count INTEGER NOT NULL,
          charged_mah REAL NOT NULL,
          discharged_mah REAL NOT NULL,
          charged_wh REAL NOT NULL DEFAULT 0,
          discharged_wh REAL NOT NULL DEFAULT 0,
          moving_discharged_wh REAL NOT NULL DEFAULT 0,
          stationary_discharged_wh REAL NOT NULL DEFAULT 0,
          moving_ms INTEGER NOT NULL DEFAULT 0,
          maximum_speed_mm_per_second REAL,
          min_voltage_mv INTEGER,
          max_voltage_mv INTEGER,
          avg_voltage_mv REAL,
          min_current_ma INTEGER,
          max_current_ma INTEGER,
          avg_current_ma REAL,
          min_temperature_c INTEGER,
          max_temperature_c INTEGER,
          avg_temperature_c REAL,
          min_charge_mah INTEGER,
          max_charge_mah INTEGER,
          last_charge_mah INTEGER,
          reported_capacity_mah INTEGER,
          docked_samples INTEGER NOT NULL,
          charging_samples INTEGER NOT NULL,
          command_count INTEGER NOT NULL DEFAULT 0,
          drive_command_count INTEGER NOT NULL DEFAULT 0,
          rejected_command_count INTEGER NOT NULL DEFAULT 0,
          distance_mm REAL NOT NULL DEFAULT 0,
          bump_count INTEGER NOT NULL DEFAULT 0,
          cliff_count INTEGER NOT NULL DEFAULT 0,
          wheel_drop_count INTEGER NOT NULL DEFAULT 0,
          virtual_wall_count INTEGER NOT NULL DEFAULT 0,
          overcurrent_episode_count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (rover_id, bucket_ts)
        );
        CREATE INDEX IF NOT EXISTS idx_fleet_minutes_ts ON fleet_minute_samples(bucket_ts DESC);

        CREATE TABLE IF NOT EXISTS fleet_battery_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rover_id TEXT NOT NULL,
          battery_key TEXT NOT NULL,
          kind TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          start_charge_mah INTEGER,
          end_charge_mah INTEGER,
          charged_mah REAL NOT NULL DEFAULT 0,
          discharged_mah REAL NOT NULL DEFAULT 0,
          min_voltage_mv INTEGER,
          max_voltage_mv INTEGER,
          min_temperature_c INTEGER,
          max_temperature_c INTEGER,
          sample_count INTEGER NOT NULL DEFAULT 0,
          gap_count INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'open',
          confidence TEXT NOT NULL DEFAULT 'low',
          qualification_reason TEXT,
          details_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_battery_sessions_rover_time ON fleet_battery_sessions(rover_id, started_at DESC);

        CREATE TABLE IF NOT EXISTS fleet_batteries (
          battery_key TEXT PRIMARY KEY,
          rover_id TEXT NOT NULL,
          chemistry TEXT,
          rated_capacity_mah INTEGER,
          installed_at INTEGER,
          retired_at INTEGER,
          healthy_baseline_mah REAL,
          notes TEXT,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_fleet_batteries_rover ON fleet_batteries(rover_id, installed_at DESC);

        CREATE TABLE IF NOT EXISTS fleet_daily_reports (
          report_date TEXT PRIMARY KEY,
          generated_at INTEGER NOT NULL,
          report_json TEXT NOT NULL,
          discord_delivered_at INTEGER,
          discord_error TEXT
        );
      `);

      // SQLite's CREATE TABLE IF NOT EXISTS does not add columns to an older
      // reporting database. These narrow additive migrations keep development
      // databases usable as collection coverage expands without coupling this
      // optional feature to the identity database's migration history.
      const minuteColumns = new Set(db.prepare('PRAGMA table_info(fleet_minute_samples)').all().map((column) => column.name));
      [
        ['command_count', 'INTEGER NOT NULL DEFAULT 0'],
        ['drive_command_count', 'INTEGER NOT NULL DEFAULT 0'],
        ['rejected_command_count', 'INTEGER NOT NULL DEFAULT 0'],
        ['distance_mm', 'REAL NOT NULL DEFAULT 0'],
        ['bump_count', 'INTEGER NOT NULL DEFAULT 0'],
        ['cliff_count', 'INTEGER NOT NULL DEFAULT 0'],
        ['wheel_drop_count', 'INTEGER NOT NULL DEFAULT 0'],
        ['virtual_wall_count', 'INTEGER NOT NULL DEFAULT 0'],
        ['overcurrent_episode_count', 'INTEGER NOT NULL DEFAULT 0'],
        ['charged_wh', 'REAL NOT NULL DEFAULT 0'],
        ['discharged_wh', 'REAL NOT NULL DEFAULT 0'],
        ['moving_discharged_wh', 'REAL NOT NULL DEFAULT 0'],
        ['stationary_discharged_wh', 'REAL NOT NULL DEFAULT 0'],
        ['moving_ms', 'INTEGER NOT NULL DEFAULT 0'],
        ['maximum_speed_mm_per_second', 'REAL'],
      ].forEach(([name, definition]) => {
        if (!minuteColumns.has(name)) db.exec(`ALTER TABLE fleet_minute_samples ADD COLUMN ${name} ${definition}`);
      });

      statements = {
        insertEvent: db.prepare(`
          INSERT INTO fleet_events (ts, source, type, rover_id, visibility, severity, correlation_id, payload_json)
          VALUES (@ts, @source, @type, @roverId, @visibility, @severity, @correlationId, @payloadJson)
        `),
        upsertMinute: db.prepare(`
          INSERT INTO fleet_minute_samples (
            rover_id, bucket_ts, sample_count, coverage_ms, gap_count,
            charged_mah, discharged_mah, min_voltage_mv, max_voltage_mv, avg_voltage_mv,
            charged_wh, discharged_wh, moving_discharged_wh,
            stationary_discharged_wh, moving_ms, maximum_speed_mm_per_second,
            min_current_ma, max_current_ma, avg_current_ma, min_temperature_c,
            max_temperature_c, avg_temperature_c, min_charge_mah, max_charge_mah,
            last_charge_mah, reported_capacity_mah, docked_samples, charging_samples,
            command_count, drive_command_count, rejected_command_count,
            distance_mm, bump_count, cliff_count, wheel_drop_count,
            virtual_wall_count, overcurrent_episode_count
          ) VALUES (
            @roverId, @bucketTs, @sampleCount, @coverageMs, @gapCount,
            @chargedMah, @dischargedMah, @minVoltageMv, @maxVoltageMv, @avgVoltageMv,
            @chargedWh, @dischargedWh, @movingDischargedWh,
            @stationaryDischargedWh, @movingMs, @maximumSpeedMmPerSecond,
            @minCurrentMa, @maxCurrentMa, @avgCurrentMa, @minTemperatureC,
            @maxTemperatureC, @avgTemperatureC, @minChargeMah, @maxChargeMah,
            @lastChargeMah, @reportedCapacityMah, @dockedSamples, @chargingSamples,
            @commandCount, @driveCommandCount, @rejectedCommandCount,
            @distanceMm, @bumpCount, @cliffCount, @wheelDropCount,
            @virtualWallCount, @overcurrentEpisodeCount
          )
          ON CONFLICT(rover_id, bucket_ts) DO UPDATE SET
            sample_count = excluded.sample_count,
            coverage_ms = excluded.coverage_ms,
            gap_count = excluded.gap_count,
            charged_mah = excluded.charged_mah,
            discharged_mah = excluded.discharged_mah,
            charged_wh = excluded.charged_wh,
            discharged_wh = excluded.discharged_wh,
            moving_discharged_wh = excluded.moving_discharged_wh,
            stationary_discharged_wh = excluded.stationary_discharged_wh,
            moving_ms = excluded.moving_ms,
            maximum_speed_mm_per_second = excluded.maximum_speed_mm_per_second,
            min_voltage_mv = excluded.min_voltage_mv,
            max_voltage_mv = excluded.max_voltage_mv,
            avg_voltage_mv = excluded.avg_voltage_mv,
            min_current_ma = excluded.min_current_ma,
            max_current_ma = excluded.max_current_ma,
            avg_current_ma = excluded.avg_current_ma,
            min_temperature_c = excluded.min_temperature_c,
            max_temperature_c = excluded.max_temperature_c,
            avg_temperature_c = excluded.avg_temperature_c,
            min_charge_mah = excluded.min_charge_mah,
            max_charge_mah = excluded.max_charge_mah,
            last_charge_mah = excluded.last_charge_mah,
            reported_capacity_mah = excluded.reported_capacity_mah,
            docked_samples = excluded.docked_samples,
            charging_samples = excluded.charging_samples,
            command_count = excluded.command_count,
            drive_command_count = excluded.drive_command_count,
            rejected_command_count = excluded.rejected_command_count
            ,distance_mm = excluded.distance_mm
            ,bump_count = excluded.bump_count
            ,cliff_count = excluded.cliff_count
            ,wheel_drop_count = excluded.wheel_drop_count
            ,virtual_wall_count = excluded.virtual_wall_count
            ,overcurrent_episode_count = excluded.overcurrent_episode_count
        `),
        insertSession: db.prepare(`
          INSERT INTO fleet_battery_sessions (
            rover_id, battery_key, kind, started_at, ended_at, start_charge_mah,
            end_charge_mah, charged_mah, discharged_mah, min_voltage_mv,
            max_voltage_mv, min_temperature_c, max_temperature_c, sample_count,
            gap_count, status, confidence, qualification_reason, details_json
          ) VALUES (
            @roverId, @batteryKey, @kind, @startedAt, @endedAt, @startChargeMah,
            @endChargeMah, @chargedMah, @dischargedMah, @minVoltageMv,
            @maxVoltageMv, @minTemperatureC, @maxTemperatureC, @sampleCount,
            @gapCount, @status, @confidence, @qualificationReason, @detailsJson
          )
        `),
      };
      return true;
    } catch (err) {
      logger.error('Failed to open fleet report database; reporting will remain fail-open', {
        path: DB_PATH,
        error: err.message,
      });
      if (db) {
        try { db.close(); } catch (_closeErr) { /* Best-effort cleanup after failed initialization. */ }
      }
      db = null;
      statements = null;
      return false;
    }
  }

  function runSafely(label, operation, fallback = null) {
    if (!open()) return fallback;
    try {
      return operation();
    } catch (err) {
      // Reporting is observer-only. A failed write/query is visible in logs but
      // is never allowed to propagate into a rover sensor or command callback.
      logger.warn(`Fleet report storage ${label} failed`, { error: err.message });
      return fallback;
    }
  }

  function insertEvent(event) {
    return runSafely('event write', () => statements.insertEvent.run({
      ts: event.ts,
      source: event.source,
      type: event.type,
      roverId: event.roverId || null,
      visibility: event.visibility || 'global',
      severity: event.severity || 'informational',
      correlationId: event.correlationId || null,
      payloadJson: safeJson(event.payload),
    }));
  }

  function upsertMinute(sample) {
    return runSafely('minute write', () => statements.upsertMinute.run(sample));
  }

  function insertBatterySession(session) {
    return runSafely('battery session write', () => statements.insertSession.run({
      ...session,
      detailsJson: safeJson(session.details || {}),
    }));
  }

  function listEvents({ since, until, roverIds, limit = 500, offset = 0, type = null }) {
    return runSafely('event query', () => {
      const clauses = ['ts >= ?', 'ts < ?'];
      const params = [since, until];
      if (type) {
        clauses.push('type = ?');
        params.push(type);
      }
      if (Array.isArray(roverIds)) {
        if (roverIds.length === 0) clauses.push('rover_id IS NULL');
        else {
          clauses.push(`(rover_id IS NULL OR rover_id IN (${roverIds.map(() => '?').join(',')}))`);
          params.push(...roverIds);
        }
      }
      params.push(Math.max(1, Math.min(2000, Number(limit) || 500)), Math.max(0, Number(offset) || 0));
      const rows = db.prepare(`
        SELECT id, ts, source, type, rover_id AS roverId, visibility, severity,
               correlation_id AS correlationId, payload_json AS payloadJson
        FROM fleet_events
        WHERE ${clauses.join(' AND ')}
        ORDER BY ts DESC
        LIMIT ? OFFSET ?
      `).all(...params);
      return rows.map(({ payloadJson, ...row }) => ({ ...row, payload: parseJson(payloadJson, {}) }));
    }, []);
  }

  function listMinutes({ since, until, roverIds }) {
    return runSafely('minute query', () => {
      const clauses = ['bucket_ts >= ?', 'bucket_ts < ?'];
      const params = [since, until];
      if (Array.isArray(roverIds)) {
        if (roverIds.length === 0) return [];
        clauses.push(`rover_id IN (${roverIds.map(() => '?').join(',')})`);
        params.push(...roverIds);
      }
      return db.prepare(`
        SELECT rover_id AS roverId, bucket_ts AS bucketTs, sample_count AS sampleCount,
               coverage_ms AS coverageMs, gap_count AS gapCount, charged_mah AS chargedMah,
               discharged_mah AS dischargedMah, min_voltage_mv AS minVoltageMv,
               charged_wh AS chargedWh, discharged_wh AS dischargedWh,
               moving_discharged_wh AS movingDischargedWh,
               stationary_discharged_wh AS stationaryDischargedWh,
               moving_ms AS movingMs,
               maximum_speed_mm_per_second AS maximumSpeedMmPerSecond,
               max_voltage_mv AS maxVoltageMv, avg_voltage_mv AS avgVoltageMv,
               min_current_ma AS minCurrentMa, max_current_ma AS maxCurrentMa,
               avg_current_ma AS avgCurrentMa, min_temperature_c AS minTemperatureC,
               max_temperature_c AS maxTemperatureC, avg_temperature_c AS avgTemperatureC,
               min_charge_mah AS minChargeMah, max_charge_mah AS maxChargeMah,
               last_charge_mah AS lastChargeMah, reported_capacity_mah AS reportedCapacityMah,
               docked_samples AS dockedSamples, charging_samples AS chargingSamples,
               command_count AS commandCount, drive_command_count AS driveCommandCount,
               rejected_command_count AS rejectedCommandCount
               ,distance_mm AS distanceMm, bump_count AS bumpCount,
               cliff_count AS cliffCount, wheel_drop_count AS wheelDropCount,
               virtual_wall_count AS virtualWallCount,
               overcurrent_episode_count AS overcurrentEpisodeCount
        FROM fleet_minute_samples
        WHERE ${clauses.join(' AND ')}
        ORDER BY bucket_ts ASC, rover_id ASC
      `).all(...params);
    }, []);
  }

  function listBatterySessions({ since, until, roverIds, limit = 500 }) {
    return runSafely('battery session query', () => {
      if (Array.isArray(roverIds) && roverIds.length === 0) return [];
      const roverClause = Array.isArray(roverIds)
        ? `AND rover_id IN (${roverIds.map(() => '?').join(',')})`
        : '';
      const params = [since, until, ...(roverIds || []), Math.max(1, Math.min(2000, Number(limit) || 500))];
      return db.prepare(`
        SELECT id, rover_id AS roverId, battery_key AS batteryKey, kind,
               started_at AS startedAt, ended_at AS endedAt,
               start_charge_mah AS startChargeMah, end_charge_mah AS endChargeMah,
               charged_mah AS chargedMah, discharged_mah AS dischargedMah,
               min_voltage_mv AS minVoltageMv, max_voltage_mv AS maxVoltageMv,
               min_temperature_c AS minTemperatureC, max_temperature_c AS maxTemperatureC,
               sample_count AS sampleCount, gap_count AS gapCount, status,
               confidence, qualification_reason AS qualificationReason,
               details_json AS detailsJson
        FROM fleet_battery_sessions
        WHERE started_at < ? AND COALESCE(ended_at, started_at) >= ? ${roverClause}
        ORDER BY started_at DESC
        LIMIT ?
      `).all(until, since, ...(roverIds || []), params[params.length - 1]).map(({ detailsJson, ...row }) => ({
        ...row,
        details: parseJson(detailsJson, {}),
      }));
    }, []);
  }

  function prune({ detailedBefore, minuteBefore }) {
    return runSafely('retention prune', () => db.transaction(() => {
      const events = db.prepare('DELETE FROM fleet_events WHERE ts < ?').run(detailedBefore).changes;
      const minutes = db.prepare('DELETE FROM fleet_minute_samples WHERE bucket_ts < ?').run(minuteBefore).changes;
      return { events, minutes };
    })());
  }

  function getDailyReport(reportDate) {
    return runSafely('daily report query', () => {
      const row = db.prepare(`
        SELECT report_date AS reportDate, generated_at AS generatedAt,
               report_json AS reportJson, discord_delivered_at AS discordDeliveredAt,
               discord_error AS discordError
        FROM fleet_daily_reports WHERE report_date = ?
      `).get(reportDate);
      if (!row) return null;
      const { reportJson, ...metadata } = row;
      return { ...metadata, report: parseJson(reportJson, null) };
    });
  }

  function listBatteries(roverIds = null) {
    return runSafely('battery registry query', () => {
      if (Array.isArray(roverIds) && roverIds.length === 0) return [];
      const clause = Array.isArray(roverIds)
        ? `WHERE rover_id IN (${roverIds.map(() => '?').join(',')})`
        : '';
      return db.prepare(`
        SELECT battery_key AS batteryKey, rover_id AS roverId, chemistry,
               rated_capacity_mah AS ratedCapacityMah, installed_at AS installedAt,
               retired_at AS retiredAt, healthy_baseline_mah AS healthyBaselineMah,
               notes, updated_at AS updatedAt
        FROM fleet_batteries ${clause}
        ORDER BY rover_id ASC, installed_at DESC
      `).all(...(roverIds || []));
    }, []);
  }

  function getActiveBattery(roverId) {
    return runSafely('active battery query', () => db.prepare(`
      SELECT battery_key AS batteryKey, rover_id AS roverId, chemistry,
             rated_capacity_mah AS ratedCapacityMah, installed_at AS installedAt,
             healthy_baseline_mah AS healthyBaselineMah, notes, updated_at AS updatedAt
      FROM fleet_batteries
      WHERE rover_id = ? AND retired_at IS NULL
      ORDER BY installed_at DESC
      LIMIT 1
    `).get(String(roverId)) || null);
  }

  function replaceBattery(entry) {
    return runSafely('battery replacement write', () => db.transaction(() => {
      const now = Date.now();
      db.prepare('UPDATE fleet_batteries SET retired_at = ?, updated_at = ? WHERE rover_id = ? AND retired_at IS NULL')
        .run(entry.installedAt || now, now, entry.roverId);
      db.prepare(`
        INSERT INTO fleet_batteries (
          battery_key, rover_id, chemistry, rated_capacity_mah, installed_at,
          retired_at, healthy_baseline_mah, notes, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
      `).run(
        entry.batteryKey,
        entry.roverId,
        entry.chemistry || null,
        entry.ratedCapacityMah || null,
        entry.installedAt || now,
        entry.healthyBaselineMah || null,
        entry.notes || null,
        now,
      );
      return getActiveBattery(entry.roverId);
    })());
  }

  function saveDailyReport(reportDate, report) {
    return runSafely('daily report write', () => db.prepare(`
      INSERT INTO fleet_daily_reports (report_date, generated_at, report_json)
      VALUES (?, ?, ?)
      ON CONFLICT(report_date) DO UPDATE SET
        generated_at = excluded.generated_at,
        report_json = excluded.report_json
    `).run(reportDate, Date.now(), safeJson(report)));
  }

  function listDailyReports(limit = 90) {
    return runSafely('daily report history query', () => db.prepare(`
      SELECT report_date AS reportDate, generated_at AS generatedAt,
             discord_delivered_at AS discordDeliveredAt, discord_error AS discordError,
             length(report_json) AS reportBytes
      FROM fleet_daily_reports
      ORDER BY report_date DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(1000, Number(limit) || 90))), []);
  }

  function markDailyReportDelivery(reportDate, { deliveredAt = null, error = null } = {}) {
    return runSafely('daily delivery update', () => db.prepare(`
      UPDATE fleet_daily_reports
      SET discord_delivered_at = ?, discord_error = ?
      WHERE report_date = ?
    `).run(deliveredAt, error, reportDate));
  }

  function getDiagnostics() {
    return runSafely('diagnostics query', () => ({
      available: true,
      path: DB_PATH,
      bytes: fs.statSync(DB_PATH).size,
      eventCount: db.prepare('SELECT COUNT(*) AS count FROM fleet_events').get().count,
      minuteCount: db.prepare('SELECT COUNT(*) AS count FROM fleet_minute_samples').get().count,
      sessionCount: db.prepare('SELECT COUNT(*) AS count FROM fleet_battery_sessions').get().count,
    }), { available: false, path: DB_PATH });
  }

  return {
    open,
    insertEvent,
    upsertMinute,
    insertBatterySession,
    listEvents,
    listMinutes,
    listBatterySessions,
    prune,
    getDailyReport,
    saveDailyReport,
    listDailyReports,
    markDailyReportDelivery,
    listBatteries,
    getActiveBattery,
    replaceBattery,
    getDiagnostics,
  };
}

module.exports = {
  createStorage,
};
