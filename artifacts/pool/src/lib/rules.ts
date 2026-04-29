import {
  HEAD_SPOT,
  FOOT_SPOT,
  findSpotPosition,
  POCKETS,
  POCKET_CAPTURE_RADIUS,
  BALL_RADIUS,
} from "./physics";
import type {
  Ball,
  GameState,
  Group,
  PendingChoice,
  ShotEvents,
  Settings,
} from "./types";

// =====================================================================
// 8-ball rule helpers
// =====================================================================
// All rule logic intentionally lives outside the physics simulation.
// This module is a pure transform from (pre-shot state, post-shot state,
// shot events, optional settings) → ResolvedShot.

export function ballGroup(id: number): Group | "cue" | "eight" {
  if (id === 0) return "cue";
  if (id === 8) return "eight";
  if (id >= 1 && id <= 7) return "solids";
  return "stripes";
}

export function ballsRemainingForGroup(state: GameState, group: Group): number {
  const ids =
    group === "solids" ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
  return ids.filter((id) => {
    const b = state.balls.find((x) => x.id === id);
    return b && !b.inPocket;
  }).length;
}

export function playerHasClearedGroup(state: GameState, player: 0 | 1): boolean {
  const group = state.players[player].group;
  if (!group) return false;
  return ballsRemainingForGroup(state, group) === 0;
}

/** Identify the pocket index a given ball position fell into. Returns
 *  the index in {@link POCKETS} or -1 if the position isn't inside any
 *  pocket capture radius. */
export function pocketIndexAt(pos: { x: number; y: number }): number {
  for (let i = 0; i < POCKETS.length; i += 1) {
    const k = POCKETS[i]!;
    const dx = pos.x - k.x;
    const dy = pos.y - k.y;
    if (dx * dx + dy * dy < (POCKET_CAPTURE_RADIUS + BALL_RADIUS) ** 2) return i;
  }
  return -1;
}

export interface ResolvedShot {
  state: GameState;
  foul: { reason: string } | null;
  turnContinues: boolean;
  potNotes: string[];
}

interface ApplyContext {
  /** True if this is the opening break shot (shotCount was 0). */
  isBreakShot: boolean;
  /** True if the cue had to be placed behind the head string (after
   *  break-shot scratch). */
  fromBehindHeadString: boolean;
}

/**
 * Apply 8-ball rules to a finished simulation. Inputs:
 *   - `before`: pre-shot state (used to decide what was assigned, etc.)
 *   - `after`: post-physics state (positions/inPocket are final)
 *   - `events`: what happened during the shot
 *   - `settings`: optional rule variants (call shot, three-foul). Pass
 *      `undefined` for the default WPA-lite ruleset.
 *   - `shot.calledPocket`: optional, only used when `callShotOn8` is on.
 */
