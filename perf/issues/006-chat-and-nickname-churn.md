# Issue 006: Chat and Nickname Composer Churn

## Summary

The mobile `/` page defaults to the chat tab, and the chat/nickname composer shows repeated
DOM attribute commits in runtime audits. This is not the top CPU issue, but it is part of
steady idle churn.

## Severity

Medium-low to medium.

Fix after the listener/context/log/telemetry work unless chat remains high in mutation
reports.

## Affected Files

- `webui/src/components/ChatPanel/index.jsx`
- `webui/src/components/NicknameForm/index.jsx`
- `webui/src/context/ChatContext.jsx`
- `webui/src/App.jsx`

## Evidence

Artifact:

```sh
perf/results/2026-06-11T03-22-44-714Z-root-runtime/root-runtime-report.json
```

In an 18s `/` audit at mobile viewport with 6x CPU throttle:

```txt
input.field-input.chat-composer-input name: 666
input.field-input.flex-1 name: 1328
input.field-input.w-full name: 1332
input.accent-cyan-500 name: 1324
input.accent-cyan-500 type: 662
```

These map to:

- chat composer input
- nickname form input
- TTS/speak checkbox
- related chat form controls

The chat panel is mounted by default in mobile feature tabs:

```jsx
const [activeTab, setActiveTab] = useState('chat');
...
<TabPanel id="chat">
  <ChatPanel nicknameLayout="stacked" />
  ...
</TabPanel>
```

## Why This Matters

The chat UI is useful, but it should not re-commit its composer inputs hundreds of times
while the user is simply watching/driving.

Also, text inputs and focus-related logic interact with keyboard driving. Excess churn here
can have indirect effects on input handling.

## Likely Causes

`ChatPanel` consumes:

```jsx
const role = useSessionSelector((state) => state.session?.role || null);
const currentRoverId = useSessionSelector((state) => state.session?.assignment?.roverId || null);
const roster = useSessionSelector((state) => state.session?.roster ?? []);
const { messages, typing, sendMessage, ... } = useChat();
const { value: ttsSettings, save: saveTtsSettings } = useSettingsNamespace('tts', ...);
```

It also has effects that sync local state from settings:

```jsx
useEffect(() => {
  const nextEngine = ...
  if (engine !== nextEngine) setEngine(nextEngine);
  ...
}, [engine, googlePitch, googleSpeed, pitch, ttsSettings..., voice]);
```

Potential problems:

- broad session/chat context updates rerender the whole panel
- message list and composer are in the same component
- typing events cause panel updates
- nickname form may be rerendering with the whole chat panel
- TTS settings sync effect has many dependencies

## Fix Strategies

### Option A: Split ChatPanel Into Memoized Subcomponents

Separate:

- `ChatMessageList`
- `ChatComposer`
- `TtsControls`
- `NicknameForm`

Only `ChatMessageList` should rerender when messages change.
Only `ChatComposer` should rerender when draft/sending/focus changes.

### Option B: Memoize Composer

```jsx
const ChatComposer = React.memo(function ChatComposer(props) { ... });
```

Pass stable callbacks where possible.

### Option C: Debounce Typing Updates

`setTypingActive(Boolean(next.trim()))` fires on every keystroke. That is fine while typing,
but should not be involved during idle. If it causes socket chatter, debounce it.

### Option D: Stabilize NicknameForm

If `NicknameForm` consumes settings/session state broadly, make it use precise selectors and
memoize it.

### Option E: Avoid Re-Syncing Local TTS State Too Often

The settings sync effect can be simplified or guarded so it only runs when the settings
object actually changes, not on every local state update.

## Recommended Path

1. Fix issues 001-004 first.
2. Rerun mutation audit.
3. If chat/nickname inputs remain high:
   - split `ChatPanel`
   - memoize composer
   - stabilize `NicknameForm`

## Validation

Run:

```sh
CPU_THROTTLE=6 VIEWPORT=390x844 MOBILE=1 SAMPLE_MS=18000 node perf/live-root-runtime-audit.mjs https://rover.otter.land/ perf/results
```

Expected improvements:

```txt
chat-composer-input mutations should drop
NicknameForm input mutations should drop
accent-cyan-500 checkbox mutations should drop
```

Also manually verify:

- typing
- sending chat
- TTS options
- nickname edit/save
- Enter-to-focus/send chat shortcut

## Risks

- Chat focus behavior is tied to keyboard controls.
- Splitting components can accidentally break `registerInputRef`.
- TTS settings must still persist correctly.

