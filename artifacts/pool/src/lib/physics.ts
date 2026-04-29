import type { Ball, GameState, Shot, ShotEvents, Vec2 } from "./types";

// =====================================================================
// Pool table geometry & physics constants
// =====================================================================
// Logical units = pixels in a fixed coordinate space scaled by the
// renderer. The 2:1 aspect (1000 x 500) matches a regulation 8-ball
// table: the 50" x 100" play area on a 9-foot table.
//
// Real-world references used to size things:
//   ball diameter  ≈ 2 1/4"   → BALL_RADIUS = 12 (one unit ≈ 0.094")
//   corner mouth   ≈ 4.5"     → ratio 2.0x ball diameter
//   side mouth     ≈ 5.0"     → ratio 2.22x ball diameter
//   diamond pitch  every 12.5" of long rail (8 segments / 7 diamonds)

export const TABLE_WIDTH = 1000;
export const TABLE_HEIGHT = 500;

/** Outer cushion thickness (visual). Play area inset by this much. */
export const RAIL = 28;
export const PLAY_LEFT = RAIL;
export const PLAY_RIGHT = TABLE_WIDTH - RAIL;
export const PLAY_TOP = RAIL;
export const PLAY_BOTTOM = TABLE_HEIGHT - RAIL;
export const PLAY_WIDTH = PLAY_RIGHT - PLAY_LEFT;
export const PLAY_HEIGHT = PLAY_BOTTOM - PLAY_TOP;

export const BALL_RADIUS = 12;

// ----- Pocket geometry --------------------------------------------------
// Mouth widths between the cushion noses. Real WPA: corner ≈ 2.0x ball,
// side ≈ 2.22x. We use slightly more generous values to keep the touch
// experience approachable.
export const CORNER_MOUTH = BALL_RADIUS * 4.4;
export const SIDE_MOUTH = BALL_RADIUS * 4.8;

/** Length of each angled cushion "jaw" segment along its rail axis. */
export const JAW_LEN = BALL_RADIUS * 2.4;
/** How far the jaw cuts back into the rail (perpendicular to it). */
const JAW_BACK = JAW_LEN * 0.55;

/** Past this many units along the rail from a corner pocket, the
 *  straight rail is suppressed and only the angled jaws apply. */
export const CORNER_RAIL_WINDOW = JAW_LEN;
/** Half-width of the side pocket "window" along its rail. */
export const SIDE_RAIL_WINDOW = SIDE_MOUTH / 2 + 2;

/** Visual radius of the pocket hole drawn by the renderer. */
export const POCKET_RADIUS = BALL_RADIUS * 1.95;
/** A ball's center must cross within this radius to be captured. */
export const POCKET_CAPTURE_RADIUS = BALL_RADIUS * 1.55;

/** "Head string" x-coordinate. Used by the rules engine for
 *  behind-the-head-string ball-in-hand after a break-shot scratch. */
export const HEAD_STRING_X = PLAY_LEFT + PLAY_WIDTH * 0.25;
/** Foot-spot location — the apex of the rack. */
export const FOOT_SPOT: Vec2 = {
  x: PLAY_LEFT + PLAY_WIDTH * 0.72,
  y: TABLE_HEIGHT / 2,
};
/** Head-spot location — default cue ball position at break time. */
export const HEAD_SPOT: Vec2 = {
  x: HEAD_STRING_X,
  y: TABLE_HEIGHT / 2,
};

/** Visual / aim centers of the six pockets. Used by the renderer,
 *  the bot's pot-target picker, the called-pocket UI and the rules
 *  engine. NOT used directly for capture — see
 *  {@link POCKET_CAPTURE_CENTERS} below. */
export const POCKETS: Vec2[] = [
  { x: PLAY_LEFT, y: PLAY_TOP },
  { x: TABLE_WIDTH / 2, y: PLAY_TOP - 6 },
  { x: PLAY_RIGHT, y: PLAY_TOP },
  { x: PLAY_LEFT, y: PLAY_BOTTOM },
  { x: TABLE_WIDTH / 2, y: PLAY_BOTTOM + 6 },
  { x: PLAY_RIGHT, y: PLAY_BOTTOM },
];

/** Throat-gated capture centers — used ONLY by the simulation when
 *  deciding whether a ball has fallen into a pocket. For the four
 *  corner pockets we shift the capture circle BEHIND the rail by
 *  ~half a jaw-back, so that a ball center sitting tight against
 *  both rails near a corner (which is geometrically reachable for a
 *  ball-in-hand placement, but is NOT in the pocket throat) is no
 *  longer auto-captured. The radial check, combined with running
 *  cushion / jaw collisions BEFORE the capture check, is what now
 *  delivers throat-gated pocketing: balls that catch a jaw on the
 *  way in will rattle or kick out instead of being silently sunk.
 *  Side pockets already sit OUTSIDE the rail line so no shift is
 *  applied. */