export function applyShotResult(
  before: GameState,
  after: GameState,
  events: ShotEvents,
  settings?: Pick<Settings, "callShotOn8" | "threeFoulRule">,
  shotMeta?: { calledPocket?: number },
): ResolvedShot {
  const player = before.currentPlayer;
  const opponent: 0 | 1 = player === 0 ? 1 : 0;
  const myGroup = before.players[player].group;
  const cueBall = after.balls.find((b) => b.id === 0)!;
  const ctx: ApplyContext = {
    isBreakShot: before.shotCount === 0,
    fromBehindHeadString: before.ballInHandBehindHeadString === true,
  };
  const callShot = settings?.callShotOn8 === true;
  const threeFoul = settings?.threeFoulRule === true;

  const cuePocketed = events.pocketed.includes(0);
  const eightPocketed = events.pocketed.includes(8);
  const otherPocketed = events.pocketed.filter((id) => id !== 0 && id !== 8);
  const fc = events.firstContact;

  const notes: string[] = [];
  for (const id of events.pocketed) {
    if (id === 0) notes.push("Cue ball pocketed");
    else if (id === 8) notes.push("8 ball pocketed");
    else notes.push(`Pocketed ${id}`);
  }

  // Reset cue ball if pocketed (so the next placement has somewhere to go).
  let ballInHand = false;
  let ballInHandBehindHeadString = false;
  if (cuePocketed) {
    cueBall.inPocket = false;
    cueBall.pos.x = HEAD_SPOT.x;
    cueBall.pos.y = HEAD_SPOT.y;
    cueBall.vel.x = 0;
    cueBall.vel.y = 0;
    ballInHand = true;
  }

  // Existing consecutive-foul tally (default [0,0]).
  const prevFouls = before.consecutiveFouls ?? [0, 0];
  let consecutiveFouls: [number, number] = [prevFouls[0], prevFouls[1]];

  const baseState: GameState = {
    ...before,
    balls: after.balls,
    ballInHand,
    ballInHandBehindHeadString: false,
    shotCount: before.shotCount + 1,
    pendingChoice: null,
    consecutiveFouls,
  };

  // =====================================================================
  // BREAK SHOT — special handling
  // =====================================================================
  // WPA: the breaker must either pocket a numbered ball OR drive at
  // least four numbered balls to a rail. Otherwise = foul, and the
  // incoming player chooses to accept the table or re-rack & re-break.
  // 8-on-break is NOT an automatic loss: incoming player chooses to
  // re-spot the 8 and play, or re-rack and re-break.
  if (ctx.isBreakShot) {
    // Order matters: 8-on-break supersedes a regular failed-break check.
    if (eightPocketed) {
      // Spot the 8 ball back on the foot spot. Cue may also have been
      // scratched — handled below the switch.
      const eightBall = after.balls.find((b) => b.id === 8);
      if (eightBall) {
        const spot = findSpotPosition(
          { ...before, balls: after.balls },
          FOOT_SPOT,
        );
        eightBall.inPocket = false;
        eightBall.pos.x = spot.x;
        eightBall.pos.y = spot.y;
        eightBall.vel.x = 0;
        eightBall.vel.y = 0;
      }
      const choice: PendingChoice = { type: "8OnBreak", chooser: opponent };
      const state: GameState = {
        ...baseState,
        balls: after.balls,
        currentPlayer: opponent,
        ballInHand: cuePocketed,
        ballInHandBehindHeadString: cuePocketed,
        pendingChoice: choice,
      };
      return {
        state,
        foul: cuePocketed ? { reason: "Cue ball scratched on the break" } : null,
        turnContinues: false,
        potNotes: [
          ...notes,
          "8-ball spotted — opponent chooses to accept or re-rack",
        ],
      };
    }

    // Was it a legal break? (≥1 ball pocketed OR ≥4 to a rail.)
    const legalBreak =
      otherPocketed.length > 0 || events.objectBallsToRail >= 4;

    if (cuePocketed) {
      // Scratch on the break — opponent gets cue ball-in-hand BEHIND
      // the head string. Open table remains. (No 3-foul tally on break.)
      const state: GameState = {
        ...baseState,
        currentPlayer: opponent,
        ballInHand: true,
        ballInHandBehindHeadString: true,
      };
      return {
        state,
        foul: { reason: "Scratch on the break" },
        turnContinues: false,
        potNotes: notes,
      };
    }

    if (!legalBreak) {
      // Failed break — opponent chooses (accept table or re-rack & break).
      const choice: PendingChoice = { type: "FailedBreak", chooser: opponent };
      const state: GameState = {
        ...baseState,
        currentPlayer: opponent,
        pendingChoice: choice,
      };
      return {
        state,
        foul: { reason: "Failed break (no pot, fewer than 4 balls to rail)" },
        turnContinues: false,
        potNotes: notes,
      };
    }

    // Legal break with no scratch and no 8 pocketed.
    // If the breaker pocketed at least one numbered ball, table stays
    // open and they continue. Otherwise opponent's turn.
    const breakerContinues = otherPocketed.length > 0;
    const state: GameState = {
      ...baseState,
      currentPlayer: breakerContinues ? player : opponent,
      ballInHand: false,
      ballInHandBehindHeadString: false,
    };
    return {
      state,
      foul: null,
      turnContinues: breakerContinues,
      potNotes: notes,
    };
  }

  // =====================================================================
  // POST-BREAK PLAY
  // =====================================================================

  // ----- Win/loss check on the 8 ball ---------------------------------
  if (eightPocketed) {
    // The player must already have cleared their assigned group AND not
    // have pocketed the cue ball. Optionally must hit the 8 first AND
    // pocket it in the called pocket.
    const wasOnEight =
      myGroup !== null &&
      ballsRemainingForGroup(before, myGroup) === 0;

    let illegalReason: string | null = null;
    if (!wasOnEight) {
      illegalReason = "Pocketed the 8 ball before clearing your group";
    } else if (cuePocketed) {
      illegalReason = "Pocketed the 8 ball and scratched the cue ball";
    } else if (fc !== 8) {
      illegalReason = "Hit the wrong ball before pocketing the 8";
    } else if (callShot) {
      // Find which pocket the 8 actually fell into.
      const eightBall = after.balls.find((b) => b.id === 8);
      const actualPocket = eightBall ? pocketIndexAt(eightBall.pos) : -1;
      const called = shotMeta?.calledPocket;
      if (typeof called !== "number") {
        illegalReason = "8 ball pocketed without calling a pocket";
      } else if (actualPocket !== called) {
        illegalReason = "8 ball pocketed in the wrong pocket";
      }
    }

    if (illegalReason !== null) {
      return {
        state: {
          ...baseState,
          gameOver: { winner: opponent, reason: illegalReason },
        },
        foul: { reason: illegalReason },
        turnContinues: false,
        potNotes: notes,
      };
    }

    return {
      state: {
        ...baseState,
        gameOver: { winner: player, reason: "Legal 8-ball pocket" },
      },
      foul: null,
      turnContinues: false,
      potNotes: notes,
    };
  }

  // ----- Foul detection -----------------------------------------------
  let foul: { reason: string } | null = null;

  if (cuePocketed) {
    foul = { reason: "Cue ball pocketed (scratch)" };
  } else if (fc === null) {
    foul = { reason: "Cue ball hit no ball" };
  } else if (myGroup === null) {
    // OPEN TABLE — hitting the 8 first is a foul (can never be on the
    // 8 before groups are assigned).
    if (fc === 8) {
      foul = { reason: "Hit the 8 ball first on an open table" };
    }
  } else if (fc === 8 && !playerHasClearedGroup(before, player)) {
    foul = { reason: "Hit the 8 ball first" };
  } else if (myGroup !== null) {
    const fcGroup = ballGroup(fc);
    if (fcGroup !== myGroup && fc !== 8) {
      foul = { reason: "Hit the wrong group first" };
    }
  }

  // Cushion-after-contact check applies regardless of group:
  if (
    !foul &&
    !cuePocketed &&
    events.pocketed.length === 0 &&
    !events.cushionAfterContact &&
    fc !== null
  ) {
    foul = { reason: "No ball pocketed and no rail after contact" };
  }

  // ----- Group assignment on first legal pot when groups are open -----
  let nextState = baseState;
  if (
    !nextState.groupsAssigned &&
    !cuePocketed &&
    otherPocketed.length > 0 &&
    !foul
  ) {
    let chosen: Group | null = null;
    let solidCount = 0;
    let stripeCount = 0;
    for (const id of otherPocketed) {
      const g = ballGroup(id);
      if (g === "solids") solidCount += 1;
      if (g === "stripes") stripeCount += 1;
    }
    if (solidCount > 0 && stripeCount === 0) chosen = "solids";
    else if (stripeCount > 0 && solidCount === 0) chosen = "stripes";
    else if (solidCount > 0 && stripeCount > 0) {
      // Mixed pot on the same shot: the first ball pocketed determines.
      for (const id of events.pocketed) {
        const g = ballGroup(id);
        if (g === "solids") {
          chosen = "solids";
          break;
        }
        if (g === "stripes") {
          chosen = "stripes";
          break;
        }
      }
    }

    if (chosen) {
      const otherGroup: Group = chosen === "solids" ? "stripes" : "solids";
      const players = [...nextState.players] as GameState["players"];
      players[player] = { ...players[player], group: chosen };
      players[opponent] = { ...players[opponent], group: otherGroup };
      nextState = { ...nextState, players, groupsAssigned: true };
    }
  }

  // ----- Turn handling -----
  let turnContinues = false;
  if (!foul && otherPocketed.length > 0) {
    const myGrp = nextState.players[player].group;
    if (!myGrp) {
      turnContinues = true;
    } else {
      const ofMine = otherPocketed.some((id) => ballGroup(id) === myGrp);
      if (ofMine) turnContinues = true;
    }
  }

  // ----- Three-foul rule (optional) -----
  if (foul) {
    consecutiveFouls = [
      player === 0 ? consecutiveFouls[0] + 1 : consecutiveFouls[0],
      player === 1 ? consecutiveFouls[1] + 1 : consecutiveFouls[1],
    ];
    if (threeFoul && consecutiveFouls[player] >= 3) {
      return {
        state: {
          ...nextState,
          consecutiveFouls,
          gameOver: { winner: opponent, reason: "Three consecutive fouls" },
          ballInHand: true,
          currentPlayer: opponent,
        },
        foul,
        turnContinues: false,
        potNotes: notes,
      };
    }
  } else {
    // Any non-foul shot resets the offending player's tally.
    consecutiveFouls = [
      player === 0 ? 0 : consecutiveFouls[0],
      player === 1 ? 0 : consecutiveFouls[1],
    ];
  }

  if (foul) {
    nextState = { ...nextState, ballInHand: true };
  }
  nextState = { ...nextState, consecutiveFouls };

  if (!turnContinues) {
    nextState = { ...nextState, currentPlayer: opponent };
  } else if (!cuePocketed && !foul) {
    nextState = { ...nextState, ballInHand: false };
  }

  return { state: nextState, foul, turnContinues, potNotes: notes };
}

