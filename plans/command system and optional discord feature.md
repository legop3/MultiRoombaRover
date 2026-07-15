# Command system and optional Discord feature

## Purpose

Commands were originally implemented as part of the Discord bot. Web chat support was later added by adapting site chat messages into Discord-shaped messages and reusing the Discord command router. This leaves an important server capability owned by an optional external integration and creates inconsistent behavior between transports.

The command system should instead be an always-available server capability. Web chat and Discord should both be adapters for the same command system, while Discord itself becomes an optional feature that can be disabled without affecting commands or the rest of the server.

This is an internal architecture change. Existing behavior on the outside must remain unchanged unless this plan explicitly introduces a new command.

## Non-negotiable behavior

- Existing command names and syntax continue to work.
- Existing permission and lockdown rules continue to work.
- Existing web-chat command messages and replies continue to look and behave the same.
- Existing Discord replies and embeds retain the same content, titles, field ordering, colors, timestamps, mention behavior, attachment names, progress updates, and edit behavior.
- Existing Discord chat bridge, presence, moderation workflows, announcements, and other integrations continue to work when Discord is enabled.
- Disabling Discord does not disable site-chat commands, replay generation, or unrelated server features.
- Discord.js types, messages, embeds, guilds, channels, and configuration do not leak into the shared command implementation.
- Replay hosting requires no new configuration. It must be automatic, conservative, and functional.
- Backwards compatibility for obsolete internal architecture is not required after migration. Temporary migration adapters should be deleted when the new path is complete.

## Target dependency direction

```text
Web chat adapter ---------+
                          |
                          v
                 Operator command service ----> Existing server services
                          ^
                          |
Optional Discord adapter -+
```

The operator command service owns parsing, command discovery, permission policy, execution, and neutral results. It does not know how a web-chat message or Discord message is represented.

The name `operatorCommandService` avoids confusion with the existing rover `commandService`, which sends operational commands to individual rovers.

## Command configuration

Command naming belongs to the command system rather than Discord:

```yaml
commands:
  prefix: "rs"
  timeStatusCommand: "ts"
```

Both web chat and Discord must read these same values. Prefix matching remains case-insensitive and must match a whole token so a prefix such as `rs` does not treat a word such as `rsvp` as a command.

Discord becomes an explicitly optional feature:

```yaml
discord:
  enabled: false
  token: ""
```

The existing Discord channel, role, site URL, and other settings stay under `discord`. `discord.enabled` is authoritative: a stored token must not silently enable the feature. If Discord is enabled but required credentials are missing or login fails, the failure is clearly logged and must not prevent the rest of the server from operating.

### Existing server feature system is authoritative

Use `server/src/helpers/features.js` as the single source of truth for whether optional features are configured and enabled. Do not add a command-specific feature registry, duplicate configuration checks inside command handlers, or infer availability independently from individual config fields.

- Add Discord to `buildFeatureFlags()` using the same explicit feature-gating pattern as the other optional server features. Discord is enabled only when `discord.enabled` is explicitly true and the required token is present.
- Discord service bootstrap, command-adapter registration, integrations, presence, bridge behavior, alerts, and Discord replay delivery all consult the shared Discord feature flag.
- Command definitions use `requiredFeature` metadata, and the command dispatcher resolves that metadata through `isFeatureEnabled()` or a feature-flags snapshot from the same helper.
- Help availability and command execution use the same feature result so help cannot advertise a command as available when execution considers it disabled.
- Lift and Neato availability comes from the existing `lift` and `neato` feature flags. Commands must not reproduce their Home Assistant, switch, device, or enabled-field checks.
- Configuration-level feature availability is separate from runtime health. For example, an enabled lift may currently be disconnected, and configured Discord may fail login. The shared feature helper answers whether the feature is enabled and configured; the owning service remains authoritative for runtime readiness and returns a clear operational failure.
- Replay generation and automatic local replay hosting are core server capabilities and are not feature-gated. Only the optional Discord delivery provider depends on the Discord feature flag and live Discord readiness.

When Discord is disabled:

- Do not construct a Discord client.
- Do not attempt login.
- Do not register Discord event handlers or event-bus integrations.
- Do not register Discord chat bridge subscriptions.
- Do not start Discord presence behavior.
- Keep the shared command service and all site-chat commands active.

## Neutral command request

Every transport converts its native user/message state into one normalized request:

```js
{
  text: 'rs lock alpha',
  source: 'web-chat',
  actor: {
    id: 'stable actor id',
    label: 'display name',
    role: 'admin',
    isAdmin: true,
    isLockdownAdmin: false,
  },
  context: {}
}
```

The web adapter derives the actor from the authenticated socket, identity, and role services. The Discord adapter derives it from the Discord user and configured administrator mapping. Command handlers consume the normalized actor and never inspect a socket or `message.author`.

Transport-specific context is allowed only for transport-specific extension commands. For example, the Discord-only bridge command needs guild and channel context, but shared commands must not depend on it.

## Command registry

Replace the large dispatcher switch and scattered help definitions with a command registry. A command definition should contain enough metadata to drive parsing, authorization, availability, and help:

```js
{
  name: 'lift',
  category: 'feature',
  summary: 'Control the rover lift.',
  description: 'Show lift state or request upward or downward movement.',
  usage: ['lift status', 'lift up', 'lift down'],
  examples: ['rs lift status', 'rs lift down'],
  access: 'admin',
  lockdownAccess: 'lockdown-admin',
  requiredFeature: 'lift',
  execute,
}
```

The dispatcher should be responsible for common authorization. Individual handlers may perform finer-grained checks when subcommands truly require different access, but they should not duplicate the ordinary admin and lockdown gates.

## Command categories

Categories organize registration and help. Existing syntax must not be changed merely to add categories; for example, `rs mode` stays `rs mode` rather than becoming `rs admin mode`.

### System commands

General server information and server-wide user actions:

- `rs help`
- `rs status`
- `rs replay`
- The configured time-status command, currently `ts`
- Future health, session, or informational commands that do not belong to one optional feature

### Admin commands

Operational, access, and moderation controls:

- `rs lock`
- `rs unlock`
- `rs mode`
- `rs kick`
- `rs goal`
- `rs reason`
- `rs verify`
- `rs deter`
- `rs lights`

Existing admin and lockdown-admin policies remain authoritative.

### Feature commands

Commands belonging to optional hardware or server features. Initial additions should include:

- `rs lift status`
- `rs lift up`
- `rs lift down`
- `rs neato status`
- `rs neato start`
- `rs neato home`
- `rs neato locate`
- `rs neato clear-errors`

Feature command handlers must call the existing feature services. They must not reimplement lift interlocks, cooldowns, connectivity checks, Home Assistant calls, Neato state rules, or other hardware safety logic. The feature service remains the source of truth and the command reports its result.

The dispatcher checks each command's `requiredFeature` against the existing server feature system before execution. The owning feature service then performs runtime availability and safety checks. This deliberately keeps configuration eligibility centralized in `helpers/features.js` while keeping live device state and operational rules inside the service that controls the feature.

Commands for an unavailable or disabled feature return a clear unavailable response rather than throwing or silently doing nothing.

### Discord-only commands

Discord bridge configuration is not a general server command. Keep `bridge` as a Discord extension command registered by the Discord adapter:

- `rs bridge`
- `rs bridge here`
- `rs bridge mode`
- `rs bridge off`

These commands retain their current syntax and Discord behavior but do not appear as available commands in web chat.

## Organized help

Help is generated from registry metadata so command definitions and documentation cannot drift apart.

The default help should be detailed but scannable, grouped into System, Admin, and Features. Discord-only commands can appear in a Discord section when help is requested from Discord. Help should respect the configured prefix and time-status command.

Support focused help:

- `rs help system`
- `rs help admin`
- `rs help features`
- `rs help status`
- `rs help replay`
- `rs help lift`
- `rs help neato`
- The same pattern for every registered command

Focused command help should include:

- A clear description
- Required permission level
- Availability or required feature
- Accepted usage forms
- Useful examples
- Subcommand explanations where applicable

The registry provides neutral help data. Web chat renders readable plain text. Discord uses its own renderer and must preserve the established outward style. Improving organization must not accidentally change unrelated Discord embeds such as rover status and time status.

## Neutral command results and transport rendering

Shared handlers return neutral results instead of calling `message.reply()`:

```js
{
  handled: true,
  ok: true,
  messages: [
    {
      kind: 'text',
      text: 'Locked Alpha.',
    },
  ],
}
```

Simple commands should return text results. Structured results should be used only where transports benefit from different faithful presentations, such as rover status, time status, help, administrative lists, or replay progress.

Discord renderers translate neutral results into the same Discord.js reply and embed objects used today. Existing embed builders should be extracted and retained where possible instead of visually rewriting them during this architecture change.

The web adapter translates the same results into the existing `Rover bot` system messages. The current behavior where the user's command remains visible in the chat transcript should remain unchanged.

## Replay architecture

Replay generation and replay delivery are separate responsibilities:

```text
Replay request
    |
    v
Replay engine builds one completed MP4
    |
    v
Replay delivery coordinator
    |-- Discord is enabled, ready, and replay channel works
    |      -> upload MP4 to Discord
    |      -> use returned Discord attachment URL
    |
    `-- Discord unavailable, unconfigured, or upload fails
           -> store MP4 under the server data directory
           -> use server-hosted media URL
    |
    v
