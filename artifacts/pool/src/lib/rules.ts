import type { Ball, GameState, Group, ShotEvents } from "./types";

// =====================================================================
// 8-ball rule helpers
// =====================================================================

export function ballGroup(id: number): Group | "cue" | "eight" {
  if (id === 0) return "cue";
  if (id === 8) return "eight";
  if (id >= 1 && id <= 7) return "solids";
  return "stripes";
}

export function ballsRemainingForGroup(state: GameState, group: Group): number {
  const ids = group === "solids" ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
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

export interface ResolvedShot {
  state: GameState;
  foul: { reason: string } | null;
  turnContinues: boolean;
  potNotes: string[]; // human-readable strings about what happened
}

/**
 * Apply 8-ball rules to a finished simulation.
 *
 * Inputs: the post-shot state from physics + the events that happened.
 * Returns: the new game state with turn/group/foul/win flags applied.
 */
export function applyShotResult(
  before: GameState,
  after: GameState,
  events: ShotEvents,
): ResolvedShot {
  const player = before.currentPlayer;
  const opponent: 0 | 1 = player === 0 ? 1 : 0;
  const myGroup = before.players[player].group;
  const cueBall = after.balls.find((b) => b.id === 0)!;

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

  // Ball-in-hand placement: if the cue ball was pocketed, push it back to the
  // table at a sensible default and mark ball-in-hand.
  let ballInHand = false;
  if (cuePocketed) {
    cueBall.inPocket = false;
    cueBall.pos.x = 250; // head spot-ish
    cueBall.pos.y = 250;
    cueBall.vel.x = 0;
    cueBall.vel.y = 0;
    ballInHand = true;
  }

  const baseState: GameState = {
    ...before,
    balls: after.balls,
    ballInHand,
    shotCount: before.shotCount + 1,
  };

  // ----- Win/loss checks for the 8 ball first -----
  if (eightPocketed) {
    // Pocketing the 8 is a win only if the player has already cleared their
    // assigned group AND did not also pocket the cue ball.
    const clearedBefore =
      myGroup !== null &&
      ballsRemainingForGroup(before, myGroup) === otherPocketed.filter((id) => {
        const g = ballGroup(id);
        return g === myGroup;
      }).length;

    if (clearedBefore && !cuePocketed && fc === 8) {
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
    // Otherwise — early/illegal 8 — current player loses.
    return {
      state: {
        ...baseState,
        gameOver: { winner: opponent, reason: "Illegal 8-ball pocket" },
      },
      foul: { reason: "8 ball pocketed illegally" },
      turnContinues: false,
      potNotes: notes,
    };
  }

  // ----- Foul detection -----
  let foul: { reason: string } | null = null;

  if (cuePocketed) {
    foul = { reason: "Cue ball pocketed (scratch)" };
  } else if (fc === null) {
    foul = { reason: "Cue ball hit no ball" };
  } else if (fc === 8 && myGroup !== null && !playerHasClearedGroup(before, player)) {
    foul = { reason: "Hit the 8 ball first" };
  } else if (myGroup !== null && fc !== null) {
    const fcGroup = ballGroup(fc);
    if (fcGroup !== myGroup && fc !== 8) {
      foul = { reason: "Hit the wrong group first" };
    }
  } else if (
    !cuePocketed &&
    events.pocketed.length === 0 &&
    !events.cushionAfterContact &&
    fc !== null
  ) {
    // No pot and no rail after contact: classic table-scratch foul.
    foul = { reason: "No rail or pocket after contact" };
  }

  // ----- Group assignment on first legal pot when groups are open -----
  let nextState = baseState;
  if (
    !nextState.groupsAssigned &&
    !cuePocketed &&
    otherPocketed.length > 0 &&
    !foul
  ) {
    // Decide which group "this player" gets.
    // If they pocketed only one type, they get that type.
    // If they pocketed a mix, the first legal pot determines it.
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
      // Pick whichever appeared first in the events list
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
  // Player continues if (a) they legally pocketed at least one ball of their
  // group AND no foul. With open table, any legal pot continues the turn.
  let turnContinues = false;
  if (!foul && otherPocketed.length > 0) {
    const myGrp = nextState.players[player].group;
    if (!myGrp) {
      // Open table: any non-cue/non-8 pot continues the turn
      turnContinues = true;
    } else {
      const ofMine = otherPocketed.some((id) => ballGroup(id) === myGrp);
      if (ofMine) turnContinues = true;
    }
  }

  // On a foul, opponent gets ball-in-hand.
  if (foul) {
    nextState = { ...nextState, ballInHand: true };
  }

  if (!turnContinues) {
    nextState = { ...nextState, currentPlayer: opponent };
  } else {
    // Same player continues; clear ball-in-hand unless cue was pocketed.
    if (!cuePocketed && !foul) {
      nextState = { ...nextState, ballInHand: false };
    }
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
    groupsAssigned: false,
    gameOver: null,
    shotCount: 0,
  };
}