export function makeInitialGameState(
  balls: Ball[],
  players: [string, string],
): GameState {
  return {
    balls,
    currentPlayer: 0,
    players: [
      { name: players[0], group: null },
      { name: players[1], group: null },
    ],
    ballInHand: false,
    ballInHandBehindHeadString: false,
    groupsAssigned: false,
    gameOver: null,
    shotCount: 0,
    consecutiveFouls: [0, 0],
    pendingChoice: null,
  };
}

// =====================================================================
// Pending-choice resolution helpers (UI calls these)
// =====================================================================

/** After 8-on-break or failed break, the chooser elects to play the
 *  table as it lies. Returns the new state to use. The cue placement
 *  details (e.g. behind-head-string when the cue also scratched) were
 *  already encoded by {@link applyShotResult}. */
export function acceptTable(state: GameState): GameState {
  return { ...state, pendingChoice: null };
}

/** Re-rack and break again. The chooser becomes the breaker. */
export function rerackAndBreak(
  state: GameState,
  freshBalls: Ball[],
): GameState {
  const chooser =
    state.pendingChoice && state.pendingChoice.type === "8OnBreak"
      ? state.pendingChoice.chooser
      : state.pendingChoice && state.pendingChoice.type === "FailedBreak"
        ? state.pendingChoice.chooser
        : state.currentPlayer;
  return {
    ...state,
    balls: freshBalls,
    currentPlayer: chooser,
    ballInHand: false,
    ballInHandBehindHeadString: false,
    groupsAssigned: false,
    pendingChoice: null,
    shotCount: 0,
    players: [
      { name: state.players[0].name, group: null },
      { name: state.players[1].name, group: null },
    ],
    consecutiveFouls: [0, 0],
  };
}
