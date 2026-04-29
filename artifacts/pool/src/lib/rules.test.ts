import { describe, expect, test } from "vitest";
import {
  FOOT_SPOT,
  HEAD_STRING_X,
  PLAY_HEIGHT,
  PLAY_TOP,
  POCKETS,
} from "./physics";
import { applyShotResult, makeInitialGameState } from "./rules";
import type { Ball, GameState, ShotEvents } from "./types";

// ---------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------

function makeBalls(): Ball[] {
  // 16 balls placed in arbitrary on-table positions. Tests will mutate
  // inPocket / pos as needed without caring about geometry.
  const balls: Ball[] = [];
  for (let id = 0; id < 16; id += 1) {
    balls.push({
      id,
      pos: { x: 100 + id * 20, y: PLAY_TOP + 50 + (id % 4) * 30 },
      vel: { x: 0, y: 0 },
      inPocket: false,
    });
  }
  return balls;
}

function clone(state: GameState): GameState {
  return {
    ...state,
    balls: state.balls.map((b) => ({
      id: b.id,
      pos: { x: b.pos.x, y: b.pos.y },
      vel: { x: b.vel.x, y: b.vel.y },
      inPocket: b.inPocket,
    })),
    players: [
      { ...state.players[0] },
      { ...state.players[1] },
    ],
    consecutiveFouls: state.consecutiveFouls
      ? [state.consecutiveFouls[0], state.consecutiveFouls[1]]
      : [0, 0],
  };
}

function emptyEvents(overrides: Partial<ShotEvents> = {}): ShotEvents {
  return {
    pocketed: [],
    firstContact: null,
    cueHitCushion: false,
    cushionAfterContact: false,
    railsHitAfterContact: 0,
    objectBallsToRail: 0,
    ...overrides,
  };
}

function mark(state: GameState, ids: number[], inPocket: boolean): void {
  for (const id of ids) {
    const b = state.balls.find((x) => x.id === id);
    if (b) b.inPocket = inPocket;
  }
}

function setBallPos(state: GameState, id: number, x: number, y: number): void {
  const b = state.balls.find((x) => x.id === id);
  if (b) b.pos = { x, y };
}

// ---------------------------------------------------------------------
// BREAK SHOT
// ---------------------------------------------------------------------

