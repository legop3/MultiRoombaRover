# Overseer v2 Detailed Architecture

## Purpose
This document is the durable architecture spec for Overseer v2 so design intent is not lost across chats, sessions, or contributors.

Overseer v2 is a **new, separate service** focused on controlling the room/experience, not just commenting on rover activity.

## Non-Goals
- Do not replace or delete `llmCommentaryService`.
- Do not run two LLM overseer systems simultaneously in normal operation.
- Do not rely on giant unbounded context windows.

## Legacy Service Position
- Keep `llmCommentaryService` as a preserved legacy service.
- Keep it disable-able via config.
- New v2 service should be the primary runtime when enabled.
- Legacy service remains available for fallback/testing.

## Core Product Direction
Overseer v2 is "control-first":
- It can act on room systems and chat.
- Chat is one capability, not the whole job.
- It should feel ominous/playful and intentional, not spammy.

High-level behavior goals:
- Not overbearing.
- Does things when it can make moments interesting.
- Always responds when directly addressed.
- Does not always obey.
- Does not ramble.

## Primary Inputs Overseer Must Understand
Overseer must see all three lanes every decision cycle:

1. People activity
- Who is active now.
- Who is driving what.
- Activity bursts vs quiet periods.
- Direct addresses toward Overseer.

2. Conversation context
- **Actual recent chat conversation** (human + bot messages), not only tags.
- Last N human messages (minimum 5).
- Last 1-2 bot messages for anti-repeat context.

3. World/control state
- Rover states/events.
- Lift state/cooldowns.
- Neato state/cooldowns.
- Home Assistant entity states/availability.
- Safety/lock policy state.

## Runtime Model Strategy (Hardware-Aware)
Given modest hardware and ~30s generation on `mistral-small:24b` today:

- Use one LLM system only.
- Use deterministic program logic gate before LLM calls.
- Keep LLM calls sparse and meaningful.
- Keep context bounded and compact.

### Why Not Tiny-LLM Gate
Default gate should be deterministic logic, not another LLM:
- less latency
- less complexity
- fewer failure modes
- lower cumulative compute

A tiny LLM gate can be reconsidered later only for borderline cases.

## Continuous Loop Design (Never Stops)
System runs continuously but in two stages:

1. Fast gate loop (1-3s)
- No LLM call.
- Evaluates trigger conditions.
- If no trigger: continue.

2. LLM decision loop (on trigger or heartbeat)
- Triggered by gate or max-interval heartbeat.
- Builds bounded conversational context + state update.
- Model decides and optionally calls tools.

### Trigger Examples
- Direct address to Overseer in chat.
- Chat burst / topic change / challenge language.
- High-signal world event (dock/undock/hazard/control transition).
- Heartbeat timeout reached (for ambient presence).

## Decision Modes
The orchestrator should normalize model behavior to one of:
- `SKIP`
- `CHAT`
- `ACTION`
- `ACTION+CHAT`

Meaning:
- `SKIP`: no output, no tool call.
- `CHAT`: post chat only.
- `ACTION`: run tool(s) only.
- `ACTION+CHAT`: run tool(s) and post chat.

## Tool Output vs Chat Output
These are separate channels by design:
- Tool calls are structured actions.
- Chat text is explicit messaging output.
- A tool call does not automatically produce chat.

This separation is required to avoid chat spam and keep control behavior deliberate.

## Conversational Context Format (Important)
Overseer should use:
- Stable `system` prompt with identity/rules/policy.
- Real rolling transcript (users + overseer).
- A compact `STATE_UPDATE` message each decision cycle.

### Bounded Window Rules
To protect latency:
- Keep rolling window bounded (for example 20-40 recent turns, or last 5-10 min).
- Always include last 5 human messages minimum.
- Include last 1-2 bot messages.
- Drop/summarize older content.

## Tool Availability Contract
Critical refinement: do not advertise unusable tools as available.

Each cycle split into:
1. `available_tools`
- callable now

2. `blocked_tools`
- not callable now with reason:
  - cooldown
  - busy
  - unavailable/offline
  - policy lock
  - rate limit

Example:
- If Neato is cooling down, remove `neato_*` from `available_tools` and list under `blocked_tools` with remaining seconds.