const CORNER_CAPTURE_OFFSET = JAW_BACK * 0.5;
export const POCKET_CAPTURE_CENTERS: Vec2[] = [
  { x: PLAY_LEFT - CORNER_CAPTURE_OFFSET, y: PLAY_TOP - CORNER_CAPTURE_OFFSET },
  { x: TABLE_WIDTH / 2, y: PLAY_TOP - 6 },
  { x: PLAY_RIGHT + CORNER_CAPTURE_OFFSET, y: PLAY_TOP - CORNER_CAPTURE_OFFSET },
  { x: PLAY_LEFT - CORNER_CAPTURE_OFFSET, y: PLAY_BOTTOM + CORNER_CAPTURE_OFFSET },
  { x: TABLE_WIDTH / 2, y: PLAY_BOTTOM + 6 },
  { x: PLAY_RIGHT + CORNER_CAPTURE_OFFSET, y: PLAY_BOTTOM + CORNER_CAPTURE_OFFSET },
];

// ----- Physics tunables -------------------------------------------------
const RESTITUTION_BALL = 0.95;
/** Reference rail restitution. The actual coefficient is speed-dependent
 *  (see {@link railRestitution}) so soft rolls bounce livelier than slams. */
export const RESTITUTION_RAIL = 0.78;

/** Velocity decay per tick once the ball is in the rolling phase.
 *  Bumped slightly versus the original feel-tuned value so that long,
 *  low-power shots don't coast forever now that the slide-to-roll
 *  transition (see {@link SLIDE_LINEAR_SHARE}) leaves the cue with the
 *  full physical 5/7·v₀ instead of the ~0.63·v₀ produced by the old
 *  asymmetric impulse split. */
const ROLL_FRICTION = 0.991;
/** Per-tick reduction of the contact-patch slip magnitude during the
 *  sliding phase. The slip impulse is shared between linear deceleration
 *  ({@link SLIDE_LINEAR_SHARE}) and spin acceleration
 *  ({@link SLIDE_SPIN_SHARE}); together they sum to 1, so this constant
 *  is exactly how fast `|vel - spin|` shrinks per tick. Tuned so a hard
 *  break still settles into rolling within ~20 ticks. */
const SLIDE_DECEL_PER_TICK = 0.45;
/** Slip magnitude below which the ball is treated as fully rolling. */
const ROLL_SNAP_SLIP = 0.05;

// --- Slide-to-roll friction split (uniform sphere, I = 2/5·m·r²) ------
// Kinetic friction at the contact patch produces a force F = µ·m·g
// acting opposite to the slip vector. For a uniform sphere this gives:
//   d|vel|/dt   = -µg                   (linear deceleration)
//   d|spin|/dt  = +µg · (m·r²)/I = +(5/2)·µg   (spin = ω·r catches up)
//   d|slip|/dt  = -(7/2)·µg
// So per unit of slip reduction, the impulse splits 2/7 into linear loss
// and 5/7 into spin gain. A "stun" cue (spin₀ = 0) therefore settles to
// |vel| = (1 − 2/7)·v₀ = 5/7·v₀ — the canonical slide-to-roll result.
const SLIDE_LINEAR_SHARE = 2 / 7;
const SLIDE_SPIN_SHARE = 5 / 7;

// --- Side-spin (English) decay ---------------------------------------
// Sidespin is mostly preserved on the cloth and bleeds off at rails and
// on object-ball contact. The per-tick decay used to be 0.985, which let
// stun shots with English carry too much sidespin into the first contact
// (e.g. ~22% remaining after 100 ticks). Tightened to 0.98, which is
// closer to what real footage shows for short-distance finesse shots.
const SIDESPIN_DECAY_PER_TICK = 0.98;
/** Multiplicative loss of sidespin on each rail bounce. */
const SIDESPIN_RAIL_RETENTION = 0.65;

const MIN_SPEED = 0.05; // below this, snap to zero
export const MAX_LAUNCH_SPEED = 38; // logical units / tick at full power

const PHYSICS_DT = 1; // virtual ticks; we use a fixed iteration loop
const MAX_TICKS = 6000; // safety cap (~100s at 60Hz)
/** One simulation tick = 1/60 s of game time. Used to convert tick
 *  numbers to wall-clock playback time. */
export const SIM_TICK_MS = 1000 / 60;

// Adaptive sub-stepping bounds. Each substep moves the fastest ball at
// most ~SUBSTEP_MAX_TRAVEL units to avoid tunnelling. SUBSTEPS_MIN keeps
// slow shots stable; SUBSTEPS_MAX caps cost on a hard break.
const SUBSTEPS_MIN = 4;
const SUBSTEPS_MAX = 16;
const SUBSTEP_MAX_TRAVEL = BALL_RADIUS * 0.6;

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
// Cushion segments (with angled pocket jaws)
// =====================================================================
// Each cushion is a line segment with an inward-facing unit normal.
// The straight rails are split around each pocket window so balls travel
// freely through the throats. Inside the pocket window we add two
// angled jaws that funnel/rattle the ball realistically.

interface Segment {
  a: Vec2;
  b: Vec2;
  n: Vec2; // unit normal pointing into the play area
}