describe("break shot rules", () => {
  test("legal break with at least one pot lets the breaker continue (open table)", () => {
    const before = makeInitialGameState(makeBalls(), ["A", "B"]);
    expect(before.shotCount).toBe(0);
    const after = clone(before);
    mark(after, [1], true); // pocketed the 1 (a solid)
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        pocketed: [1],
        firstContact: 1,
        cushionAfterContact: true,
        railsHitAfterContact: 5,
        objectBallsToRail: 5,
      }),
    );
    expect(result.foul).toBeNull();
    expect(result.turnContinues).toBe(true);
    expect(result.state.currentPlayer).toBe(0);
    // Open table — no group assignment until the break-shot resolution
    // path runs the post-break legal pot through normal play. Our break
    // branch returns straight after marking continuation, so groups are
    // still open.
    expect(result.state.groupsAssigned).toBe(false);
  });

  test("legal break with no pot but 4+ balls to a rail passes turn cleanly", () => {
    const before = makeInitialGameState(makeBalls(), ["A", "B"]);
    const after = clone(before);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        pocketed: [],
        firstContact: 1,
        cushionAfterContact: true,
        railsHitAfterContact: 6,
        objectBallsToRail: 4,
      }),
    );
    expect(result.foul).toBeNull();
    expect(result.turnContinues).toBe(false);
    expect(result.state.currentPlayer).toBe(1);
    expect(result.state.pendingChoice).toBeNull();
  });

  test("failed break (no pot, fewer than 4 to a rail) creates a FailedBreak choice", () => {
    const before = makeInitialGameState(makeBalls(), ["A", "B"]);
    const after = clone(before);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        pocketed: [],
        firstContact: 1,
        cushionAfterContact: true,
        railsHitAfterContact: 2,
        objectBallsToRail: 2,
      }),
    );
    expect(result.foul).not.toBeNull();
    expect(result.foul!.reason).toMatch(/failed break/i);
    expect(result.state.currentPlayer).toBe(1);
    expect(result.state.pendingChoice).not.toBeNull();
    expect(result.state.pendingChoice!.type).toBe("FailedBreak");
    expect(result.state.pendingChoice!.chooser).toBe(1);
  });

  test("scratch on the break gives the opponent ball-in-hand BEHIND the head string", () => {
    const before = makeInitialGameState(makeBalls(), ["A", "B"]);
    const after = clone(before);
    mark(after, [0], true); // cue ball pocketed
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        pocketed: [0],
        firstContact: 1,
        cushionAfterContact: true,
        railsHitAfterContact: 5,
        objectBallsToRail: 5,
      }),
    );
    expect(result.foul).not.toBeNull();
    expect(result.foul!.reason).toMatch(/scratch/i);
    expect(result.state.currentPlayer).toBe(1);
    expect(result.state.ballInHand).toBe(true);
    expect(result.state.ballInHandBehindHeadString).toBe(true);
    // The cue ball is restored (no longer reported as pocketed).
    const cue = result.state.balls.find((b) => b.id === 0)!;
    expect(cue.inPocket).toBe(false);
  });

  test("8-on-break creates an 8OnBreak pending choice and respots the 8 on the foot spot", () => {
    const before = makeInitialGameState(makeBalls(), ["A", "B"]);
    const after = clone(before);
    mark(after, [8], true);
    setBallPos(after, 8, POCKETS[0]!.x, POCKETS[0]!.y);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        pocketed: [8],
        firstContact: 8,
        cushionAfterContact: true,
        railsHitAfterContact: 4,
        objectBallsToRail: 4,
      }),
    );
    expect(result.foul).toBeNull();
    expect(result.state.pendingChoice).not.toBeNull();
    expect(result.state.pendingChoice!.type).toBe("8OnBreak");
    expect(result.state.pendingChoice!.chooser).toBe(1);
    // The 8 ball should be back on the table near the foot spot.
    const eight = result.state.balls.find((b) => b.id === 8)!;
    expect(eight.inPocket).toBe(false);
    const dx = eight.pos.x - FOOT_SPOT.x;
    const dy = eight.pos.y - FOOT_SPOT.y;
    expect(Math.hypot(dx, dy)).toBeLessThan(PLAY_HEIGHT); // safely on table
  });

  test("8-on-break combined with cue scratch: opponent gets BIH behind head string", () => {
    const before = makeInitialGameState(makeBalls(), ["A", "B"]);
    const after = clone(before);
    mark(after, [0, 8], true);
    setBallPos(after, 8, POCKETS[0]!.x, POCKETS[0]!.y);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        pocketed: [0, 8],
        firstContact: 8,
        cushionAfterContact: true,
      }),
    );
    expect(result.foul).not.toBeNull();
    expect(result.state.ballInHand).toBe(true);
    expect(result.state.ballInHandBehindHeadString).toBe(true);
    expect(result.state.pendingChoice).not.toBeNull();
    expect(result.state.pendingChoice!.type).toBe("8OnBreak");
  });
});

// ---------------------------------------------------------------------
// POST-BREAK FOULS
// ---------------------------------------------------------------------