This prevents wasted model turns and impossible tool attempts.

## Initial Tool Surface
Planned callable tools (subject to runtime availability):
- `chat_say(text)`
- `lift_up()` / `lift_down()`
- `neato_start()` / `neato_send_home()` / `neato_locate()` / `neato_clear_errors()`
- `ha_set_entity(entity_id, state)` for configured controllable entities
- memory tools:
  - `memory_read()`
  - `memory_write(slot, text)` where slot ∈ {1,2,3}

Optional later:
- controlled button-box count adjustment tool (strictly bounded and auditable)

## Persistent Memory (Tiny, Explicit)
Use tiny explicit memory store:
- exactly 3 slots
- string lines only
- explicit read/write via tools
- no autonomous unbounded memory growth

Model decides which slot to replace when writing.



## Mode and Policy Locks (Tool Disabling Rules)
Overseer tool availability must respect global site mode and room-light policy locks.

Hard requirements:
- When site mode is `admin` or `lockdown`, disable Overseer action tools for:
  - Neato controls (`neato_*`)
  - Lift controls (`lift_*`)
  - Room controls (`ha_set_entity` and related room-light toggles)
- When room lights are locked on by policy, disable room control tools even if site mode is otherwise open.

How this must appear to the model:
- Disabled tools must be removed from `available_tools`.
- Disabled tools must be present in `blocked_tools` with clear reason codes.

Recommended reason codes:
- `policy_lock:site_mode_admin`
- `policy_lock:site_mode_lockdown`
- `policy_lock:lights_locked_on`

Execution-time enforcement:
- Executor must re-check these locks immediately before executing any tool call.
- If a lock changed after context build, block execution and record a blocked action event.

## Safety and Control Guardrails
Must-have guardrails before enabling actions:

1. Hard allowlist
- Only approved tool names callable.

2. Tool-specific cooldowns
- e.g., lift/neato/HA each with independent cooldown rules.

3. Global action budget
- max actions per minute (or window).

4. Policy lock checks
- block actions during admin lock/safety states.

5. Execution-time validation
- arguments validated before invoking any control service.

6. Logging + audit trail
- every attempted/blocked/executed tool call recorded.

## Admin Debug UI Requirement
This is a core requirement.

Need a dedicated v2 admin panel that shows:
- enabled/running status
- loop phase (`idle`, `gate_check`, `awaiting_model`, `tool_exec`, `posted`, `failed`)
- last trigger reason
- last state-update payload snapshot
- model input summary
- model raw output + normalized decision mode
- tool calls attempted/executed/blocked with reasons
- cooldowns and remaining times
- recent action history
- last error/failure

### UI Switching Behavior
- If v2 enabled: show v2 panel.
- If legacy enabled: show legacy panel.
- If neither enabled: show disabled state.

Define a separate v2 status schema (do not overload legacy status object).

## Chat System Plumbing Changes
Keep the existing chat/Discord integration path and extend it minimally.

Decisions:
- Keep current internal bus-based chat flow as the canonical path (`chat:message` / `chat:typing`).
- Do not introduce a second parallel bridge path for v2.
- Add `bot: true|false` on chat message payloads.
- Overseer v2 must publish chat output through the same existing chat pipeline so Discord relay continues to work automatically.
- Keep legacy compatibility while migrating.

Goal:
- Any service can emit chat messages through one standardized path, with bot identity represented by `bot: true`.

## Example Message Topology Per LLM Decision
1. `system`: stable Overseer identity/rules/style/tool policy
2. `user`: compact `STATE_UPDATE`
3. transcript turns: recent chat + overseer messages
4. tool availability block (`available_tools`, `blocked_tools`)
5. model output: decision/tool calls/chat
6. executor: validates, executes tools, posts chat if applicable
7. append tool results and continue loop

## Implementation Phases

### Phase 0: Scaffolding
- Create new service module (suggested name: `overseerControlService`).
- Add config section and runtime enable switch.
- Keep legacy untouched.

### Phase 1: Observe-Only
- Build gate loop and context builder.
- Run model decisions with no real actions (dry-run tools).
- Log what would have happened.

### Phase 2: Chat + Safe Tools
- Enable chat output and lowest-risk tools.
- Verify anti-spam and direct-address behavior.

