import type { Ball, GameState, Shot, ShotEvents, Vec2 } from "./types";

// =====================================================================
// Pool table geometry & physics constants
// =====================================================================
// All units are abstract pixels in a fixed logical coordinate space.
// The renderer scales this to fit the screen. A 2:1 aspect ratio
// matches a real 8-ball table.

export const TABLE_WIDTH = 1000;
export const TABLE_HEIGHT = 500;
export const RAIL = 28; // distance from edge to playable cushion
export const PLAY_LEFT = RAIL;
export const PLAY_RIGHT = TABLE_WIDTH - RAIL;
export const PLAY_TOP = RAIL;
export const PLAY_BOTTOM = TABLE_HEIGHT - RAIL;
export const PLAY_WIDTH = PLAY_RIGHT - PLAY_LEFT;
export const PLAY_HEIGHT = PLAY_BOTTOM - PLAY_TOP;

export const BALL_RADIUS = 12;
export const POCKET_RADIUS = 22;

export const POCKETS: Vec2[] = [
  { x: PLAY_LEFT, y: PLAY_TOP },
  { x: TABLE_WIDTH / 2, y: PLAY_TOP - 6 },
  { x: PLAY_RIGHT, y: PLAY_TOP },
  { x: PLAY_LEFT, y: PLAY_BOTTOM },
  { x: TABLE_WIDTH / 2, y: PLAY_BOTTOM + 6 },
  { x: PLAY_RIGHT, y: PLAY_BOTTOM },
];

const FRICTION = 0.985; // per physics tick at 60 Hz
const MIN_SPEED = 0.05; // below this, snap to zero
const RESTITUTION_BALL = 0.95;
const RESTITUTION_RAIL = 0.78;
const MAX_LAUNCH_SPEED = 28; // logical units / tick at full power
const PHYSICS_DT = 1; // virtual ticks; we use a fixed iteration loop
const MAX_TICKS = 6000; // safety cap (~100s at 60Hz)

// Sub-stepping: we move by small fractional steps inside each tick to avoid
// tunnelling at high speeds.
const SUBSTEPS = 4;

// =====================================================================
// Vector helpers
// =====================================================================