describe("post-break foul rules", () => {
  function postBreak(): GameState {
    const s = makeInitialGameState(makeBalls(), ["A", "B"]);
    s.shotCount = 1; // first non-break shot
    return s;
  }

  test("open table: hitting the 8 ball first is a foul", () => {
    const before = postBreak();
    const after = clone(before);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        firstContact: 8,
        cushionAfterContact: true,
      }),
    );
    expect(result.foul).not.toBeNull();
    expect(result.foul!.reason).toMatch(/8 ball.*open/i);
    expect(result.state.ballInHand).toBe(true);
    expect(result.state.currentPlayer).toBe(1);
  });

  test("hitting the wrong group first is a foul", () => {
    const before = postBreak();
    before.players[0].group = "solids";
    before.players[1].group = "stripes";
    before.groupsAssigned = true;
    const after = clone(before);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        firstContact: 9, // a stripe — wrong group for player 0
        cushionAfterContact: true,
      }),
    );
    expect(result.foul).not.toBeNull();
    expect(result.foul!.reason).toMatch(/wrong group/i);
    expect(result.state.ballInHand).toBe(true);
  });

  test("no-rail-after-contact with no pot is a foul", () => {
    const before = postBreak();
    const after = clone(before);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        firstContact: 1,
        cushionAfterContact: false,
        railsHitAfterContact: 0,
        objectBallsToRail: 0,
      }),
    );
    expect(result.foul).not.toBeNull();
    expect(result.foul!.reason).toMatch(/rail/i);
  });

  test("legal pot continues the turn and clears ball-in-hand", () => {
    const before = postBreak();
    before.players[0].group = "solids";
    before.players[1].group = "stripes";
    before.groupsAssigned = true;
    const after = clone(before);
    mark(after, [1], true);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        pocketed: [1],
        firstContact: 1,
        cushionAfterContact: true,
      }),
    );
    expect(result.foul).toBeNull();
    expect(result.turnContinues).toBe(true);
    expect(result.state.currentPlayer).toBe(0);
    expect(result.state.ballInHand).toBe(false);
  });
});

// ---------------------------------------------------------------------
// THREE-FOUL RULE (optional)
// ---------------------------------------------------------------------

describe("optional three-foul rule", () => {
  function postBreak(): GameState {
    const s = makeInitialGameState(makeBalls(), ["A", "B"]);
    s.shotCount = 1;
    s.players[0].group = "solids";
    s.players[1].group = "stripes";
    s.groupsAssigned = true;
    return s;
  }

  test("three consecutive fouls ends the game when threeFoulRule is enabled", () => {
    const before = postBreak();
    before.consecutiveFouls = [2, 0]; // player 0 has two prior fouls
    const after = clone(before);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        firstContact: null, // miss = foul
      }),
      { callShotOn8: false, threeFoulRule: true },
    );
    expect(result.foul).not.toBeNull();
    expect(result.state.gameOver).not.toBeNull();
    expect(result.state.gameOver!.winner).toBe(1);
    expect(result.state.gameOver!.reason).toMatch(/three.*foul/i);
    expect(result.state.consecutiveFouls).toEqual([3, 0]);
  });

  test("three consecutive fouls do NOT end the game when threeFoulRule is disabled", () => {
    const before = postBreak();
    before.consecutiveFouls = [2, 0];
    const after = clone(before);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({ firstContact: null }),
      { callShotOn8: false, threeFoulRule: false },
    );
    expect(result.foul).not.toBeNull();
    expect(result.state.gameOver).toBeNull();
    // Tally still ticks up — important for showing the warning UI.
    expect(result.state.consecutiveFouls).toEqual([3, 0]);
  });

  test("a legal shot resets the offending player's consecutive-foul counter", () => {
    const before = postBreak();
    before.consecutiveFouls = [2, 1];
    const after = clone(before);
    mark(after, [1], true);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        pocketed: [1],
        firstContact: 1,
        cushionAfterContact: true,
      }),
      { callShotOn8: false, threeFoulRule: true },
    );
    expect(result.foul).toBeNull();
    expect(result.state.consecutiveFouls![0]).toBe(0);
    // Opponent's tally is untouched.
    expect(result.state.consecutiveFouls![1]).toBe(1);
  });
});

// ---------------------------------------------------------------------
// 8-BALL WIN / LOSS
// ---------------------------------------------------------------------