function rail(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  nx: number,
  ny: number,
): Segment {
  const m = Math.hypot(nx, ny) || 1;
  return { a: v(ax, ay), b: v(bx, by), n: v(nx / m, ny / m) };
}

function angledJaw(a: Vec2, b: Vec2, inwardHint: Vec2): Segment {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Two perpendicular candidates; pick the one pointing inward.
  const c1x = dy;
  const c1y = -dx;
  const dotV = c1x * inwardHint.x + c1y * inwardHint.y;
  const nx = dotV >= 0 ? c1x : -c1x;
  const ny = dotV >= 0 ? c1y : -c1y;
  const m = Math.hypot(nx, ny) || 1;
  return { a: { ...a }, b: { ...b }, n: v(nx / m, ny / m) };
}

export const CUSHIONS: Segment[] = (() => {
  const list: Segment[] = [];
  const midX = TABLE_WIDTH / 2;
  const tR = PLAY_TOP;
  const bR = PLAY_BOTTOM;
  const lR = PLAY_LEFT;
  const rR = PLAY_RIGHT;

  // Straight rail segments (split around pocket windows) ----------
  // Top rail (normal pointing down, into play)
  list.push(rail(lR + CORNER_RAIL_WINDOW, tR, midX - SIDE_RAIL_WINDOW, tR, 0, 1));
  list.push(rail(midX + SIDE_RAIL_WINDOW, tR, rR - CORNER_RAIL_WINDOW, tR, 0, 1));
  // Bottom rail (normal up)
  list.push(rail(lR + CORNER_RAIL_WINDOW, bR, midX - SIDE_RAIL_WINDOW, bR, 0, -1));
  list.push(rail(midX + SIDE_RAIL_WINDOW, bR, rR - CORNER_RAIL_WINDOW, bR, 0, -1));
  // Left rail (normal right)
  list.push(rail(lR, tR + CORNER_RAIL_WINDOW, lR, bR - CORNER_RAIL_WINDOW, 1, 0));
  // Right rail (normal left)
  list.push(rail(rR, tR + CORNER_RAIL_WINDOW, rR, bR - CORNER_RAIL_WINDOW, -1, 0));

  // Corner jaws — two angled jaws per corner -----------------------
  function corner(cx: number, cy: number, sx: number, sy: number): void {
    // Jaw on the horizontal rail: starts at (cx + sx*window, cy),
    // angles back toward the corner pocket throat.
    const a1 = v(cx + sx * CORNER_RAIL_WINDOW, cy);
    const b1 = v(cx + sx * (CORNER_RAIL_WINDOW - JAW_BACK), cy - sy * JAW_BACK);
    list.push(angledJaw(a1, b1, v(0, sy)));

    // Jaw on the vertical rail: mirrored.
    const a2 = v(cx, cy + sy * CORNER_RAIL_WINDOW);
    const b2 = v(cx - sx * JAW_BACK, cy + sy * (CORNER_RAIL_WINDOW - JAW_BACK));
    list.push(angledJaw(a2, b2, v(sx, 0)));
  }
  corner(lR, tR, +1, +1);
  corner(rR, tR, -1, +1);
  corner(lR, bR, +1, -1);
  corner(rR, bR, -1, -1);

  // Side pocket jaws -----------------------------------------------
  function side(cx: number, cy: number, sy: number): void {
    const half = SIDE_RAIL_WINDOW;
    const back = JAW_BACK * 0.85;
    const inset = JAW_BACK * 0.65;

    // Left jaw: from (cx - half, cy) angling slightly inward and back.
    const a1 = v(cx - half, cy);
    const b1 = v(cx - half + inset, cy - sy * back);
    list.push(angledJaw(a1, b1, v(0, sy)));

    // Right jaw: mirrored.
    const a2 = v(cx + half, cy);
    const b2 = v(cx + half - inset, cy - sy * back);
    list.push(angledJaw(a2, b2, v(0, sy)));
  }
  side(midX, tR, +1);
  side(midX, bR, -1);

  return list;
})();

// =====================================================================
// Standard 8-ball rack
// =====================================================================