function v(x: number, y: number): Vec2 {
  return { x, y };
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function lenSq(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

function len(a: Vec2): number {
  return Math.sqrt(lenSq(a));
}

function distSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt(distSq(a, b));
}

// =====================================================================
// Standard 8-ball rack
// =====================================================================

export function makeInitialBalls(): Ball[] {
  const balls: Ball[] = [];
  // Cue ball on the head spot (left quarter)
  balls.push({
    id: 0,
    pos: v(PLAY_LEFT + PLAY_WIDTH * 0.25, TABLE_HEIGHT / 2),
    vel: v(0, 0),
    inPocket: false,
  });

  // Standard 8-ball racking pattern at the foot spot. Apex at row 0.
  // The 8 ball goes in the center of the rack (row 2, col 1 of a 5-row tri).
  const apexX = PLAY_LEFT + PLAY_WIDTH * 0.72;
  const apexY = TABLE_HEIGHT / 2;
  const dx = BALL_RADIUS * 2 * 0.866; // hex spacing
  const dy = BALL_RADIUS * 2;

  // A typical legal rack: solids and stripes alternated, 8 in the middle,
  // a solid in one back corner, a stripe in the other. Order shown below.
  // Row positions (row, slot)
  type RackEntry = { row: number; slot: number; id: number };
  const rack: RackEntry[] = [
    { row: 0, slot: 0, id: 1 }, // apex must be a solid (commonly the 1)
    { row: 1, slot: 0, id: 9 },
    { row: 1, slot: 1, id: 2 },
    { row: 2, slot: 0, id: 10 },
    { row: 2, slot: 1, id: 8 }, // 8 in the middle of the rack
    { row: 2, slot: 2, id: 3 },
    { row: 3, slot: 0, id: 11 },
    { row: 3, slot: 1, id: 4 },
    { row: 3, slot: 2, id: 12 },
    { row: 3, slot: 3, id: 5 },
    { row: 4, slot: 0, id: 6 }, // back corner solid
    { row: 4, slot: 1, id: 13 },
    { row: 4, slot: 2, id: 7 },
    { row: 4, slot: 3, id: 14 },
    { row: 4, slot: 4, id: 15 }, // back corner stripe
  ];

  for (const entry of rack) {
    const x = apexX + entry.row * dx;
    const y = apexY + (entry.slot - entry.row / 2) * dy;
    balls.push({ id: entry.id, pos: v(x, y), vel: v(0, 0), inPocket: false });
  }

  return balls;
}

// =====================================================================
// Geometry helpers
// =====================================================================

export function isInsidePlayArea(p: Vec2): boolean {
  return (
    p.x >= PLAY_LEFT + BALL_RADIUS &&
    p.x <= PLAY_RIGHT - BALL_RADIUS &&
    p.y >= PLAY_TOP + BALL_RADIUS &&
    p.y <= PLAY_BOTTOM - BALL_RADIUS
  );
}

/**
 * Find a free position near the requested point that doesn't overlap any
 * other ball. Used for cue-ball placement (ball-in-hand).
 */
export function findFreeSpot(state: GameState, target: Vec2): Vec2 {
  const balls = state.balls.filter((b) => b.id !== 0 && !b.inPocket);
  function overlaps(p: Vec2): boolean {
    if (!isInsidePlayArea(p)) return true;
    for (const b of balls) {
      if (distSq(b.pos, p) < (BALL_RADIUS * 2) ** 2) return true;
    }
    return false;
  }
  if (!overlaps(target)) return target;
  for (let r = 4; r <= 200; r += 4) {
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2;
      const p = { x: target.x + Math.cos(a) * r, y: target.y + Math.sin(a) * r };
      if (!overlaps(p)) return p;
    }
  }
  // Fallback: head spot
  return { x: PLAY_LEFT + PLAY_WIDTH * 0.25, y: TABLE_HEIGHT / 2 };
}

// =====================================================================
// Physics step
// =====================================================================

function pocketContains(p: Vec2): boolean {
  for (const k of POCKETS) {
    if (distSq(p, k) < POCKET_RADIUS * POCKET_RADIUS) return true;
  }
  return false;
}

interface StepResult {
  cushionHits: number; // total cushion hits this tick (any ball)
  collisions: { a: number; b: number }[]; // ball-ball collisions
  pocketed: number[]; // ball ids pocketed
}

