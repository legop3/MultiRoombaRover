// llm Commentary Service snapshot engine
// Purpose: Tracks rover activity/history and builds model snapshot payloads from live rover/chat state.
// Scope: Keeps runtime behavior unchanged while isolating sensor aggregation and snapshot assembly logic.
function createSnapshotEngine(deps) {
  const {
    io,
    roverManager,
    getActiveDrivers,
    getNickname,
    getRecentMessages,
    MAX_ROVERS,
    MAX_CHAT_MESSAGES,
    ACTIVITY_WINDOW_MS,
    ACTIVITY_BUCKET_MS,
    ACTIVITY_SCORE_WINDOW_MS,
    SELF_TALK_WINDOW_MS,
    MAX_CONTEXT_EVENTS,
    MAX_ROVER_EVENTS,
    getContextResetAt,
    getSkipStreak,
  } = deps;

  const roverActivity = new Map();
  const roverMajorEvents = [];
  const lastSensorFlagsByRover = new Map();
  const lastRoverStateById = new Map();

  function pushRoverMajorEvent(event) {
    roverMajorEvents.push(event);
    if (roverMajorEvents.length > MAX_ROVER_EVENTS) {
      roverMajorEvents.shift();
    }
  }

  function pruneActivityBuckets(state, nowMs) {
    if (!state?.buckets) return;
    const minTs = nowMs - ACTIVITY_WINDOW_MS;
    state.buckets.forEach((_, bucketTs) => {
      if (bucketTs < minTs) {
        state.buckets.delete(bucketTs);
      }
    });
  }

  function upsertActivityState(roverId) {
    if (!roverActivity.has(roverId)) {
      roverActivity.set(roverId, {
        buckets: new Map(),
        bumpLeftActive: false,
        bumpRightActive: false,
      });
    }
    return roverActivity.get(roverId);
  }

  function isChargingFromSensors(sensors = {}) {
    const label = String(sensors?.chargingState?.label || '').toLowerCase();
    if (label === 'waiting' || label === 'full charging' || label === 'trickle charging') {
      return true;
    }
    const code = sensors?.chargingState?.code;
    return code === 2 || code === 3 || code === 4;
  }

  function resolveDriverNickname(socketId) {
    if (!socketId) return null;
    const socket = io.sockets.sockets.get(socketId);
    return getNickname(socket) || socket?.data?.user?.username || socketId.slice(0, 6);
  }

  function onSensorEvent({ roverId, sensors, batteryState } = {}) {
    if (!roverId || !sensors) return;
    if (!roverManager.canReplayRoverId(roverId)) return;
    const nowMs = Date.now();
    const dockedNow = Boolean(sensors?.chargingSources?.homeBase);
    const bucketTs = Math.floor(nowMs / ACTIVITY_BUCKET_MS) * ACTIVITY_BUCKET_MS;
    const state = upsertActivityState(String(roverId));
    pruneActivityBuckets(state, nowMs);
    if (!state.buckets.has(bucketTs)) {
      state.buckets.set(bucketTs, { distanceMm: 0, turnDeg: 0, bumps: 0 });
    }
    const bucket = state.buckets.get(bucketTs);
    bucket.distanceMm += Math.abs(Number(sensors.distanceMm) || 0);
    bucket.turnDeg += Math.abs(Number(sensors.angleDeg) || 0);
    const bumpLeftNow = Boolean(sensors?.bumpsAndWheelDrops?.bumpLeft);
    const bumpRightNow = Boolean(sensors?.bumpsAndWheelDrops?.bumpRight);
    if (!dockedNow) {
      if (bumpLeftNow && !state.bumpLeftActive) bucket.bumps += 0.5;
      if (bumpRightNow && !state.bumpRightActive) bucket.bumps += 0.5;
    }
    state.bumpLeftActive = bumpLeftNow;
    state.bumpRightActive = bumpRightNow;

    const roverKey = String(roverId);
    const activeDrivers = getActiveDrivers();
    const driverSocketId = activeDrivers[roverKey] || null;
    const driverNickname = driverSocketId ? resolveDriverNickname(driverSocketId) : null;
    const docked = dockedNow;
    const charging = isChargingFromSensors(sensors);
    const wheelsOffGround = Boolean(
      sensors?.bumpsAndWheelDrops?.wheelDropLeft && sensors?.bumpsAndWheelDrops?.wheelDropRight,
    );
    const batteryLow = Boolean(batteryState?.warnActive || batteryState?.urgentActive);
    const prevFlags = lastSensorFlagsByRover.get(roverKey) || null;
    const nextFlags = {
      docked,
      charging,
      battery_low: batteryLow,
      wheels_off_ground: wheelsOffGround,
    };
    if (prevFlags) {
      if (prevFlags.docked !== nextFlags.docked) {
        pushRoverMajorEvent({
          ts: nowMs,
          type: 'event',
          event_type: nextFlags.docked ? 'rover_docked' : 'rover_undocked',
          rover_id: roverKey,
          driver_nickname: driverNickname,
          summary: nextFlags.docked ? 'transitioned to docked' : 'transitioned to undocked',
        });
      }
      if (prevFlags.battery_low !== nextFlags.battery_low) {
        pushRoverMajorEvent({
          ts: nowMs,
          type: 'event',
          event_type: 'battery_low_changed',
          rover_id: roverKey,
          driver_nickname: driverNickname,
          summary: nextFlags.battery_low ? 'battery_low became true' : 'battery_low became false',
        });
      }
    }
    lastSensorFlagsByRover.set(roverKey, nextFlags);
  }

  function getActivityWindow(roverId, windowMs, offsetMs = 0, nowMs = Date.now()) {
    const state = roverActivity.get(String(roverId));
    if (!state) return { distance_m: 0, turn_deg: 0, bumps: 0 };
    pruneActivityBuckets(state, nowMs);
    const windowStart = nowMs - offsetMs - windowMs;
    const windowEnd = nowMs - offsetMs;
    let distanceMm = 0;
    let turnDeg = 0;
    let bumps = 0;
    state.buckets.forEach((bucket, bucketTs) => {
      if (bucketTs < windowStart || bucketTs > windowEnd) return;
      distanceMm += bucket.distanceMm;
      turnDeg += bucket.turnDeg;
      bumps += bucket.bumps;
    });
    return {
      distance_m: Math.round((distanceMm / 1000) * 10) / 10,
      turn_deg: Math.round(turnDeg),
      bumps: Math.round(bumps * 10) / 10,
    };
  }

  function getActivity30s(roverId, nowMs = Date.now()) {
    return getActivityWindow(roverId, ACTIVITY_SCORE_WINDOW_MS, 0, nowMs);
  }

  function computeBaseActivityScore(activity = {}) {
    const distanceScore = Math.min(45, Math.max(0, Number(activity.distance_m) || 0) * 25);
    const turnScore = Math.min(30, Math.max(0, Number(activity.turn_deg) || 0) / 12);
    const bumpScore = Math.min(25, Math.max(0, Number(activity.bumps) || 0) * 12);
    return Math.round(Math.min(100, distanceScore + turnScore + bumpScore));
  }

  function computeActivityBand(score) {
    if (score >= 75) return 'intense';
    if (score >= 50) return 'high';
    if (score >= 25) return 'medium';
    if (score >= 8) return 'low';
    return 'idle';
  }

  function computeActivityTrend(currentBaseScore, previousBaseScore) {
    const delta = Number(currentBaseScore || 0) - Number(previousBaseScore || 0);
    if (delta >= 12) return 'rising';
    if (delta <= -12) return 'falling';
    return 'steady';
  }

  function detectMessageTopic(text = '') {
    const value = String(text).toLowerCase();
    if (!value.trim()) return 'none';
    if (/\b(bump|hit|bonk|crash|slam|collision)\b/.test(value)) return 'bumps';
    if (/\b(wheel.?drop|wheels?.*off.?ground|picked up|lifted)\b/.test(value)) return 'wheels_off_ground';
    if (/\b(dock|docked|undock|charger|charging)\b/.test(value)) return 'dock_charge';
    if (/\b(battery|low power|power)\b/.test(value)) return 'battery';
    if (/\b(chat|everyone|people|crowd)\b/.test(value)) return 'chat';
    if (/\b(move|driv|turn|spin|rolling)\b/.test(value)) return 'movement';
    return 'general';
  }

  function buildLastMessageFocus(lastBotMessage, rovers = []) {
    if (!lastBotMessage) return null;
    const text = String(lastBotMessage.text || '');
    const textLower = text.toLowerCase();
    let roverId = null;
    for (const rover of rovers) {
      const id = String(rover?.id || '').toLowerCase();
      const name = String(rover?.name || '').toLowerCase();
      if ((id && textLower.includes(id)) || (name && textLower.includes(name))) {
        roverId = rover.id;
        break;
      }
    }
    return {
      rover_id: roverId,
      topic: detectMessageTopic(text),
    };
  }

  function compactRoverForContext(rover) {
    if (!rover) return null;
    return {
      id: rover.id,
      status_tag: rover.status_tag,
      battery_low: rover.battery_low,
      docked: rover.docked,
      charging: rover.charging,
      wheels_off_ground: rover.wheels_off_ground,
      contact_state: rover.contact_state || 'clear',
      hazard_state: rover.hazard_state || 'normal',
      mobility_state: rover.mobility_state || 'normal',
      activity_score: rover.activity_score ?? 0,
      activity_band: rover.activity_band || 'idle',
      activity_trend: rover.activity_trend || 'steady',
    };
  }

  function deriveContactState(sensors = {}, activity30s = {}, docked = false) {
    if (docked) return 'clear';
    const bumps = Number(activity30s?.bumps) || 0;
    const hasBump = bumps >= 0.5 || sensors?.bumpsAndWheelDrops?.bumpLeft || sensors?.bumpsAndWheelDrops?.bumpRight;
    if (hasBump) return 'bumps_recent';
    const light = sensors?.lightBumper || {};
    const wallBrush =
      Boolean(sensors?.wall) ||
      Boolean(light.left || light.frontLeft || light.centerLeft || light.centerRight || light.frontRight || light.right);
    if (wallBrush) return 'wall_brush';
    return 'clear';
  }

  function deriveHazardState(sensors = {}, docked = false) {
    if (docked) return 'normal';
    if (Boolean(sensors?.virtualWall)) return 'virtual_wall_seen';
    if (
      Boolean(sensors?.cliffLeft) ||
      Boolean(sensors?.cliffFrontLeft) ||
      Boolean(sensors?.cliffFrontRight) ||
      Boolean(sensors?.cliffRight)
    ) {
      return 'cliff_alert';
    }
    return 'normal';
  }

  function deriveMobilityState(sensors = {}, wheelsOffGround = false) {
    if (wheelsOffGround) return 'wheels_off_ground';
    return 'normal';
  }

  function buildRoversNow(nowMs = Date.now()) {
    const activeDrivers = getActiveDrivers();
    const roster = roverManager
      .getRoster()
      .filter((entry) => roverManager.canReplayRoverId(entry.id))
      .slice(0, MAX_ROVERS);
    const nextRoverStateById = new Map();
    const rovers = roster.map((entry) => {
      const roverId = String(entry.id);
      const record = roverManager.rovers.get(roverId);
      const sensors = record?.lastSensor?.decoded || {};
      const batteryState = entry.batteryState || null;
      const driverSocketId = activeDrivers[roverId] || null;
      const wheelsOffGround = Boolean(
        sensors?.bumpsAndWheelDrops?.wheelDropLeft && sensors?.bumpsAndWheelDrops?.wheelDropRight,
      );
      const activity30s = getActivity30s(roverId, nowMs);
      const previousActivity30s = getActivityWindow(
        roverId,
        ACTIVITY_SCORE_WINDOW_MS,
        ACTIVITY_SCORE_WINDOW_MS,
        nowMs,
      );
      const charging = isChargingFromSensors(sensors);
      const docked = Boolean(sensors?.chargingSources?.homeBase);
      const isMoving = activity30s.distance_m > 0.1 || activity30s.turn_deg > 20;
      let statusTag = 'idle';
      if (charging) statusTag = 'charging';
      else if (docked) statusTag = 'docked';
      else if (driverSocketId && isMoving) statusTag = 'driving';
      else if (driverSocketId) statusTag = 'active-idle';
      const rover = {
        id: roverId,
        name: entry.name || roverId,
        driver_nickname: driverSocketId ? resolveDriverNickname(driverSocketId) : null,
        docked,
        charging,
        wheels_off_ground: wheelsOffGround,
        battery_low: Boolean(batteryState?.warnActive || batteryState?.urgentActive),
        activity_30s: activity30s,
        status_tag: statusTag,
        contact_state: deriveContactState(sensors, activity30s, docked),
        hazard_state: deriveHazardState(sensors, docked),
        mobility_state: deriveMobilityState(sensors, wheelsOffGround),
      };
      const currentBaseScore = computeBaseActivityScore(activity30s);
      const previousBaseScore = computeBaseActivityScore(previousActivity30s);
      let activityScore = currentBaseScore;
      if (rover.contact_state === 'wall_brush') activityScore += 6;
      if (rover.contact_state === 'bumps_recent') activityScore += 12;
      if (rover.hazard_state !== 'normal') activityScore += 8;
      if (rover.status_tag === 'driving') activityScore += 8;
      if (rover.status_tag === 'active-idle') activityScore += 4;
      if (rover.charging || rover.docked) activityScore -= 25;
      if (rover.wheels_off_ground) activityScore -= 20;
      activityScore = Math.max(0, Math.min(100, Math.round(activityScore)));
      rover.activity_score = activityScore;
      rover.activity_band = computeActivityBand(activityScore);
      rover.activity_trend = computeActivityTrend(currentBaseScore, previousBaseScore);
      const prev = lastRoverStateById.get(roverId) || null;
      const nextState = {
        driver_nickname: rover.driver_nickname,
        docked: rover.docked,
        charging: rover.charging,
        wheels_off_ground: rover.wheels_off_ground,
        battery_low: rover.battery_low,
        activity_30s: rover.activity_30s,
        status_tag: rover.status_tag,
        activity_score: rover.activity_score,
        activity_band: rover.activity_band,
        activity_trend: rover.activity_trend,
      };
      nextRoverStateById.set(roverId, nextState);
      rover.prev_state = prev;
      return rover;
    });
    lastRoverStateById.clear();
    nextRoverStateById.forEach((value, roverId) => {
      lastRoverStateById.set(roverId, value);
    });
    return { rovers };
  }

  function collectActiveDriverEntries() {
    const fromTurns = Object.entries(getActiveDrivers()).filter(([, socketId]) => Boolean(socketId));
    if (fromTurns.length > 0) return fromTurns;
    const fallback = [];
    roverManager.rovers.forEach((record, roverId) => {
      const socketId = record?.drivers?.values?.().next?.().value || null;
      if (socketId) fallback.push([String(roverId), socketId]);
    });
    return fallback;
  }

  function buildSnapshot() {
    const now = new Date();
    const nowMs = now.getTime();
    const driverEntries = collectActiveDriverEntries();
    const { rovers } = buildRoversNow(nowMs);
    const roverById = new Map(rovers.map((rover) => [String(rover.id), rover]));
    const contextResetAt = getContextResetAt();
    const allRecentMessages = getRecentMessages(300, { includeSystem: true })
      .filter((entry) => Number(entry?.ts) >= contextResetAt)
      .filter((entry) => {
        const roverId = entry?.roverId ? String(entry.roverId) : null;
        if (!roverId) return true;
        return roverManager.canReplayRoverId(roverId);
      });
    const chatRecent = allRecentMessages
      .filter((entry) => !entry?.bot)
      .slice(-MAX_CHAT_MESSAGES)
      .map((entry) => ({
        nickname: entry.nickname || entry.socketId?.slice(0, 6) || 'unknown',
        text: entry.text || '',
      }));

    const botRecentWindow = allRecentMessages
      .filter((entry) => Number(entry?.ts) >= contextResetAt)
      .filter((entry) => entry?.bot);
    const lastBotMessage = botRecentWindow.length ? botRecentWindow[botRecentWindow.length - 1] : null;
    const botRecent30m = botRecentWindow.filter(
      (entry) => nowMs - Number(entry?.ts || 0) <= SELF_TALK_WINDOW_MS,
    );

    const roverEvents = roverMajorEvents.filter(
      (entry) =>
        Number(entry?.ts) >= contextResetAt &&
        roverManager.canReplayRoverId(entry?.rover_id || ''),
    );
    const timelineEntries = [
      ...allRecentMessages.map((entry) => ({ ts: Number(entry?.ts || 0), source: 'chat', entry })),
      ...roverEvents.map((entry) => ({ ts: Number(entry?.ts || 0), source: 'event', entry })),
    ]
      .sort((a, b) => a.ts - b.ts)
      .slice(-MAX_CONTEXT_EVENTS);

    const eventStream = timelineEntries.map(({ source, entry }) => {
      if (source === 'event') {
        return {
          type: 'event',
          event_type: entry.event_type || 'rover_event',
          rover_id: entry.rover_id || null,
          driver_nickname: entry.driver_nickname || null,
          summary: entry.summary || '',
        };
      }
      if (entry?.bot) {
        return {
          type: 'bot',
          nickname: entry.nickname || 'Rover Bot',
          text: entry.text || '',
        };
      }
      const roverId = entry?.roverId ? String(entry.roverId) : null;
      const rover = roverId ? roverById.get(roverId) : null;
      const baseCtx = compactRoverForContext(rover) || {};
      const storedCtx = entry?.roverCtx || entry?.rover_ctx || {};
      return {
        type: 'chat',
        nickname: entry.nickname || entry.socketId?.slice(0, 6) || 'unknown',
        text: entry.text || '',
        rover_id: roverId,
        rover_ctx: { ...baseCtx, ...storedCtx },
      };
    });
    const hasRecentChat = eventStream.some((event) => event.type === 'chat');

    const currentSnapshot = { rovers };
    if (!hasRecentChat) {
      currentSnapshot.chat_recent = chatRecent;
    }

    return {
      run_meta: {
        version: 'commentary_v2',
        self_talk_recent_30m: botRecent30m.length,
        skip_streak: getSkipStreak(),
        last_message_focus: buildLastMessageFocus(lastBotMessage, rovers),
        active_driver_count: driverEntries.length,
        driving_rovers: driverEntries.map(([roverId]) => String(roverId)),
      },
      event_stream: eventStream,
      current_snapshot: currentSnapshot,
    };
  }

  function refreshFinalSnapshotForSend(snapshot) {
    const { rovers } = buildRoversNow(Date.now());
    return {
      ...(snapshot || {}),
      current_snapshot: {
        ...(snapshot?.current_snapshot || {}),
        rovers,
      },
    };
  }

  function resetHistory() {
    roverMajorEvents.length = 0;
    lastSensorFlagsByRover.clear();
    roverActivity.clear();
    lastRoverStateById.clear();
  }

  function removeRover(roverId) {
    roverActivity.delete(String(roverId));
  }

  return {
    onSensorEvent,
    buildSnapshot,
    refreshFinalSnapshotForSend,
    resetHistory,
    removeRover,
  };
}

module.exports = {
  createSnapshotEngine,
};