export function makeInitialBalls(): Ball[] {
  const balls: Ball[] = [];
  // Cue ball on the head spot
  balls.push({
    id: 0,
    pos: { x: HEAD_SPOT.x, y: HEAD_SPOT.y },
    vel: v(0, 0),
    inPocket: false,
  });

  // Standard 8-ball racking pattern at the foot spot. Apex at row 0.
  // The 8 ball goes in the center of the rack (row 2, slot 1).
  const apexX = FOOT_SPOT.x;
  const apexY = FOOT_SPOT.y;
  const dx = BALL_RADIUS * 2 * 0.866; // hex spacing
  const dy = BALL_RADIUS * 2;

  type RackEntry = { row: number; slot: number; id: number };
  const rack: RackEntry[] = [
    { row: 0, slot: 0, id: 1 }, // apex must be a solid (commonly the 1)
    { row: 1, slot: 0, id: 9 },
    { row: 1, slot: 1, id: 2 },
    { row: 2, slot: 0, id: 10 },
    { row: 2, slot: 1, id: 8 }, // 8 in the middle
    { row: 2, slot: 2, id: 3 },
    { row: 3, slot: 0, id: 11 },
    { row: 3, slot: 1, id: 4 },
    { row: 3, slot: 2, id: 12 },
    { row: 3, slot: 3, id: 5 },
    { row: 4, slot: 0, id: 6 },
    { row: 4, slot: 1, id: 13 },
    { row: 4, slot: 2, id: 7 },
    { row: 4, slot: 3, id: 14 },
    { row: 4, slot: 4, id: 15 },
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

export function isBehindHeadString(p: Vec2): boolean {
  return p.x < HEAD_STRING_X;
}

/**
 * Find a free position near the requested point that doesn't overlap any
 * other ball. Used for cue-ball placement (ball-in-hand).
 *
 * `behindHeadString` constrains the search to x < HEAD_STRING_X (used
 * after a break-shot scratch).
 */
export function findFreeSpot(
  state: GameState,
  target: Vec2,
  behindHeadString = false,
): Vec2 {
  const balls = state.balls.filter((b) => b.id !== 0 && !b.inPocket);
  function overlaps(p: Vec2): boolean {
    if (!isInsidePlayArea(p)) return true;
    if (behindHeadString && p.x >= HEAD_STRING_X - 0.001) return true;
    for (const b of balls) {
      if (distSq(b.pos, p) < (BALL_RADIUS * 2) ** 2) return true;
    }
    return false;
  }
  // Constrain target if behind-head-string is required.
  let start = target;
  if (behindHeadString && start.x >= HEAD_STRING_X - BALL_RADIUS) {
    start = { x: HEAD_STRING_X - BALL_RADIUS - 1, y: start.y };
  }
  if (!overlaps(start)) return start;
  for (let r = 4; r <= 200; r += 4) {
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2;
      const p = { x: start.x + Math.cos(a) * r, y: start.y + Math.sin(a) * r };
      if (!overlaps(p)) return p;
    }
  }
  return { x: HEAD_SPOT.x, y: HEAD_SPOT.y };
}

/** Standard ball-spotting positions used to re-spot a pocketed object
 *  ball that should be returned to the table (e.g. 8-on-break). Spots
 *  along the long string from the foot spot toward the foot rail. */
export function findSpotPosition(state: GameState, preferred: Vec2 = FOOT_SPOT): Vec2 {
  const others = state.balls.filter((b) => !b.inPocket);
  function overlaps(p: Vec2): boolean {
    if (!isInsidePlayArea(p)) return true;
    for (const b of others) {
      if (distSq(b.pos, p) < (BALL_RADIUS * 2) ** 2 - 0.5) return true;
    }
    return false;
  }
  if (!overlaps(preferred)) return preferred;
  // Walk along the long string toward the foot rail.
  for (let dx = BALL_RADIUS * 2; dx <= PLAY_WIDTH; dx += BALL_RADIUS) {
    const p = { x: preferred.x + dx, y: preferred.y };
    if (!overlaps(p)) return p;
  }
  // Then back the other way.
  for (let dx = -BALL_RADIUS * 2; dx >= -PLAY_WIDTH; dx -= BALL_RADIUS) {
    const p = { x: preferred.x + dx, y: preferred.y };
    if (!overlaps(p)) return p;
  }
  return preferred;
}

// =====================================================================
// Speed-dependent rail restitution
// =====================================================================
// Lively at low speed (≈0.85), more energy loss at high speed (≈0.72).

function railRestitution(speed: number): number {
  const t = Math.min(1, speed / (MAX_LAUNCH_SPEED * 0.7));
  return 0.85 - 0.13 * t;
}

// =====================================================================
// Internal simulation ball — extends the public Ball with spin tracking
// =====================================================================
// `spin` is the velocity at the contact patch that pure rolling would
// produce. When `spin` ≠ `vel`, the ball is in the sliding phase and the
// kinetic friction acts to drive `spin` → `vel`. Once they match, the
// ball is rolling and only the much smaller rolling friction applies.
//
// `sideSpin` represents English (lateral spin) and slightly biases
// post-cushion direction and produces a small "throw" on object-ball
// contact; it decays over time.

interface SimBall extends Ball {
  spin: Vec2;
  sideSpin: number;
}

function asSim(b: Ball): SimBall {
  return {
    id: b.id,
    pos: { x: b.pos.x, y: b.pos.y },
    vel: { x: 0, y: 0 },
    inPocket: b.inPocket,
    spin: { x: 0, y: 0 },
    sideSpin: 0,
  };
}

// =====================================================================
// Per-substep integration
// =====================================================================

interface StepResult {
  cushionHits: { id: number; speed: number }[];
  collisions: { a: number; b: number; speed: number }[];
  pocketed: number[];
}

/** Throat-gated pocket capture. Returns the *visual* pocket center
 *  (for snap-to-pocket animation) when the ball center has crossed
 *  into the gated capture region of one of the six pockets. The
 *  gate is the per-pocket capture circle in {@link POCKET_CAPTURE_CENTERS}
 *  — see the comment there for why corner pockets are shifted
 *  behind the rail. */
function pocketCenterContaining(p: Vec2): Vec2 | null {
  const r2 = POCKET_CAPTURE_RADIUS * POCKET_CAPTURE_RADIUS;
  for (let i = 0; i < POCKET_CAPTURE_CENTERS.length; i += 1) {
    const gate = POCKET_CAPTURE_CENTERS[i]!;
    if (distSq(p, gate) < r2) return POCKETS[i]!;
  }
  return null;
}

function collideBallWithSegment(b: SimBall, s: Segment): { hit: boolean; speed: number } {
  // Closest point on segment to ball center.
  const ax = s.a.x;
  const ay = s.a.y;
  const dxs = s.b.x - ax;
  const dys = s.b.y - ay;
  const segLen2 = dxs * dxs + dys * dys;
  let t = segLen2 > 0 ? ((b.pos.x - ax) * dxs + (b.pos.y - ay) * dys) / segLen2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + t * dxs;
  const cy = ay + t * dys;
  const ddx = b.pos.x - cx;
  const ddy = b.pos.y - cy;
  const d2 = ddx * ddx + ddy * ddy;
  if (d2 >= BALL_RADIUS * BALL_RADIUS) return { hit: false, speed: 0 };

  // Use the segment's inward normal as the collision normal. (For
  // endpoint hits the actual normal would point from the corner — but
  // jaws are short and we want the bounce to look intentional.)
  const nx = s.n.x;
  const ny = s.n.y;
  const vn = b.vel.x * nx + b.vel.y * ny;
  if (vn >= 0) return { hit: false, speed: 0 };

  const speed = Math.hypot(b.vel.x, b.vel.y);
  // Push ball out along the normal so it sits exactly tangent.
  const dist1 = Math.sqrt(d2);
  const overshoot = BALL_RADIUS - dist1;
  b.pos.x += nx * overshoot;
  b.pos.y += ny * overshoot;

  // Reflect linear velocity along normal, with speed-dependent restitution.
  const e = railRestitution(speed);
  b.vel.x -= (1 + e) * vn * nx;
  b.vel.y -= (1 + e) * vn * ny;

  // Side spin biases the tangential component of the post-bounce
  // velocity slightly (very subtle — like a throw effect off the rail).
  if (b.sideSpin !== 0) {
    const tx = -ny;
    const ty = nx;
    const bias = b.sideSpin * speed * 0.04;
    b.vel.x += tx * bias;
    b.vel.y += ty * bias;
  }

  // Sliding friction at the rail also damps the spin in the contact
  // direction. Reflect the spin's normal component too so the rolling
  // velocity tracks the new direction roughly.
  const sn = b.spin.x * nx + b.spin.y * ny;
  b.spin.x -= (1 + e) * sn * nx;
  b.spin.y -= (1 + e) * sn * ny;

  // Side spin loses some magnitude on each rail bounce.
  b.sideSpin *= SIDESPIN_RAIL_RETENTION;

  return { hit: true, speed };
}

function stepSubstep(
  balls: SimBall[],
  sdt: number,
  result: StepResult,
): void {
  // Move
  for (const b of balls) {
    if (b.inPocket) continue;
    b.pos.x += b.vel.x * sdt;
    b.pos.y += b.vel.y * sdt;
  }

  // Cushion segment collisions FIRST. By resolving angled-jaw and
  // straight-rail bounces before checking the pocket gate, balls that
  // catch a jaw on the way in get a real rattle and can be kicked back
  // out — instead of being silently captured the moment their center
  // entered the radial gate. Combined with the throat-shifted capture
  // centers in POCKET_CAPTURE_CENTERS, this is what gives the new
  // jaw geometry its actual gameplay effect.
  for (const b of balls) {
    if (b.inPocket) continue;
    for (const s of CUSHIONS) {
      const r = collideBallWithSegment(b, s);
      if (r.hit) result.cushionHits.push({ id: b.id, speed: r.speed });
    }
  }

  // Pocket capture — only fires for balls that actually crossed the
  // throat gate. See pocketCenterContaining + POCKET_CAPTURE_CENTERS.
  for (const b of balls) {
    if (b.inPocket) continue;
    const pc = pocketCenterContaining(b.pos);
    if (pc) {
      b.inPocket = true;
      b.vel.x = 0;
      b.vel.y = 0;
      b.spin.x = 0;
      b.spin.y = 0;
      b.sideSpin = 0;
      // Snap to the visual pocket center so the drop-in looks right.
      b.pos.x = pc.x;
      b.pos.y = pc.y;
      result.pocketed.push(b.id);
    }
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
        const overlap = minDist - distance;
        const nx = delta.x / distance;
        const ny = delta.y / distance;
        a.pos.x -= (nx * overlap) / 2;
        a.pos.y -= (ny * overlap) / 2;
        b.pos.x += (nx * overlap) / 2;
        b.pos.y += (ny * overlap) / 2;

        // Velocities along the line of centers (normal axis)
        const va = a.vel.x * nx + a.vel.y * ny;
        const vb = b.vel.x * nx + b.vel.y * ny;
        if (va - vb > 0) {
          const e = RESTITUTION_BALL;
          const j1 = -(1 + e) * (va - vb) * 0.5; // equal masses
          a.vel.x += j1 * nx;
          a.vel.y += j1 * ny;
          b.vel.x -= j1 * nx;
          b.vel.y -= j1 * ny;

          // Spin transfer ----------------------------------------
          // Top spin / draw on the striker imparts a "kick" along the
          // line of centers AFTER the elastic exchange. With center-strike
          // (spin·n = 0) the striker stops dead; with follow it continues
          // forward (positive); with draw it comes back (negative).
          const aSpinN = a.spin.x * nx + a.spin.y * ny;
          const bSpinN = b.spin.x * nx + b.spin.y * ny;
          const KICK = 0.42;
          a.vel.x += nx * (aSpinN - bSpinN) * KICK;
          a.vel.y += ny * (aSpinN - bSpinN) * KICK;
          a.spin.x -= nx * aSpinN * KICK;
          a.spin.y -= ny * aSpinN * KICK;
          b.spin.x += nx * bSpinN * KICK;
          b.spin.y += ny * bSpinN * KICK;

          // Side-spin throw: a tiny tangential nudge on the OBJECT ball.
          if (a.sideSpin !== 0 || b.sideSpin !== 0) {
            const tx = -ny;
            const ty = nx;
            const aSpd = Math.hypot(a.vel.x, a.vel.y);
            const bSpd = Math.hypot(b.vel.x, b.vel.y);
            const aThrow = a.sideSpin * aSpd * 0.05;
            const bThrow = -b.sideSpin * bSpd * 0.05;
            // Object ball gets thrown perpendicular to the contact normal
            b.vel.x += tx * aThrow;
            b.vel.y += ty * aThrow;
            a.vel.x += tx * bThrow;
            a.vel.y += ty * bThrow;
            // Some side spin transfers to the object ball, the rest decays.
            const transferA = a.sideSpin * 0.25;
            const transferB = b.sideSpin * 0.25;
            b.sideSpin += transferA;
            a.sideSpin += transferB;
            a.sideSpin *= 0.7;
            b.sideSpin *= 0.7;
          }

          const speed = Math.max(Math.hypot(a.vel.x, a.vel.y), Math.hypot(b.vel.x, b.vel.y));
          result.collisions.push({ a: a.id, b: b.id, speed });
        }
      }
    }
  }
}

