// Core types shared across the pool game.

export interface Vec2 {
  x: number;
  y: number;
}

export type BallId = number; // 0 = cue, 1..7 solids, 8 = eight, 9..15 stripes

export type Group = "solids" | "stripes";

export interface Ball {
  id: BallId;
  pos: Vec2;
  vel: Vec2;
  inPocket: boolean;
}

export interface Shot {
  // Cue placement (used when ball is in hand). If undefined, current cue
  // ball position is kept.
  cuePlacement?: Vec2;
  angle: number; // radians, 0 = +x
  power: number; // 0..1
  /** Cue tip offset from the cue-ball center, normalized to (-1..1)
   *  across the ball face. x = side English (-left, +right). y = vertical
   *  (-1 = top edge / follow, +1 = bottom edge / draw). Optional —
   *  omitting it preserves the original "stun" behaviour, which keeps
   *  older clients and the bot working unchanged. */
  tipOffset?: Vec2;
  /** Pocket index the shooter is calling for the 8 ball. Only consulted
   *  when the call-shot-on-8 setting is enabled. Optional. */
  calledPocket?: number;
}

export interface ShotEvents {
  pocketed: BallId[]; // balls pocketed during the shot
  firstContact: BallId | null; // first object ball the cue ball touched
  cueHitCushion: boolean; // did the cue hit any cushion
  cushionAfterContact: boolean; // did any ball hit a cushion after first contact
  /** Total cushion contacts (any ball) after first object-ball contact. */
  railsHitAfterContact: number;
  /** Number of distinct object balls that contacted a rail at any point
   *  after first contact — used to validate break shots (≥ 4 = legal). */
  objectBallsToRail: number;
}

export interface PlayerInfo {
  name: string;
  group: Group | null;
}

/** A pending player-decision after an unusual end-of-shot state.
 *  Currently used for 8-on-break and failed-break choices. */
export type PendingChoice =
  | { type: "8OnBreak"; chooser: 0 | 1 }
  | { type: "FailedBreak"; chooser: 0 | 1 };

export interface GameState {
  balls: Ball[];
  currentPlayer: 0 | 1;
  players: [PlayerInfo, PlayerInfo];
  ballInHand: boolean;
  /** When true, the cue ball must be placed behind the head string
   *  (after a break-shot scratch). Implied false when undefined. */
  ballInHandBehindHeadString?: boolean;
  // The opening break sets these. Until first legal pot, both players play "open".
  groupsAssigned: boolean;
  gameOver: { winner: 0 | 1 | null; reason: string } | null;
  shotCount: number;
  /** Consecutive fouls per player, used by the optional 3-foul rule.
   *  Implied [0,0] when undefined. */
  consecutiveFouls?: [number, number];
  /** Pending player decision (8-on-break, failed break). null = none. */
  pendingChoice?: PendingChoice | null;
}

export interface Settings {
  aimGuide: boolean;
  tableSpeed: number; // 0.6..1.4 — multiplies friction inverse
  sound: boolean;
  vibration: boolean;
  /** Optional WPA-style call-shot rule: pocket of the 8 ball must be
   *  called and pocketed in the called pocket. Default off. */
  callShotOn8: boolean;
  /** Optional BCA 3-foul rule: three consecutive fouls = loss. Default off. */
  threeFoulRule: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  aimGuide: true,
  tableSpeed: 1,
  sound: true,
  vibration: true,
  callShotOn8: false,
  threeFoulRule: false,
};