function stepBalls(balls: Ball[], frictionPerTick: number): StepResult {
  const result: StepResult = { cushionHits: 0, collisions: [], pocketed: [] };

  for (let s = 0; s < SUBSTEPS; s += 1) {
    const sdt = PHYSICS_DT / SUBSTEPS;

    // Move
    for (const b of balls) {
      if (b.inPocket) continue;
      b.pos.x += b.vel.x * sdt;
      b.pos.y += b.vel.y * sdt;
    }

    // Pocket capture (check before cushion bounce so balls falling into a
    // corner pocket don't ping off the rail first)
    for (const b of balls) {
      if (b.inPocket) continue;
      if (pocketContains(b.pos)) {
        b.inPocket = true;
        b.vel.x = 0;
        b.vel.y = 0;
        result.pocketed.push(b.id);
      }
    }

    // Rail collisions
    for (const b of balls) {
      if (b.inPocket) continue;
      let hit = false;
      if (b.pos.x < PLAY_LEFT + BALL_RADIUS) {
        b.pos.x = PLAY_LEFT + BALL_RADIUS;
        b.vel.x = -b.vel.x * RESTITUTION_RAIL;
        hit = true;
      } else if (b.pos.x > PLAY_RIGHT - BALL_RADIUS) {
        b.pos.x = PLAY_RIGHT - BALL_RADIUS;
        b.vel.x = -b.vel.x * RESTITUTION_RAIL;
        hit = true;
      }
      if (b.pos.y < PLAY_TOP + BALL_RADIUS) {
        b.pos.y = PLAY_TOP + BALL_RADIUS;
        b.vel.y = -b.vel.y * RESTITUTION_RAIL;
        hit = true;
      } else if (b.pos.y > PLAY_BOTTOM - BALL_RADIUS) {
        b.pos.y = PLAY_BOTTOM - BALL_RADIUS;
        b.vel.y = -b.vel.y * RESTITUTION_RAIL;
        hit = true;
      }
      if (hit) result.cushionHits += 1;
    }

    // Ball-ball collisions
    for (let i = 0; i < balls.length; i += 1) {
      const a = balls[i]!;
      if (a.inPocket) continue;
      for (let j = i + 1; j < balls.length; j += 1) {
        const b = balls[j]!;
        if (b.inPocket) continue;
        const delta = sub(b.pos, a.pos);
        const distance = len(delta);
        const minDist = BALL_RADIUS * 2;
        if (distance > 0 && distance < minDist) {
          // Resolve overlap
          const overlap = minDist - distance;
          const nx = delta.x / distance;
          const ny = delta.y / distance;
          a.pos.x -= (nx * overlap) / 2;
          a.pos.y -= (ny * overlap) / 2;
          b.pos.x += (nx * overlap) / 2;
          b.pos.y += (ny * overlap) / 2;

          // Elastic collision along normal (equal masses)
          const va = a.vel.x * nx + a.vel.y * ny;
          const vb = b.vel.x * nx + b.vel.y * ny;
          if (va - vb > 0) {
            // approaching
            const e = RESTITUTION_BALL;
            const j1 = -(1 + e) * (va - vb) * 0.5; // m=1 for both
            a.vel.x += j1 * nx;
            a.vel.y += j1 * ny;
            b.vel.x -= j1 * nx;
            b.vel.y -= j1 * ny;
            result.collisions.push({ a: a.id, b: b.id });
          }
        }
      }
    }
  }

  // Apply friction once per tick
  for (const b of balls) {
    if (b.inPocket) continue;
    b.vel.x *= frictionPerTick;
    b.vel.y *= frictionPerTick;
    if (Math.abs(b.vel.x) < MIN_SPEED) b.vel.x = 0;
    if (Math.abs(b.vel.y) < MIN_SPEED) b.vel.y = 0;
  }

  return result;
}

function allStopped(balls: Ball[]): boolean {
  for (const b of balls) {
    if (b.inPocket) continue;
    if (b.vel.x !== 0 || b.vel.y !== 0) return false;
  }
  return true;
}

// =====================================================================
// Public API
// =====================================================================

export interface SimulateOptions {
  /** Multiplies the effective friction (lower table speed = more friction). */
  tableSpeed?: number;
}

/**
 * Pure deterministic simulation: applies a shot to a starting state,
 * runs the physics until all balls stop, returns the final state and
 * a summary of events that occurred. Does NOT mutate the input.
 *
 * The cue ball gets velocity = power * MAX_LAUNCH_SPEED in direction
 * (cos angle, sin angle). If `cuePlacement` is set on the shot the cue
 * ball is repositioned first.
 */