function applyFrictionAndSpin(balls: SimBall[], rollFriction: number, slideDecel: number): void {
  for (const b of balls) {
    if (b.inPocket) continue;
    // Slip vector at contact patch (vel - spin).
    const sx = b.vel.x - b.spin.x;
    const sy = b.vel.y - b.spin.y;
    const sMag = Math.hypot(sx, sy);

    if (sMag > ROLL_SNAP_SLIP) {
      // Sliding phase. Kinetic friction:
      //   - decelerates linear vel in the slip direction
      //   - simultaneously accelerates spin toward vel (reduces slip)
      // The two impulses share a single friction force, but for a
      // uniform sphere (I = 2/5·m·r²) the spin-acceleration share is
      // 5/2× the linear-deceleration share — see the SLIDE_LINEAR_SHARE
      // / SLIDE_SPIN_SHARE comment block above. With this split, a
      // stunned cue (spin₀ = 0) settles to |vel| = 5/7·v₀, which is the
      // textbook result for slide-to-roll on a frictional surface.
      const dec = Math.min(sMag, slideDecel);
      const ux = sx / sMag;
      const uy = sy / sMag;
      b.vel.x -= ux * dec * SLIDE_LINEAR_SHARE;
      b.vel.y -= uy * dec * SLIDE_LINEAR_SHARE;
      b.spin.x += ux * dec * SLIDE_SPIN_SHARE;
      b.spin.y += uy * dec * SLIDE_SPIN_SHARE;
    } else {
      // Rolling: snap spin to vel and apply rolling friction to both.
      b.vel.x *= rollFriction;
      b.vel.y *= rollFriction;
      b.spin.x = b.vel.x;
      b.spin.y = b.vel.y;
    }

    // Side spin decays.
    b.sideSpin *= SIDESPIN_DECAY_PER_TICK;
    if (Math.abs(b.sideSpin) < 0.005) b.sideSpin = 0;

    if (Math.abs(b.vel.x) < MIN_SPEED) b.vel.x = 0;
    if (Math.abs(b.vel.y) < MIN_SPEED) b.vel.y = 0;
    if (b.vel.x === 0 && b.vel.y === 0) {
      b.spin.x = 0;
      b.spin.y = 0;
    }
  }
}

