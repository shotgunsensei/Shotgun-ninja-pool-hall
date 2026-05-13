# Shotgun Ninjas Pool Hall — Code Analysis and Improvement Task Plan

## Scope reviewed

- Game rendering and interaction loop: `src/components/PoolGame.tsx`
- Core simulation and geometry: `src/lib/physics.ts`
- Rules engine: `src/lib/rules.ts`
- HUD and core UX surfaces: `src/components/HUD.tsx`, `src/components/PowerMeter.tsx`, `src/pages/MainMenu.tsx`, `src/pages/Settings.tsx`
- Existing test coverage: `src/lib/physics.test.ts`, `src/lib/rules.test.ts`

---

## Executive summary

The project has a strong baseline:

- Physics and rules are thoughtfully documented, deterministic, and already unit-tested.
- Architecture clearly separates simulation (`physics.ts`) from game-law logic (`rules.ts`), which is a major maintainability win.
- Mobile-first UX exists and is coherent.

Primary opportunity areas:

1. **GUI scalability and clarity under gameplay pressure** (readability, shot feedback, and aiming affordances).
2. **Physics realism tuning and calibration infrastructure** (not just constants tuning, but repeatable test/scenario validation).
3. **Playability loops** (onboarding, feedback, progression, and reducing “dead time”/ambiguity between turns).

---

## Detailed analysis

## 1) GUI / UX analysis

### Strengths

- HUD structure is compact and readable with active-state emphasis.
- Main menu is visually distinctive and clearly segmented by mode.
- Settings are straightforward and low-friction.

### Gaps / risks

1. **Missing high-signal shot feedback moments**
   - Players likely see state changes (turn switches, fouls, pocket outcomes) mostly via subtle HUD text and badges.
   - There is no obvious event timeline/toast system dedicated to “what just happened” after each shot.

2. **Aiming confidence on touch can be inconsistent**
   - Spin selector is present (great), but confidence aids such as predicted cue-object contact marker, object-ball path ghost, and explicit legal/illegal target hints are not exposed as layered toggles.

3. **Accessibility and small-screen pressure**
   - Dense top HUD plus in-table controls may compress on smaller devices.
   - No explicit audit checklist for contrast targets, touch target size, or reduced motion strategy.

4. **Settings discoverability depth**
   - Good for basics, but not yet split into “casual defaults” vs “advanced tuning” (e.g., aim assists, camera mode, vibration intensity, guide complexity).

---

## 2) Physics analysis

### Strengths

- Excellent inline physics documentation and intent explanation.
- Thoughtful safety caps for runaway energy conditions.
- Sub-stepping, jaw geometry, and separate pocket capture centers indicate mature handling of tunneling and pocket realism.

### Gaps / risks

1. **Calibration methodology appears implicit**
   - Constants are well-commented but there is no visible “calibration harness” linking values to reproducible target behaviors (e.g., stop distance at speed X, bounce angle error tolerances, expected break spread metrics).

2. **Potential edge-case realism around spin transfer and rail behavior**
   - Model includes side spin decay and rail retention, but without scenario snapshots it may drift from expected “feel” over successive tweaks.

3. **Determinism vs frame pacing integration risk**
   - Simulation tick is fixed (good), but end-to-end UX quality depends on how playback/animation syncs to simulated ticks under device load.

4. **Limited test granularity around qualitative behaviors**
   - Existing tests pass and likely cover correctness, but there is opportunity for behavior-envelope tests (e.g., “stun shot should preserve near-centerline post-contact within tolerance”).

---

## 3) Overall playability analysis

### Strengths

- Multiple play modes (practice, local, online host/join).
- Sound and vibration hooks already support tactile game feel.
- Rule variants (call shot on 8, three-foul) are already represented in settings state.

### Gaps / risks

1. **Onboarding friction for non-pool players**
   - New players may not understand open table assignment, legal break requirements, or special break outcomes without contextual prompts.

