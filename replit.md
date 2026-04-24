# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

- **api-server** (`artifacts/api-server`) — Express 5 + WebSocket. Exposes `/api/*` and `/ws/pool` (pool relay).
- **mockup-sandbox** (`artifacts/mockup-sandbox`) — Vite preview server for design exploration.
- **pool** (`artifacts/pool`) — **Shotgun Ninjas Pool Hall**, a mobile-first 8-ball pool React/Canvas web app (PWA-installable), themed after Shotgun Ninjas Productions (black + crimson, bold uppercase, tactical `SYS::` accents, ninja-headbanded 8-ball logo, deep-wine felt). Modes: Practice (Free shoot or vs basic CPU), Local 2-player (hot-seat), Online Room (host-authoritative WebSocket via api-server's `/ws/pool`).
  - Routes: `/`, `/practice`, `/local`, `/host`, `/join`, `/settings`.
  - Lib: `physics.ts` (deterministic ball sim), `rules.ts` (8-ball rules), `bot.ts` (basic CPU), `network.ts` (WS client), `audio.ts` (procedural SFX), `settings.ts` (localStorage).
  - Game state is host-authoritative for online play: guest sends `shot` intents, host runs simulation + broadcasts `state` snapshots; guest auto-requests state on join for mid-game reconnects.