function adaptiveSubsteps(balls: SimBall[]): number {
  let maxSpeed = 0;
  for (const b of balls) {
    if (b.inPocket) continue;
    const s = Math.hypot(b.vel.x, b.vel.y);
    if (s > maxSpeed) maxSpeed = s;
  }
  const required = Math.ceil(maxSpeed / SUBSTEP_MAX_TRAVEL);
  return Math.min(SUBSTEPS_MAX, Math.max(SUBSTEPS_MIN, required));
}

function stepBalls(
  balls: SimBall[],
  rollFriction: number,
  slideDecel: number,
): StepResult {
  const result: StepResult = { cushionHits: [], collisions: [], pocketed: [] };
  const subs = adaptiveSubsteps(balls);
  const sdt = PHYSICS_DT / subs;
  for (let s = 0; s < subs; s += 1) {
    stepSubstep(balls, sdt, result);
  }
  applyFrictionAndSpin(balls, rollFriction, slideDecel);
  return result;
}

function allStopped(balls: SimBall[]): boolean {
  for (const b of balls) {
    if (b.inPocket) continue;
    if (b.vel.x !== 0 || b.vel.y !== 0) return false;
  }
  return true;
}

// =====================================================================
// Public simulation API
// =====================================================================

export interface SimulateOptions {
  /** Multiplies the effective rolling/sliding friction. */
  tableSpeed?: number;
  /** If true, every Nth tick of the simulation is captured into `frames`. */
  recordFrames?: boolean;
  /** How many simulation ticks per recorded frame. Default 1 (60 fps). */
  frameInterval?: number;
}

