# Shotgun Ninjas Pool Hall

Mobile-first 8-ball pool web app, branded after the Shotgun Ninjas Productions
"operator" aesthetic — black + crimson, bold uppercase headlines, tactical
`SYS::` accents. Three modes:

- **Practice** — Free shoot, or play against a basic CPU.
- **Local 2 player** — Hot-seat on one device, alternating turns.
- **Online room** — Two phones share a 4-character room code (or the QR
  link). Host-authoritative — the host's browser runs the simulation; the
  guest sends shot intents and receives state snapshots over a WebSocket
  relay served by `@workspace/api-server` at `/ws/pool`.

## Layout

- `src/lib/physics.ts` — deterministic ball simulation (`simulateShot`).
- `src/lib/rules.ts` — 8-ball rule resolution (`applyShotResult`).
- `src/lib/bot.ts` — basic ghost-ball CPU.
- `src/lib/network.ts` — WebSocket client for the pool relay.
- `src/components/PoolGame.tsx` — canvas + game loop + per-mode wiring.
- `src/pages/{MainMenu,Practice,LocalTwoPlayer,HostGame,JoinGame,Settings}.tsx`
  — top-level screens.

## Build & dev

This artifact is a Vite app and is wired into the workspace through
`artifact.toml`. The dev server is started by the `artifacts/pool: web`
workflow.

`vite.config.ts` reads `PORT` and `BASE_PATH` from the environment — these
are injected by the Replit artifact runtime. To run/build the app outside
that runtime (e.g. plain CI or a local clone) you must export them
yourself, e.g.:

```bash
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/pool run build
```

## Online play details

- The host caches its latest authoritative state in `latestStateRef` and
  re-broadcasts on guest (re)connect. The guest also explicitly requests a
  snapshot via `{kind:"stateRequest"}` after joining, so a fresh browser
  session can drop into a mid-flight match seamlessly.
- The host validates incoming shot intents before simulating: rejects
  non-finite `angle`/`power`, clamps `power` to `[0.05, 1]`, and snaps any
  guest-supplied `cuePlacement` to a legal in-bounds spot via
  `findFreeSpot` (only honoured when the host's state has `ballInHand`).
- A "peer disconnected" banner appears on either side when the other
  party briefly drops; PoolGame stays mounted so the match resumes
  in-place when they reconnect.
- The relay (`api-server/src/lib/poolRoom.ts`) lets a fresh client take
  over a disconnected slot, so reopening a join link in a new browser
  rejoins the same room instead of returning "Room is full".