2. **Pacing dips between meaningful decisions**
   - If shot feedback is subtle and there are pauses without clear intent cues, sessions can feel less “snappy” than arcade competitors.

3. **Progression/replayability systems are light**
   - Practice mode value can increase significantly with drills, challenges, and performance tracking loops.

4. **Online quality-of-play instrumentation not obvious**
   - For online mode, there should be explicit UX for latency state, reconnect status, and authority resolution events.

---

## Prioritized task backlog

## P0 — Immediate (high impact, low/medium risk)

1. **Post-shot event banner system**
   - Build a compact event strip/toast queue for outcomes: legal hit, foul reason, group assignment, called-pocket result, turn handoff.
   - Acceptance: each completed shot produces one high-signal summary event.

2. **Aiming assist tiering**
   - Add setting levels: Off / Basic (cue line) / Advanced (first contact + object path ghost).
   - Acceptance: assists can be toggled mid-session without desyncing game state.

3. **Physics scenario regression suite**
   - Add deterministic scenario tests for:
     - straight stop shot,
     - 45° cut with stun,
     - rail-first escape,
     - medium break spread envelope.
   - Acceptance: scenario outputs captured as toleranced snapshots.

4. **Shot-time feedback polish**
   - Add lightweight camera shake/haptic pulse tiers for contact quality (cue strike, collision chain, pocket sink, foul).
   - Acceptance: feedback intensity follows settings and can be disabled.

## P1 — Near-term (medium impact, medium effort)

5. **Mobile HUD compaction mode**
   - Auto-switch to compact HUD below width threshold.
   - Keep turn indicator and key foul info always visible.

6. **Tutorial overlays (first 3 games)**
   - Contextual overlays for break legality, group assignment, and winning/loss conditions.
   - Dismissable and never intrusive after completion.

7. **Advanced settings section**
   - Expose toggles for call-shot-on-8 and three-foul in UI (already in settings model).
   - Add “restore defaults” action.

8. **Physics calibration CLI/harness**
   - Add script to run canned shots and output CSV/JSON metrics (distance, time-to-rest, bounce angle delta).

## P2 — Strategic (higher effort, major replayability gains)

9. **Practice drills system**
   - Add drill templates (line-up pots, draw-back control, bank shots).
   - Track pass/fail and best streak.

10. **Bot skill tiers**
    - Move from basic CPU to configurable decision noise and position-play heuristics.

11. **Online resilience UX**
    - Connection badge states: connected / unstable / reconnecting.
    - Explicit resync messaging and shot authority indicators.

12. **Telemetry-informed tuning loop**
    - Optional local analytics events for shot duration, foul frequency, quit points, setting usage.
    - Use aggregate trends to prioritize balance/UI changes.

---

## Suggested implementation sequence (6-week plan)

- **Week 1–2:** P0.1, P0.2, P0.4 (visible UX wins)
- **Week 2–3:** P0.3 (regression harness prevents future physics regressions)
- **Week 3–4:** P1.5, P1.7
- **Week 4–5:** P1.6, P1.8
- **Week 5–6:** start P2.9 and P2.11 discovery/prototyping

---

## Definition of done recommendations

For each shipped item:

- Unit/integration tests updated.
- At least one mobile viewport QA pass documented.
- No regressions in `physics.test.ts` and `rules.test.ts`.
- Feature flagged or settings-gated when introducing behavior changes.
- Short changelog entry in `artifacts/pool/README.md`.

---

## Risk register

- **Over-assist risk:** too much guidance can reduce skill expression.
- **Physics drift risk:** ad-hoc constant changes without scenario baselines degrade feel.
- **UI clutter risk:** adding feedback can overload small screens.
- **Online trust risk:** unclear authority/recovery states reduce perceived fairness.

Mitigation: ship behind toggles, rely on scenario regression suite, and validate with short structured playtests.