export interface SimulationFrame {
  tick: number;
  positions: { id: number; x: number; y: number; inPocket: boolean }[];
}

export interface SimulateResult {
  finalState: GameState;
  events: ShotEvents;
  ticks: number;
  frames: SimulationFrame[];
  firstContactTick: number | null;
  pocketTicks: number[];
}

/**
 * Pure deterministic simulation: applies a shot to a starting state,
 * runs the physics until all balls stop, returns the final state and
 * a summary of events. Does NOT mutate the input.
 */
export function simulateShot(
  state: GameState,
  shot: Shot,
  opts: SimulateOptions = {},
): SimulateResult {
  // Deep clone balls into the internal SimBall shape (with spin tracking).
  const balls: SimBall[] = state.balls.map(asSim);

  const cue = balls.find((b) => b.id === 0)!;

  if (shot.cuePlacement) {
    cue.inPocket = false;
    cue.pos.x = shot.cuePlacement.x;
    cue.pos.y = shot.cuePlacement.y;
  } else if (cue.inPocket) {
    cue.inPocket = false;
    cue.pos.x = HEAD_SPOT.x;
    cue.pos.y = HEAD_SPOT.y;
  }

  const power = Math.max(0, Math.min(1, shot.power));
  const speed = power * MAX_LAUNCH_SPEED;
  cue.vel.x = Math.cos(shot.angle) * speed;
  cue.vel.y = Math.sin(shot.angle) * speed;

  // Optional spin from cue tip offset (normalized -1..1 across ball face).
  // Conventions: x = side English (-left, +right), y = vertical
  //   (-1 = top edge / follow, +1 = bottom edge / draw).
  const tip = shot.tipOffset ?? { x: 0, y: 0 };
  const tipY = Math.max(-1, Math.min(1, typeof tip.y === "number" ? tip.y : 0));
  const tipX = Math.max(-1, Math.min(1, typeof tip.x === "number" ? tip.x : 0));
  const verticalSpin = -tipY; // > 0 = follow, < 0 = draw
  // Initial rolling velocity:
  //   center strike (verticalSpin = 0) → spin = 0 (pure slide → "stun")
  //   max top      (verticalSpin = +1) → spin = vel * 1.7 (overspun follow)
  //   max draw     (verticalSpin = -1) → spin = vel * -1.6 (full back spin)
  const spinFactor =
    verticalSpin >= 0 ? 1 + 0.7 * verticalSpin : 1 + 1.6 * verticalSpin;
  cue.spin.x = cue.vel.x * spinFactor;
  cue.spin.y = cue.vel.y * spinFactor;
  cue.sideSpin = tipX;

  const events: ShotEvents = {
    pocketed: [],
    firstContact: null,
    cueHitCushion: false,
    cushionAfterContact: false,
    railsHitAfterContact: 0,
    objectBallsToRail: 0,
  };

  const tableSpeed = opts.tableSpeed ?? 1;
  // Higher table speed -> less friction. tableSpeed=1 -> baseline.
  const rollFriction = Math.min(0.999, 1 - (1 - ROLL_FRICTION) / Math.max(0.4, tableSpeed));
  const slideDecel = SLIDE_DECEL_PER_TICK / Math.max(0.4, tableSpeed);

  const recordFrames = opts.recordFrames === true;
  const frameInterval = Math.max(1, opts.frameInterval ?? 1);
  const frames: SimulationFrame[] = [];
  let firstContactTick: number | null = null;
  const pocketTicks: number[] = [];
  // Per-ball "has hit a rail since first contact" tracking — used by the
  // rules engine to validate break shots and stalemate avoidance.
  const railedAfterContact = new Set<number>();

  function snapshot(tick: number): SimulationFrame {
    return {
      tick,
      positions: balls.map((b) => ({
        id: b.id,
        x: b.pos.x,
        y: b.pos.y,
        inPocket: b.inPocket,
      })),
    };
  }

  if (recordFrames) frames.push(snapshot(0));

  let lastTick = 0;
  for (let tick = 1; tick <= MAX_TICKS; tick += 1) {
    const result = stepBalls(balls, rollFriction, slideDecel);
    lastTick = tick;

    if (events.firstContact === null) {
      for (const c of result.collisions) {
        if (c.a === 0 && c.b !== 0) {
          events.firstContact = c.b;
          firstContactTick = tick;
          break;
        }
        if (c.b === 0 && c.a !== 0) {
          events.firstContact = c.a;
          firstContactTick = tick;
          break;
        }
      }
    }

    if (result.cushionHits.length > 0) {
      for (const ch of result.cushionHits) {
        if (ch.id === 0) events.cueHitCushion = true;
        if (events.firstContact !== null) {
          events.cushionAfterContact = true;
          events.railsHitAfterContact += 1;
          if (ch.id !== 0 && !railedAfterContact.has(ch.id)) {
            railedAfterContact.add(ch.id);
            events.objectBallsToRail += 1;
          }
        }
      }
    }

    for (const id of result.pocketed) {
      events.pocketed.push(id);
      pocketTicks.push(tick);
    }

    if (recordFrames && tick % frameInterval === 0) {
      frames.push(snapshot(tick));
    }

    if (allStopped(balls)) break;
  }

  if (recordFrames && (frames.length === 0 || frames[frames.length - 1]!.tick !== lastTick)) {
    frames.push(snapshot(lastTick));
  }

  // Project SimBall back to public Ball shape.
  const finalState: GameState = {
    ...state,
    balls: balls.map((b) => ({
      id: b.id,
      pos: { x: b.pos.x, y: b.pos.y },
      vel: { x: b.vel.x, y: b.vel.y },
      inPocket: b.inPocket,
    })),
  };

  return { finalState, events, ticks: lastTick, frames, firstContactTick, pocketTicks };
}

