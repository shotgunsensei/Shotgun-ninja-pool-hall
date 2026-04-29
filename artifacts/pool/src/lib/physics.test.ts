import { describe, expect, test } from "vitest";
import {
  BALL_RADIUS,
  CUSHIONS,
  HEAD_SPOT,
  PLAY_BOTTOM,
  PLAY_LEFT,
  PLAY_RIGHT,
  PLAY_TOP,
  POCKETS,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  makeInitialBalls,
  simulateShot,
} from "./physics";
import { makeInitialGameState } from "./rules";
import type { Ball, GameState, Vec2 } from "./types";

// ---------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------

/**
 * Build a state containing only the cue ball (and any extra balls passed
 * in). All other rack balls are flagged as pocketed so the simulation
 * effectively ignores them.
 */
function makeCueOnlyState(extras: { id: number; pos: Vec2 }[] = []): GameState {
  const allBalls: Ball[] = makeInitialBalls();
  for (const b of allBalls) {
    if (b.id !== 0) {
      b.inPocket = true;
      b.pos = { x: -1000, y: -1000 };
    }
  }
  for (const extra of extras) {
    const existing = allBalls.find((x) => x.id === extra.id);
    if (existing) {
      existing.pos = { x: extra.pos.x, y: extra.pos.y };
      existing.vel = { x: 0, y: 0 };
      existing.inPocket = false;
    } else {
      allBalls.push({
        id: extra.id,
        pos: { x: extra.pos.x, y: extra.pos.y },
        vel: { x: 0, y: 0 },
        inPocket: false,
      });
    }
  }
  return makeInitialGameState(allBalls, ["A", "B"]);
}

