// Operator Fun Rover Commands
// Purpose: Implements the fun commands that actually make the fleet or the room do something (honk, boo, disco, spin, vibecheck).
// Scope: Every handler here re-checks control and feature gating itself, because issueCommand bypasses the socket command guards.
const { getCommandConfig } = require('../../operatorCommandService/config');
const { describeWait } = require('../cooldowns');
const {
  PLAIN_MENTIONS,
  actorLabel,
  buildActorKey,
  createRoverResolver,
  hashSeed,
  pickBySeed,
  resolveFunTarget,
} = require('./funHelpers');

// Durations are deliberately short and are also bounded rover-side: roverd
// enforces its own horn MaxDuration, so a lost stop command cannot leave a horn
// sounding forever.
const HONK_MS = 600;
const HONK_FREQ_HZ = 440;
const SPIN_MS = 1200;
const SPIN_SPEED = 120;
const DISCO_MS = 12 * 1000;
const DISCO_TICK_MS = 750;

const HONK_ACTOR_COOLDOWN_MS = 20 * 1000;
const HONK_ROVER_COOLDOWN_MS = 8 * 1000;
const BOO_COOLDOWN_MS = 30 * 1000;
const SPIN_COOLDOWN_MS = 25 * 1000;
const DISCO_COOLDOWN_MS = 2 * 60 * 1000;
const VIBECHECK_COOLDOWN_MS = 5 * 1000;

/*
  Taunts are a fixed list rather than caller-supplied text on purpose. `boo` puts
  audio out of a speaker in a room full of people, so letting it read arbitrary
  input would turn a joke command into an unmoderated TTS channel aimed at
  whoever is nearest the rover.
*/
const BOO_TAUNTS = [
  'Boo.', 'Your driving is being reviewed.', 'That was a choice.',
  'The wall was right there.', 'Someone in chat is laughing at you.',
  'I have seen better parking from the Neato.', 'Boo. Respectfully.',
  'This is a citizen\'s arrest.', 'Turn left. No, the other left.',
];

const VIBE_VERDICTS = [
  'immaculate', 'acceptable', 'questionable', 'concerning', 'dire', 'unwell',
];

function describeBattery(batteryState) {
  const display = Number(batteryState?.percentDisplay);
  if (Number.isFinite(display)) return `${Math.round(display)}%`;
  const percent = Number(batteryState?.percent);
  if (Number.isFinite(percent)) return `${Math.round(percent * 100)}%`;
  return 'unknown';
}

