# REFACTOR RULES
- Do NOT change ANY functionality. All changes must be purely internal refactors.
- Refactor for simplification and maintainability.
- Remove unused files/code only when verified unused.
- No backwards compatability is needed anywhere. Clients and the server are both always up to date.
- Keep behavior/API contracts unchanged.

## Required safety checks for every change
- Preserve imports/exports and call signatures unless internal-only and non-observable.
- Validate no runtime behavior changes (manual flow checks + targeted tests when available).
- Make small, reviewable commits per service/component area.
- Treat `npm run build` output files committed into this repo as intentional deployment artifacts; do not discard them as noise.

## Server backend
- Convert every service into a folder-based structure.
- Split very large service files into smaller focused modules.
- Keep files concise and single-purpose.
- Add clear title comments at top of split files.

## WebUI frontend
- Split large JSX/components and large backing JS files into folderized modules.
- Keep modules clear and focused, with title comments.
- Remove stale compatibility/leftover code only after usage verification.

# REFACTOR TRACKING
## Current phase
- [x] Phase 1: Inventory + usage mapping (server + webui)
- [ ] Phase 2: Refactor highest-impact offenders first
- [ ] Phase 3: Sweep remaining services/components
- [ ] Phase 4: Dead code/file removal pass
- [ ] Phase 5: Final regression validation

## Server backend
### BIGGEST OFFENDERS
- [ ] audio forward service
- [ ] button box service
- [ ] chat service
- [ ] discord bot service
- [ ] home assistant service
- [ ] llm commentary service
- [ ] private rover access request service
- [ ] replay services (already partly split; reformat consistently)
- [ ] room camera services (already partly split; reformat consistently)
- [ ] rover manager service
- [ ] session service
- [ ] turn service
- [ ] verification service
- [ ] video auth service
- [ ] All remaining services: reorganize to folder structure where needed

### COMPLETED SERVICES
- None yet.

### LARGE CHANGES
- None yet.

## WebUI frontend
### BIGGEST OFFENDERS
- [x] mini summary app
- [x] spectator app
- [ ] vip audio upload card
- [ ] admin panel
- [ ] drive dock action
- [ ] gamepad mapping settings
- [ ] mobile controls
- [ ] top down map
- [ ] video tile
- [ ] Sweep `webui` for unused or unneeded files/code with verification

### COMPLETED COMPONENTS
- mini summary app
- spectator app

### LARGE CHANGES
- Split `webui/src/mini/MiniSummaryApp.jsx` into folderized modules under `webui/src/mini/MiniSummaryApp/` with a compatibility entrypoint preserved.
- Split `webui/src/spectate/SpectatorApp.jsx` into folderized modules under `webui/src/spectate/SpectatorApp/` with a compatibility entrypoint preserved.

## Done criteria (per item)
- [ ] Folderized structure created.
- [ ] Large functions extracted into focused files.
- [ ] Imports/exports updated with no external behavior change.
- [ ] Verified references/usages still resolve.
- [ ] Passed targeted checks/tests for touched area.