export function simulateShot(
  state: GameState,
  shot: Shot,
  opts: SimulateOptions = {},
): { finalState: GameState; events: ShotEvents } {
  // Deep clone balls
  const balls: Ball[] = state.balls.map((b) => ({
    id: b.id,
    pos: { x: b.pos.x, y: b.pos.y },
    vel: { x: 0, y: 0 },
    inPocket: b.inPocket,
  }));

  const cue = balls.find((b) => b.id === 0)!;

  if (shot.cuePlacement) {
    cue.inPocket = false;
    cue.pos.x = shot.cuePlacement.x;
    cue.pos.y = shot.cuePlacement.y;
  } else if (cue.inPocket) {
    // Caller should always supply a placement when cue is pocketed; fall back
    // to the head spot to avoid a hung simulation.
    cue.inPocket = false;
    cue.pos.x = PLAY_LEFT + PLAY_WIDTH * 0.25;
    cue.pos.y = TABLE_HEIGHT / 2;
  }

  const power = Math.max(0, Math.min(1, shot.power));
  const speed = power * MAX_LAUNCH_SPEED;
  cue.vel.x = Math.cos(shot.angle) * speed;
  cue.vel.y = Math.sin(shot.angle) * speed;

  const events: ShotEvents = {
    pocketed: [],
    firstContact: null,
    cueHitCushion: false,
    cushionAfterContact: false,
  };

  const tableSpeed = opts.tableSpeed ?? 1;
  // Higher table speed -> less friction. tableSpeed=1 -> 0.985 baseline.
  const friction = Math.min(0.999, 1 - (1 - FRICTION) / Math.max(0.4, tableSpeed));

  for (let tick = 0; tick < MAX_TICKS; tick += 1) {
    const result = stepBalls(balls, friction);

    // Track first contact
    if (events.firstContact === null) {
      for (const c of result.collisions) {
        if (c.a === 0 && c.b !== 0) {
          events.firstContact = c.b;
          break;
        }
        if (c.b === 0 && c.a !== 0) {
          events.firstContact = c.a;
          break;
        }
      }
    }

    if (result.cushionHits > 0) {
      events.cueHitCushion = true;
      if (events.firstContact !== null) {
        events.cushionAfterContact = true;
      }
    }

    for (const id of result.pocketed) {
      events.pocketed.push(id);
    }

    if (allStopped(balls)) break;
  }

  const finalState: GameState = {
    ...state,
    balls,
  };

  return { finalState, events };
}

/**
 * Returns the predicted endpoint of an aim line: where the cue ball would
 * first collide with another ball or a cushion if shot now (purely cosmetic
 * — used to draw the aim guide). Caller passes cue-ball position + aim
 * direction (unit vector).
 */
export function predictAimLine(
  state: GameState,
  cuePos: Vec2,
  dir: Vec2,
  maxLen = TABLE_WIDTH,
): Vec2 {
  // Trivial walk-and-step: not perfect but cheap and good enough for a guide.
  const balls = state.balls.filter(
    (b) => !b.inPocket && b.id !== 0,
  );
  let bestT = maxLen;

  // Collide with rails
  if (dir.x > 0) bestT = Math.min(bestT, (PLAY_RIGHT - BALL_RADIUS - cuePos.x) / dir.x);
  if (dir.x < 0) bestT = Math.min(bestT, (PLAY_LEFT + BALL_RADIUS - cuePos.x) / dir.x);
  if (dir.y > 0) bestT = Math.min(bestT, (PLAY_BOTTOM - BALL_RADIUS - cuePos.y) / dir.y);
  if (dir.y < 0) bestT = Math.min(bestT, (PLAY_TOP + BALL_RADIUS - cuePos.y) / dir.y);

  // Collide with each ball (ray-circle intersection, radius 2*r)
  const r2 = (BALL_RADIUS * 2) ** 2;
  for (const b of balls) {
    const m = sub(cuePos, b.pos);
    const bdir = dot(m, dir);
    const c = dot(m, m) - r2;
    if (c > 0 && bdir > 0) continue;
    const disc = bdir * bdir - c;
    if (disc < 0) continue;
    const t = -bdir - Math.sqrt(disc);
    if (t >= 0 && t < bestT) bestT = t;
  }

  bestT = Math.max(0, bestT);
  return { x: cuePos.x + dir.x * bestT, y: cuePos.y + dir.y * bestT };
}

export { dist, distSq };