// =====================================================================
// Aim prediction
// =====================================================================

export interface AimPrediction {
  /** Where the cue ball line stops (cushion or contact point). */
  end: Vec2;
  /** First object ball it would hit, if any. */
  hitBall: Ball | null;
  /** Unit vector from cue → target at first contact (for ghost ball). */
  contactNormal: Vec2 | null;
  /** Distance traveled by the cue along `dir` before stopping. */
  distance: number;
}

/**
 * Returns the predicted endpoint of an aim line: where the cue ball
 * would first collide with another ball or a cushion. Used to draw the
 * aim guide. The richer {@link predictAim} variant also returns which
 * ball (if any) is hit and the contact normal — used to draw the
 * tangent + target lines.
 */
export function predictAim(
  state: GameState,
  cuePos: Vec2,
  dir: Vec2,
  maxLen = TABLE_WIDTH,
): AimPrediction {
  const balls = state.balls.filter((b) => !b.inPocket && b.id !== 0);
  let bestT = maxLen;
  let bestBall: Ball | null = null;

  // Collide with rails (AABB approximation — fine for the cosmetic guide).
  if (dir.x > 0) bestT = Math.min(bestT, (PLAY_RIGHT - BALL_RADIUS - cuePos.x) / dir.x);
  if (dir.x < 0) bestT = Math.min(bestT, (PLAY_LEFT + BALL_RADIUS - cuePos.x) / dir.x);
  if (dir.y > 0) bestT = Math.min(bestT, (PLAY_BOTTOM - BALL_RADIUS - cuePos.y) / dir.y);
  if (dir.y < 0) bestT = Math.min(bestT, (PLAY_TOP + BALL_RADIUS - cuePos.y) / dir.y);

  const r2 = (BALL_RADIUS * 2) ** 2;
  for (const b of balls) {
    const m = sub(cuePos, b.pos);
    const bdir = dot(m, dir);
    const c = dot(m, m) - r2;
    if (c > 0 && bdir > 0) continue;
    const disc = bdir * bdir - c;
    if (disc < 0) continue;
    const t = -bdir - Math.sqrt(disc);
    if (t >= 0 && t < bestT) {
      bestT = t;
      bestBall = b;
    }
  }

  bestT = Math.max(0, bestT);
  const end = { x: cuePos.x + dir.x * bestT, y: cuePos.y + dir.y * bestT };
  let normal: Vec2 | null = null;
  if (bestBall) {
    const nx = bestBall.pos.x - end.x;
    const ny = bestBall.pos.y - end.y;
    const m = Math.hypot(nx, ny) || 1;
    normal = { x: nx / m, y: ny / m };
  }
  return { end, hitBall: bestBall, contactNormal: normal, distance: bestT };
}

/** Backwards-compatible thin wrapper around {@link predictAim}. */
export function predictAimLine(
  state: GameState,
  cuePos: Vec2,
  dir: Vec2,
  maxLen = TABLE_WIDTH,
): Vec2 {
  return predictAim(state, cuePos, dir, maxLen).end;
}

export { dist, distSq };
