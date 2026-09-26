# PUTDUK Motion and Experience System

Status: **CANONICAL FOUNDATION**

## 1. Purpose

Motion communicates cause, continuity and progress. It does not manufacture activity, hide uncertain server work or simulate financial/mining progress without authoritative data.

## 2. Motion tiers

| Tier | Use | Budget |
| --- | --- | --- |
| Micro | focus, press, toggle, inline state | 120–180 ms |
| Component | disclosure, tab, sheet, card state | 180–280 ms |
| Spatial | route/shared-object continuity | 240–420 ms |
| Cinematic | mining start/result, rank elevation | 600–1400 ms, skippable and state-safe |

Use transform and opacity where possible. Layout-affecting animation requires measurement and a clear interaction benefit.

## 3. Mining experience contract

```text
authoritative server state
→ UI state machine
→ motion cue
→ visible result and evidence
```

- Never advance a progress meter from an arbitrary timer when the value represents server work.
- Optimistic feedback may acknowledge a button press, but reward/result state waits for the server response.
- Reconnect resumes from fetched state, not from the last animation frame.
- Duplicate requests must resolve to the same idempotent result.
- A failed or cancelled animation cannot roll back or duplicate an accepted settlement.

## 4. 2D/2.5D and 3D boundary

Normal application UI remains 2D/2.5D. Selective 3D may be used for:

- the active mining world;
- equipment inspection where spatial understanding adds value;
- rank/world milestone moments.

It may not be required to fund, withdraw, review a ledger, recover an account or operate admin controls.

## 5. Runtime budgets

- Load 3D only after the critical UI and after capability/intent checks.
- Provide a complete raster/2.5D fallback from the canonical asset system.
- Use compressed textures, geometry reuse, instancing and LOD.
- Pause rendering when hidden or out of view.
- Prefer a stable 30 FPS fallback over an unstable 60 FPS attempt on constrained devices.
- Establish route-specific memory and bundle baselines before release; regressions require an owner and explanation.
- Avoid continuous bloom, particle fields or post-processing on ordinary screens.

## 6. Reduced motion and low power

With `prefers-reduced-motion: reduce`:

- remove parallax, orbital loops, camera travel and shimmer;
- replace cinematic transitions with short opacity changes or direct state updates;
- preserve all state, copy, controls and result evidence;
- do not autoplay decorative video or 3D.

Low-power/capability fallback may also select the same reduced experience without changing business behavior.

## 7. Loading, offline and recovery

- Loading skeletons match the final layout and carry an accessible label.
- Unknown duration uses an indeterminate treatment and truthful copy.
- Offline screens distinguish cached reading from blocked mutation.
- Reconnecting never claims completion until state is revalidated.
- Retry actions are explicit, bounded and safe under idempotency.
- Error copy gives the user a next action and exposes a support/reference ID when available.

## 8. QA evidence

For each motion-bearing critical flow retain:

- normal and reduced-motion recordings;
- mobile/tablet/desktop screenshots at stable states;
- FPS/long-task and memory observations on the agreed device set;
- proof that server result and rendered result match;
- offline/reconnect and duplicate-action results;
- keyboard and screen-reader behavior for the underlying action.
