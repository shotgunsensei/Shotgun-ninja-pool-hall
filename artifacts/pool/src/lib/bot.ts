import { POCKETS, predictAimLine, BALL_RADIUS } from "./physics";
import { ballGroup } from "./rules";
import type { GameState, Shot } from "./types";

// =====================================================================
// Basic CPU opponent
//
// Strategy: enumerate target balls (own group, or any if open table, or
// just the 8 if the group is cleared), for each pocket compute the contact
// point that would send the target into that pocket, then aim the cue
// straight at that contact point. Score each option by the geometric
// "ghost ball" line clarity (no obstructing ball within 2*radius of the
// path) and by alignment quality. Pick the best, then add a small angular
// jitter to make the bot beatable.
// =====================================================================

function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

interface Candidate {
  shot: Shot;
  score: number;
}

export function chooseBotShot(state: GameState): Shot {
  const cue = state.balls.find((b) => b.id === 0)!;
  const targets = state.balls.filter((b) => {
    if (b.inPocket) return false;
    if (b.id === 0) return false;
    const grp = ballGroup(b.id);
    if (grp === "eight") {
      // Only target the 8 if our group is cleared.
      const myGrp = state.players[state.currentPlayer].group;
      if (!myGrp) return false;
      const remaining = state.balls.filter(
        (x) => !x.inPocket && ballGroup(x.id) === myGrp,
      ).length;
      return remaining === 0;
    }
    const myGrp = state.players[state.currentPlayer].group;
    if (myGrp === null) return true; // open table — try anything
    return grp === myGrp;
  });

  if (targets.length === 0) {
    // Nothing to aim at — just nudge towards the center.
    return { angle: Math.atan2(250 - cue.pos.y, 500 - cue.pos.x), power: 0.4 };
  }

  const candidates: Candidate[] = [];
  for (const target of targets) {
    for (const pocket of POCKETS) {
      // Direction from pocket through ball is the line we want the
      // target ball to travel. The ghost-ball position is on the
      // OPPOSITE side of the target from the pocket, at a distance of
      // 2*BALL_RADIUS.
      const dxp = target.pos.x - pocket.x;
      const dyp = target.pos.y - pocket.y;
      const lenP = Math.hypot(dxp, dyp);
      if (lenP === 0) continue;
      const nx = dxp / lenP;
      const ny = dyp / lenP;
      const ghostX = target.pos.x + nx * BALL_RADIUS * 2;
      const ghostY = target.pos.y + ny * BALL_RADIUS * 2;

      // Cue must hit the ghost from "behind" -- the cue-to-target direction
      // dotted with the desired travel direction must be positive.
      const cdx = target.pos.x - cue.pos.x;
      const cdy = target.pos.y - cue.pos.y;
      const align = -nx * (cdx / Math.hypot(cdx, cdy)) - ny * (cdy / Math.hypot(cdx, cdy));
      if (align < 0.2) continue; // too cut / impossible angle

      const angle = Math.atan2(ghostY - cue.pos.y, ghostX - cue.pos.x);
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);

      // Sanity: predicted aim line should reach near the ghost without
      // hitting another ball first.
      const aimEnd = predictAimLine(
        state,
        { x: cue.pos.x, y: cue.pos.y },
        { x: dirX, y: dirY },
      );
      const reachedGhost =
        distSq(aimEnd.x, aimEnd.y, ghostX, ghostY) < (BALL_RADIUS * 1.2) ** 2;
      const reachedTarget =
        distSq(aimEnd.x, aimEnd.y, target.pos.x, target.pos.y) <
        (BALL_RADIUS * 2.5) ** 2;
      if (!reachedGhost && !reachedTarget) continue;

      // Score: prefer well-aligned shots, slightly prefer shorter shots.
      const cueDist = Math.hypot(cdx, cdy);
      const score = align * 100 - cueDist * 0.05;

      // Power scales with distance + cut; clamp to a reasonable band.
      const power = Math.max(0.45, Math.min(0.9, 0.45 + cueDist / 1200 + (1 - align) * 0.4));
      candidates.push({ shot: { angle, power }, score });
    }
  }

  if (candidates.length === 0) {
    // No clean shot found — bank a soft random shot at the densest cluster.
    const target = targets[0]!;
    const angle = Math.atan2(target.pos.y - cue.pos.y, target.pos.x - cue.pos.x);
    const jitter = (Math.random() - 0.5) * 0.1;
    return { angle: angle + jitter, power: 0.55 };
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]!.shot;
  // Add small human-like jitter so the bot isn't perfect.
  const jitter = (Math.random() - 0.5) * 0.06;
  return { angle: best.angle + jitter, power: best.power };
}