describe("8 ball win and loss handling", () => {
  function onTheEight(): GameState {
    const s = makeInitialGameState(makeBalls(), ["A", "B"]);
    s.shotCount = 5;
    s.groupsAssigned = true;
    s.players[0].group = "solids";
    s.players[1].group = "stripes";
    // Player 0 has cleared all solids.
    mark(s, [1, 2, 3, 4, 5, 6, 7], true);
    return s;
  }

  test("legally pocketing the 8 wins the game when on the 8", () => {
    const before = onTheEight();
    const after = clone(before);
    mark(after, [8], true);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        pocketed: [8],
        firstContact: 8,
        cushionAfterContact: true,
      }),
    );
    expect(result.foul).toBeNull();
    expect(result.state.gameOver).not.toBeNull();
    expect(result.state.gameOver!.winner).toBe(0);
  });

  test("pocketing the 8 before clearing your group loses the game", () => {
    const before = makeInitialGameState(makeBalls(), ["A", "B"]);
    before.shotCount = 3;
    before.groupsAssigned = true;
    before.players[0].group = "solids";
    before.players[1].group = "stripes";
    // Player 0 still has solids on the table.
    const after = clone(before);
    mark(after, [8], true);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        pocketed: [8],
        firstContact: 1,
        cushionAfterContact: true,
      }),
    );
    expect(result.foul).not.toBeNull();
    expect(result.state.gameOver).not.toBeNull();
    expect(result.state.gameOver!.winner).toBe(1);
  });

  test("scratching while pocketing the 8 (on the 8) loses the game", () => {
    const before = onTheEight();
    const after = clone(before);
    mark(after, [0, 8], true);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        pocketed: [0, 8],
        firstContact: 8,
        cushionAfterContact: true,
      }),
    );
    expect(result.foul).not.toBeNull();
    expect(result.state.gameOver).not.toBeNull();
    expect(result.state.gameOver!.winner).toBe(1);
  });
});

// ---------------------------------------------------------------------
// GROUP ASSIGNMENT
// ---------------------------------------------------------------------

describe("group assignment after the break", () => {
  test("first legal pot of a solid assigns solids to the shooter and stripes to the opponent", () => {
    const before = makeInitialGameState(makeBalls(), ["A", "B"]);
    before.shotCount = 1; // post-break, table open
    const after = clone(before);
    mark(after, [3], true);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        pocketed: [3],
        firstContact: 3,
        cushionAfterContact: true,
      }),
    );
    expect(result.foul).toBeNull();
    expect(result.state.groupsAssigned).toBe(true);
    expect(result.state.players[0].group).toBe("solids");
    expect(result.state.players[1].group).toBe("stripes");
    expect(result.turnContinues).toBe(true);
  });

  test("first legal pot of a stripe assigns stripes to the shooter", () => {
    const before = makeInitialGameState(makeBalls(), ["A", "B"]);
    before.shotCount = 1;
    const after = clone(before);
    mark(after, [11], true);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        pocketed: [11],
        firstContact: 11,
        cushionAfterContact: true,
      }),
    );
    expect(result.foul).toBeNull();
    expect(result.state.groupsAssigned).toBe(true);
    expect(result.state.players[0].group).toBe("stripes");
    expect(result.state.players[1].group).toBe("solids");
  });
});

// ---------------------------------------------------------------------
// BEHIND-HEAD-STRING FLAG
// ---------------------------------------------------------------------

describe("behind-the-head-string ball-in-hand", () => {
  test("the breaker scratching sets the behindHeadString flag for the opponent", () => {
    const before = makeInitialGameState(makeBalls(), ["A", "B"]);
    const after = clone(before);
    mark(after, [0], true);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        pocketed: [0],
        firstContact: 1,
        cushionAfterContact: true,
        objectBallsToRail: 5,
      }),
    );
    expect(result.state.ballInHand).toBe(true);
    expect(result.state.ballInHandBehindHeadString).toBe(true);
    expect(HEAD_STRING_X).toBeGreaterThan(0); // sanity: the constant exists
  });

  test("a regular post-break scratch grants ball-in-hand WITHOUT behind-head-string", () => {
    const before = makeInitialGameState(makeBalls(), ["A", "B"]);
    before.shotCount = 4; // post-break
    before.groupsAssigned = true;
    before.players[0].group = "solids";
    before.players[1].group = "stripes";
    const after = clone(before);
    mark(after, [0], true);
    const result = applyShotResult(
      before,
      after,
      emptyEvents({
        pocketed: [0],
        firstContact: 1,
        cushionAfterContact: true,
      }),
    );
    expect(result.state.ballInHand).toBe(true);
    expect(result.state.ballInHandBehindHeadString === true).toBe(false);
  });
});