Publish the playable replay media payload to clients
```

Discord remains the preferred host when it is configured for replay delivery. A Discord upload failure after a successful replay build must fall back to local hosting instead of failing the replay. The Discord failure should be logged clearly, while clients still receive a working replay.

The common client media payload should remain compatible with the current payload so `/mini`, `/display`, spectator clients, and other replay consumers behave the same. Discord-specific metadata remains present when Discord hosted the media. Locally hosted media supplies the same common playable URL and media fields without pretending to be a Discord attachment.

### Automatic local replay hosting

No replay-hosting configuration is added. Use conservative internal constants chosen after checking typical generated replay sizes.

The local media service should:

- Store completed files in `data/replays/` through the canonical data-directory helper.
- Use random, non-guessable IDs in public filenames.
- Expose a deliberate route such as `/media/replays/:id.mp4` rather than placing runtime media in built web assets.
- Support HTTP range requests so browsers can seek and play MP4 files normally.
- Set the correct media type and safe cache headers.
- Write atomically by completing a temporary file and renaming it into place.
- Never expose or delete a file that is still being written.
- Remove abandoned temporary files.
- Delete expired replay files during server startup.
- Run one lightweight periodic cleanup while the server is running.
- Stop the cleanup timer during graceful shutdown if the server has a shutdown lifecycle.
- Enforce both a conservative age limit and a conservative total storage ceiling.
- Delete the oldest completed files first when the storage ceiling is exceeded.
- Treat cleanup errors as logged, nonfatal maintenance failures.
- Prevent path traversal and serve only known replay filenames from the replay directory.

Cleanup must operate only on the hosted replay directory and must not touch replay frame caches, unrelated data files, or active replay builds.

## Optional Discord feature boundary

The Discord feature owns:

- Discord client creation and login
- Intents and partials
- Discord message-to-command adaptation
- Neutral-result-to-Discord rendering
- Existing embed presentation
- Discord replay upload delivery
- Chat bridge and webhook behavior
- Guild bridge storage and bridge commands
- Presence
- Discord announcements and alerts
- DM verification and private-access moderation workflows
- Reactions and Discord event handling

Discord must be added to and activated through the existing server feature system. The Discord entrypoint must not maintain a separate interpretation of `discord.enabled` and token availability. Runtime client readiness may still be tracked inside the Discord feature for operations such as replay upload, but that readiness supplements rather than replaces the shared configuration feature flag.

The Discord feature may import the operator command service. The operator command service, replay engine, chat service, and feature command handlers must not import the Discord feature or Discord.js.

## Focused regression protection

The existing implementation is the reference for current command wording and behavior. Read and preserve that behavior while moving each handler; do not first catalogue every reply or build exhaustive snapshots for all commands.

Use focused tests and practical checks at the boundaries most likely to cause meaningful regressions:

- Discord status and time-status embeds retain their existing content, structure, colors, field order, timestamps, and links.
- Discord replay progress edits, attachment upload, filename, URL extraction, and client media publication continue to work.
- A failed or unavailable Discord replay delivery falls back to working locally hosted media.
- Commands remain operational when Discord is disabled or fails login.
- Web chat and Discord use the same configured prefix and whole-token matching behavior.
- Admin and lockdown permissions are enforced consistently from both transports.
- Disabled feature commands return a clear unavailable result, while enabled feature commands use their owning service's runtime safety checks.
- Hosted replay routes support playback and seeking, reject invalid paths, and cleanup only expired completed media.

Use direct inspection and practical command checks for ordinary response wording. Additional tests are appropriate when complex logic is extracted, but exhaustive output transcription is not a prerequisite for the refactor.

## Implementation sequence

Build directly toward the final architecture. It is acceptable to move commands in logical groups while working, but avoid investing in a durable old/new compatibility framework. Once a replacement path works, remove the obsolete adapter and duplicated implementation.

1. Add the operator command request, actor, result, parser, registry, authorization, and help foundations.
2. Extract existing Discord formatting and embed construction into transport-owned renderers without changing their output.
3. Move existing system and admin commands into the registry, using their current code as the behavioral reference.
4. Move status and time status while separating neutral data collection from unchanged Discord embed rendering.
5. Add organized registry-driven help with transport-specific output.
6. Add lift and Neato feature command families using the existing feature flags, services, and safety rules.
7. Add the automatic local replay media store, HTTP route, range serving, startup cleanup, periodic cleanup, and storage limits.
8. Split replay generation from delivery and add the Discord-preferred/local-fallback delivery coordinator.
9. Move replay onto the shared command service while preserving existing Discord progress and upload behavior.
10. Convert web chat and Discord to the shared command service and move bridge commands into the Discord-only extension registry.
11. Add Discord to the existing feature system and gate all Discord bootstrap and integrations through it.
12. Remove the Discord-owned shared router, fake Discord message objects, web replay command injection, result-flattening workaround, and duplicate replay paths.
13. Add or update focused tests for the high-risk boundaries listed above.
14. Run server tests, practical command checks, the web UI build, and targeted lint for touched files.

## Completion criteria

- The server has one transport-neutral command registry and execution path.
- Web chat commands work with Discord completely disabled.
- Discord consumes the shared command service as an optional adapter.
- The configured command prefix behaves consistently everywhere.
- Help is organized by System, Admin, Features, and Discord-only extensions where applicable.
- Detailed per-command and per-category help is available.
- Lift and Neato commands use existing service safety and availability behavior.
- Discord-hosted replays behave exactly as before when Discord delivery succeeds.
- Replays automatically fall back to maintained server-hosted media without configuration.
- Existing clients continue receiving compatible replay media payloads.
- Existing Discord embeds and outward behavior remain unchanged.
- Temporary adapters and duplicated command logic are removed.