function createFunRoverCommands({
  io,
  rovers,
  roverManager,
  getNickname,
  getActiveDrivers,
  getActorSocket,
  issueCommand,
  homeAssistantService,
  isFeatureEnabled,
  sanitizeMentions,
  cooldowns,
  logger,
  config,
}) {
  const { prefix: commandPrefix } = getCommandConfig(config);
  const safe = (text) => (sanitizeMentions ? sanitizeMentions(text) : String(text || ''));
  const resolveTargetRover = createRoverResolver({ rovers, roverManager, getActorSocket, commandPrefix });

  function reply(message, content) {
    return message.reply({ content: safe(content), allowedMentions: PLAIN_MENTIONS });
  }

  function gate(message, action, windowMs) {
    const actorKey = buildActorKey(message);
    if (!actorKey) return { error: 'Could not identify you well enough to do that.' };
    const wait = cooldowns.consume(`${action}:${actorKey}`, windowMs);
    if (wait > 0) return { error: `Slow down — try \`${commandPrefix} ${action}\` again in ${describeWait(wait)}.` };
    return { actorKey, label: actorLabel(message) };
  }

  /*
    issueCommand is the raw rover transport: it performs none of the ownership,
    deterrence, or private-safety checks that the socket `command` handler applies.
    Any fun command that moves hardware therefore has to prove control here, which
    also means these commands are inherently site-chat only — a Discord message has
    no socket and so can never satisfy canDrive.
  */
  function requireDriveControl(action, selector) {
    const socket = getActorSocket?.() || null;
    if (!socket) {
      return { error: `\`${commandPrefix} ${action}\` only works from site chat, where you can actually be driving.` };
    }
    const rover = resolveTargetRover(selector, action);
    if (rover.error) return { error: rover.error };
    if (!roverManager?.canDrive?.(rover.id, socket)) {
      return { error: `You need control of ${rover.name} to do that.` };
    }
    return { rover, socket };
  }

  function safeIssue(roverId, payload, context) {
    try {
      issueCommand(roverId, payload);
      return true;
    } catch (err) {
      // Deferred stop commands routinely land after a rover drops off. That is
      // expected, not an incident, so it is logged at debug volume and swallowed.
      logger?.warn?.('Fun command could not reach rover', { roverId, context, error: err.message });
      return false;
    }
  }

  async function handleHonk(message, tokens = []) {
    const control = requireDriveControl('honk', tokens.join(' '));
    if (control.error) return reply(message, control.error);
    const { rover } = control;

    if (rover.record?.meta?.horn?.enabled === false) {
      return reply(message, `${rover.name} has no horn fitted.`);
    }

    const gated = gate(message, 'honk', HONK_ACTOR_COOLDOWN_MS);
    if (gated.error) return reply(message, gated.error);

    // A second, rover-scoped window stops a group of drivers taking turns to
    // honk the same rover continuously while each stays inside their own limit.
    const roverWait = cooldowns.consume(`honk:rover:${rover.id}`, HONK_ROVER_COOLDOWN_MS);
    if (roverWait > 0) {
      return reply(message, `${rover.name} was just honked. Give it ${describeWait(roverWait)}.`);
    }

    if (!safeIssue(rover.id, { type: 'horn', horn: { action: 'start', waveform: 'sine', freqs: [HONK_FREQ_HZ] } }, 'honk:start')) {
      return reply(message, `${rover.name} is offline.`);
    }
    setTimeout(() => safeIssue(rover.id, { type: 'horn', horn: { action: 'stop' } }, 'honk:stop'), HONK_MS);

    return reply(message, `📢 HONK. (${rover.name})`);
  }

  async function handleSpin(message, tokens = []) {
    const control = requireDriveControl('spin', tokens.join(' '));
    if (control.error) return reply(message, control.error);
    const { rover, socket } = control;

    const gated = gate(message, 'spin', SPIN_COOLDOWN_MS);
    if (gated.error) return reply(message, gated.error);

    const maxWheelSpeed = Number(rover.record?.meta?.maxWheelSpeed);
    const speed = Math.max(1, Math.min(SPIN_SPEED, Number.isFinite(maxWheelSpeed) && maxWheelSpeed > 0 ? maxWheelSpeed : SPIN_SPEED));
    let driveDirect = { left: speed, right: -speed };
    /*
      Private rovers can carry a reduced speed ceiling that the socket path would
      normally apply. Applying it explicitly keeps a fun command from being the one
      way to exceed a limit an admin set for a specific rover.
    */
    const safeDrive = roverManager?.applyPrivateDriveSafety?.(rover.id, socket, driveDirect);
    if (safeDrive) driveDirect = safeDrive;

    if (!safeIssue(rover.id, { type: 'drive', driveDirect }, 'spin:start')) {
      return reply(message, `${rover.name} is offline.`);
    }
    setTimeout(() => safeIssue(rover.id, { type: 'drive', driveDirect: { left: 0, right: 0 } }, 'spin:stop'), SPIN_MS);

    return reply(message, `🌀 ${rover.name} is doing a spin.`);
  }

  async function handleBoo(message, tokens = []) {
    const selector = tokens.join(' ').trim();
    if (!selector) return reply(message, `Usage: \`${commandPrefix} boo <user>\``);

    const gated = gate(message, 'boo', BOO_COOLDOWN_MS);
    if (gated.error) return reply(message, gated.error);

    const resolved = resolveFunTarget({ io, getNickname, selector });
    if (!resolved) return reply(message, `Usage: \`${commandPrefix} boo <user>\``);
    if (!resolved.online || !resolved.socket) {
      return reply(message, `${resolved.label} is not here to be booed.`);
    }

    // Boo lands on the rover the target is actually driving, so it needs the
    // active-driver map rather than merely which rovers they are watching.
    const drivers = getActiveDrivers?.() || {};
    const roverId = Object.keys(drivers).find((id) => drivers[id] === resolved.socket.id) || null;
    if (!roverId) return reply(message, `${resolved.label} is not driving anything right now.`);

    const record = rovers.get(String(roverId));
    const roverName = record?.meta?.name || roverId;
    if (record?.meta?.audio?.ttsEnabled === false) {
      return reply(message, `${roverName} cannot speak.`);
    }

    const taunt = pickBySeed(BOO_TAUNTS, hashSeed(`${gated.actorKey}:${resolved.label}`));
    if (!safeIssue(roverId, { type: 'tts', tts: { text: taunt, speak: true, engine: 'chromegtts' } }, 'boo')) {
      return reply(message, `${roverName} is offline.`);
    }

    return reply(message, `👻 Booed ${resolved.label} through ${roverName}.`);
  }

  async function handleDisco(message) {
    if (!homeAssistantService || !isFeatureEnabled?.('homeAssistant')) {
      return reply(message, 'Room light controls are unavailable.');
    }

    // An admin lock on the room lights is a policy boundary. Disco is a scene
    // change like `rs lights on`, so it must not be the one command that ignores it.
    const lightPolicy = homeAssistantService.getLightPolicyState?.() || {};
    if (lightPolicy.locked) {
      return reply(message, 'Room lights are locked. No disco.');
    }

    const gated = gate(message, 'disco', DISCO_COOLDOWN_MS);
    if (gated.error) return reply(message, gated.error);

    const setAll = homeAssistantService.setAllControllableEntitiesState;
    if (typeof setAll !== 'function') {
      return reply(message, 'Room light controls are unavailable.');
    }

    const endsAt = Date.now() + DISCO_MS;
    let on = false;
    /*
      Held in a local interval rather than the rewards effect store because a
      disco is short and disposable. Nothing needs to survive a restart, and the
      final tick always restores the lights to on.
    */
    const timer = setInterval(() => {
      if (Date.now() >= endsAt) {
        clearInterval(timer);
        Promise.resolve(setAll('on')).catch((err) => {
          logger?.warn?.('Disco could not restore lights', { error: err.message });
        });
        return;
      }
      on = !on;
      Promise.resolve(setAll(on ? 'on' : 'off')).catch((err) => {
        logger?.warn?.('Disco tick failed', { error: err.message });
      });
    }, DISCO_TICK_MS);

    return reply(message, `🪩 Disco for ${Math.round(DISCO_MS / 1000)} seconds. Started by ${gated.label}.`);
  }

  async function handleVibecheck(message, tokens = []) {
    const gated = gate(message, 'vibecheck', VIBECHECK_COOLDOWN_MS);
    if (gated.error) return reply(message, gated.error);

    const rover = resolveTargetRover(tokens.join(' '), 'vibecheck');
    if (rover.error) return reply(message, rover.error);

    const record = rover.record || rovers.get(rover.id) || null;
    const battery = describeBattery(record?.batteryState);
    const offline = !record?.ws;
    const locked = Boolean(record?.locked);
    const urgent = Boolean(record?.batteryState?.urgentActive);
    const warn = Boolean(record?.batteryState?.warnActive);

    let verdict;
    if (offline) verdict = 'nonexistent — it is offline';
    else if (urgent) verdict = 'dying';
    else if (warn) verdict = 'running low';
    else if (locked) verdict = 'locked out and sulking';
    else verdict = pickBySeed(VIBE_VERDICTS, hashSeed(`${rover.id}:${battery}`));

    return reply(message, `🔍 ${rover.name}: vibes are **${verdict}**. Battery ${battery}.`);
  }

  return {
    honk: handleHonk,
    boo: handleBoo,
    disco: handleDisco,
    spin: handleSpin,
    vibecheck: handleVibecheck,
  };
}

module.exports = { createFunRoverCommands, describeBattery };