### Phase 3: Full Control Surface
- Enable lift/neato/HA with strict cooldowns and budgets.
- Add memory tool operations.

### Phase 4: Tuning
- Tune gate thresholds, cadence, cooldowns.
- Tune prompt style and anti-repeat behavior.
- Evaluate model alternatives only after gating/cadence tuning.

## Metrics To Track
- LLM calls per minute
- average LLM latency
- skipped vs acted decision ratio
- stale response rate (acted too late)
- blocked tool call rate and reasons
- action frequency per tool
- chat message frequency per minute
- repeated-line rate

## Rollback Plan
- Single config flip disables v2.
- Legacy overseer can be re-enabled without code rollback.
- Keep migration steps isolated and reversible.

## Practical Defaults (Starting Point)
- fast gate loop: 2s
- heartbeat model run: 30s
- min human chat context: 5 latest messages
- include latest bot messages: 2
- max tool calls per decision: 1 (start conservative)
- global action budget: low (start strict)

## Open Questions (Track During Build)
- Exact per-tool cooldown values for lift/neato/HA.
- Whether button-box count adjustment is worth enabling at all.
- Which model gives best tool reliability per watt on your machine.
- Ideal transcript window (turn-count vs time-window).
- Whether to include lightweight topic tags in addition to raw messages.

## One-Line Summary
Overseer v2 should be a separate, always-running, control-first orchestrator that uses deterministic gating + bounded real conversation context + dynamically available tools, with strict guardrails and a first-class debug UI.

## Naming Configuration Requirement
Overseer name must be configurable from server config.

Requirements:
- Add a config field for Overseer display/invocation name (for example under the v2 service config).
- The configured name must propagate everywhere it matters:
  - in-chat bot nickname
  - system prompt identity text
  - direct-address recognition rules
- Prompt file should remain editable by non-code changes, so use a placeholder token in prompt text (for example `<NAME>`) and replace it at runtime.
- The prompt should still support fallback behavior if name config is missing (default name).

Implementation intent notes (future):
- Keep a single source of truth for name resolution (config + default).
- Avoid scattering hardcoded names in service code.
- If legacy and v2 coexist in codebase, ensure each service can use configured naming without breaking compatibility.

## Canonical "What the Bot Sees" Example
Use this as the concrete reference for message formatting per decision cycle.

```txt
[system]
You are <NAME>, a control-first room AI.
- You may CHAT and/or call tools.
- Respect safety/cooldowns/allowlists.
- Prefer restraint; avoid spam.
- Respond when directly addressed.
- If nothing meaningful changed, SKIP.

[user]
STATE_UPDATE
time: 2026-05-02T22:14:10-04:00
trigger: chat_burst
cooldowns: lift=ready, neato=12s, ha=ready
rovers:
- rover1: driving, driver=alex, docked=false
- rover2: driving, driver=sam, docked=false
- rover3: docked=true, charging=true
lift: down, busy=false
neato: connected=true, state=idle, charging=true
lights:
- shelf=on, bench=off, corner=on, color=purple, aux1=off, aux2=on

[user] alex: overseer you watching this drift?
[user] sam: dont kill my lights again
[assistant] <NAME>: Concrete lane stays lit. Earn the darkness.
[user] alex: i dare you to make this harder
[user] sam: bot pick a side
[assistant] <NAME>: Lift is staying put. Chaos has standards.
[user] alex: sam is about to bonk the dock

[user]
available_tools:
- chat_say(text)
- lift_up()
- lift_down()
- ha_set_entity(entity_id, state)
- memory_read()
- memory_write(slot, text)

[user]
blocked_tools:
- neato_start() reason=cooldown remaining=12s
- neato_send_home() reason=cooldown remaining=12s
- neato_locate() reason=cooldown remaining=12s
- neato_clear_errors() reason=cooldown remaining=12s
```

Notes:
- The conversation transcript is real recent chat (humans + bot), bounded by window rules.
- `STATE_UPDATE` is compact current truth, regenerated each decision cycle.
- Tools must be split into `available_tools` and `blocked_tools`; unavailable tools are not advertised as callable.
- `<NAME>` is runtime-substituted from config.