function placeCue(state: GameState, pos: Vec2): void {
  const cue = state.balls.find((b) => b.id === 0);
  if (!cue) throw new Error("no cue ball");
  cue.pos = { x: pos.x, y: pos.y };
  cue.inPocket = false;
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function isAxisAligned(a: Vec2, b: Vec2): boolean {
  return a.x === b.x || a.y === b.y;
}

// ---------------------------------------------------------------------
// Cushion geometry
// ---------------------------------------------------------------------

describe("cushion geometry", () => {
  test("every cushion segment has a unit-length normal perpendicular to its direction", () => {
    expect(CUSHIONS.length).toBeGreaterThan(0);
    for (const seg of CUSHIONS) {
      const nLen = Math.hypot(seg.n.x, seg.n.y);
      expect(nLen).toBeCloseTo(1, 6);
      const dx = seg.b.x - seg.a.x;
      const dy = seg.b.y - seg.a.y;
      const dirLen = Math.hypot(dx, dy);
      expect(dirLen).toBeGreaterThan(0);
      const ux = dx / dirLen;
      const uy = dy / dirLen;
      const dot = seg.n.x * ux + seg.n.y * uy;
      expect(Math.abs(dot)).toBeLessThan(1e-6);
    }
  });

  test("each straight rail segment normal points toward the table interior", () => {
    const center: Vec2 = { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT / 2 };
    let straightCount = 0;
    for (const seg of CUSHIONS) {
      if (!isAxisAligned(seg.a, seg.b)) continue;
      straightCount += 1;
      const mid = midpoint(seg.a, seg.b);
      const towardCenter = { x: center.x - mid.x, y: center.y - mid.y };
      const dot = seg.n.x * towardCenter.x + seg.n.y * towardCenter.y;
      expect(dot).toBeGreaterThan(0);
    }
    // top split into 2, bottom split into 2, plus full left + full right = 6.
    expect(straightCount).toBe(6);
  });

  test("each angled jaw normal aligns with its pocket's funnel direction", () => {
    // For every non-axis-aligned (jaw) segment, stepping from the segment
    // midpoint along +normal must move CLOSER to the nearest visual pocket
    // center — that is the geometric definition of a funnel jaw, and it
    // is what guarantees a glancing hit gets pushed *into* the throat
    // rather than launched back across the table.
    let jawCount = 0;
    for (const seg of CUSHIONS) {
      if (isAxisAligned(seg.a, seg.b)) continue;
      jawCount += 1;
      const mid = midpoint(seg.a, seg.b);
      let nearest = POCKETS[0]!;
      let bestD = Infinity;
      for (const p of POCKETS) {
        const d = (p.x - mid.x) ** 2 + (p.y - mid.y) ** 2;
        if (d < bestD) {
          bestD = d;
          nearest = p;
        }
      }
      const before = (mid.x - nearest.x) ** 2 + (mid.y - nearest.y) ** 2;
      const probe: Vec2 = { x: mid.x + 4 * seg.n.x, y: mid.y + 4 * seg.n.y };
      const after = (probe.x - nearest.x) ** 2 + (probe.y - nearest.y) ** 2;
      expect(after).toBeLessThan(before);
    }
    // Two jaws per pocket × 6 pockets = 12.
    expect(jawCount).toBe(12);
  });
});

// ---------------------------------------------------------------------
// Cushion bounce behaviour
// ---------------------------------------------------------------------

describe("cushion bounce behaviour", () => {
  // NOTE: x = TABLE_WIDTH/2 lines up with the top/bottom side pockets,
  // so any straight-up or straight-down test from that x coordinate is
  // a side-pocket sink, not a rail bounce. We deliberately use an
  // off-centre x for top/bottom rail tests.
  const OFF_CENTRE_X = 250;
  const RAIL_POWER = 0.18; // strong enough to definitely hit the rail
  // and bounce back past the start, but light enough to settle before
  // hitting the opposite rail.

  test("a ball aimed straight at the top rail bounces back toward the centre", () => {
    const state = makeCueOnlyState();
    placeCue(state, { x: OFF_CENTRE_X, y: 200 });
    const result = simulateShot(state, {
      angle: -Math.PI / 2, // straight up
      power: RAIL_POWER,
    });
    expect(result.events.cueHitCushion).toBe(true);
    expect(result.events.pocketed).not.toContain(0);
    const cue = result.finalState.balls.find((b) => b.id === 0)!;
    // Bounced off the top rail and rolled back past the start row.
    expect(cue.pos.y).toBeGreaterThan(200);
  });

  test("a ball aimed straight at the bottom rail bounces back upward", () => {
    const state = makeCueOnlyState();
    placeCue(state, { x: OFF_CENTRE_X, y: TABLE_HEIGHT - 200 });
    const result = simulateShot(state, {
      angle: Math.PI / 2, // straight down
      power: RAIL_POWER,
    });
    expect(result.events.cueHitCushion).toBe(true);
    expect(result.events.pocketed).not.toContain(0);
    const cue = result.finalState.balls.find((b) => b.id === 0)!;
    expect(cue.pos.y).toBeLessThan(TABLE_HEIGHT - 200);
  });

  test("a ball aimed straight at the left rail bounces back rightward", () => {
    const state = makeCueOnlyState();
    placeCue(state, { x: 300, y: TABLE_HEIGHT / 2 });
    const result = simulateShot(state, {
      angle: Math.PI, // straight left
      power: RAIL_POWER,
    });
    expect(result.events.cueHitCushion).toBe(true);
    expect(result.events.pocketed).not.toContain(0);
    const cue = result.finalState.balls.find((b) => b.id === 0)!;
    expect(cue.pos.x).toBeGreaterThan(300);
  });

  test("a ball aimed straight at the right rail bounces back leftward", () => {
    const state = makeCueOnlyState();
    placeCue(state, { x: TABLE_WIDTH - 300, y: TABLE_HEIGHT / 2 });
    const result = simulateShot(state, {
      angle: 0, // straight right
      power: RAIL_POWER,
    });
    expect(result.events.cueHitCushion).toBe(true);
    expect(result.events.pocketed).not.toContain(0);
    const cue = result.finalState.balls.find((b) => b.id === 0)!;
    expect(cue.pos.x).toBeLessThan(TABLE_WIDTH - 300);
  });

  test("a corner-jaw rattle: a ball driven diagonally into a top-left jaw is not silently pocketed", () => {
    // Ball inside the play area heading at a glancing angle toward a
    // top-left corner jaw face. Without throat-gating + jaw collisions
    // running BEFORE the radial pocket capture check, the ball would
    // tunnel through the jaw and be auto-captured. With the new
    // physics it must register a cushion hit (the jaw) and survive.
    const state = makeCueOnlyState();
    placeCue(state, { x: PLAY_LEFT + 90, y: PLAY_TOP + 22 });
    // Aim toward a point just past the top-left jaw — a path that grazes
    // the top jaw on its way in.
    const target = { x: PLAY_LEFT - 15, y: PLAY_TOP - 5 };
    const dx = target.x - (PLAY_LEFT + 90);
    const dy = target.y - (PLAY_TOP + 22);
    const angle = Math.atan2(dy, dx);
    const result = simulateShot(state, { angle, power: 0.35 });
    // Either it cushioned (rattled) or it legally fell through the throat,
    // but the simulation must not silently warp it through a jaw without
    // running the cushion collision pass at all.
    expect(result.events.cueHitCushion).toBe(true);
  });

  test("a ball placed in the corner area outside the throat is not auto-captured at rest", () => {
    // Throat-gated capture: a ball center sitting at the pocket's
    // corner-most legal play position must NOT register as pocketed
    // when no shot is taken. (It would be captured under the OLD radial
    // gate that did not account for the rail line.)
    const state = makeCueOnlyState();
    placeCue(state, {
      x: PLAY_LEFT + BALL_RADIUS + 1,
      y: PLAY_TOP + BALL_RADIUS + 1,
    });
    const result = simulateShot(state, {
      angle: 0,
      power: 0, // do nothing
    });
    expect(result.events.pocketed).not.toContain(0);
    const cue = result.finalState.balls.find((b) => b.id === 0)!;
    expect(cue.inPocket).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Spin physics: follow / draw / stun
// ---------------------------------------------------------------------

describe("spin physics", () => {
  // Straight head-on shot: cue ball at (200, 250), object ball at
  // (600, 250). We assert spin behaviour by examining the cue ball's
  // position a small fixed number of ticks AFTER the first ball-ball
  // contact, before any rail bounce / re-collision noise can muddy the
  // comparison. (Asserting on the final resting position is unreliable
  // here because the cue often re-collides with the object ball as
  // both travel down the table after contact.)
  const CUE_X = 200;
  const Y = 250;
  const OBJ_X = 600;
  const CONTACT_X = OBJ_X - 2 * BALL_RADIUS; // = 576
  const POWER = 0.5;
  const TICKS_AFTER_CONTACT = 30; // ~half a second

  function setupHeadOn(): GameState {
    const state = makeCueOnlyState([{ id: 1, pos: { x: OBJ_X, y: Y } }]);
    placeCue(state, { x: CUE_X, y: Y });
    return state;
  }

  function cueXShortlyAfterContact(tipY: number): number {
    const state = setupHeadOn();
    const result = simulateShot(
      state,
      { angle: 0, power: POWER, tipOffset: { x: 0, y: tipY } },
      { recordFrames: true, frameInterval: 1 },
    );
    expect(result.events.firstContact).toBe(1);
    expect(result.firstContactTick).not.toBeNull();
    const target = result.firstContactTick! + TICKS_AFTER_CONTACT;
    const frame = result.frames.find((f) => f.tick === target);
    expect(frame, `missing frame at tick ${target}`).toBeDefined();
    return frame!.positions.find((p) => p.id === 0)!.x;
  }

  test("top-spin (follow) drives the cue ball past the contact point after impact", () => {
    // tipOffset.y = -1 → tip on top edge of cue ball → follow.
    const followX = cueXShortlyAfterContact(-1);
    expect(followX).toBeGreaterThan(CONTACT_X + 2 * BALL_RADIUS);
  });

  test("back-spin (draw) pulls the cue ball behind the contact point after impact", () => {
    // tipOffset.y = +1 → tip on bottom edge of cue ball → draw.
    const drawX = cueXShortlyAfterContact(+1);
    expect(drawX).toBeLessThan(CONTACT_X - 2 * BALL_RADIUS);
  });

  test("follow ends up clearly ahead of natural-roll, and natural-roll ahead of draw", () => {
    const followX = cueXShortlyAfterContact(-1);
    const naturalX = cueXShortlyAfterContact(0);
    const drawX = cueXShortlyAfterContact(+1);
    // Strict ordering with margin large enough to detect a regression
    // that flattens the spin model into a single "no spin" behaviour.
    expect(followX - naturalX).toBeGreaterThan(BALL_RADIUS);
    expect(naturalX - drawX).toBeGreaterThan(BALL_RADIUS);
  });
});

// ---------------------------------------------------------------------
// Sanity: makeInitialBalls and HEAD_SPOT
// ---------------------------------------------------------------------

describe("rack and table layout sanity", () => {
  test("makeInitialBalls puts the cue ball on the head spot", () => {
    const balls = makeInitialBalls();
    const cue = balls.find((b) => b.id === 0)!;
    expect(cue.pos.x).toBeCloseTo(HEAD_SPOT.x, 6);
    expect(cue.pos.y).toBeCloseTo(HEAD_SPOT.y, 6);
    expect(cue.inPocket).toBe(false);
  });

  test("a full rack contains all 16 balls and none start in a pocket", () => {
    const balls = makeInitialBalls();
    expect(balls.length).toBe(16);
    for (const b of balls) {
      expect(b.inPocket).toBe(false);
      expect(b.pos.x).toBeGreaterThanOrEqual(PLAY_LEFT);
      expect(b.pos.x).toBeLessThanOrEqual(PLAY_RIGHT);
      expect(b.pos.y).toBeGreaterThanOrEqual(PLAY_TOP);
      expect(b.pos.y).toBeLessThanOrEqual(PLAY_BOTTOM);
    }
  });
});
