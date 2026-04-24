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
}

export interface ShotEvents {
  pocketed: BallId[]; // balls pocketed during the shot
  firstContact: BallId | null; // first object ball the cue ball touched
  cueHitCushion: boolean; // did the cue hit any cushion
  cushionAfterContact: boolean; // did any ball hit a cushion after first contact
}

export interface PlayerInfo {
  name: string;
  group: Group | null;
}

export interface GameState {
  balls: Ball[];
  currentPlayer: 0 | 1;
  players: [PlayerInfo, PlayerInfo];
  ballInHand: boolean;
  // The opening break sets these. Until first legal pot, both players play "open".
  groupsAssigned: boolean;
  gameOver: { winner: 0 | 1 | null; reason: string } | null;
  shotCount: number;
}

export interface Settings {
  aimGuide: boolean;
  tableSpeed: number; // 0.6..1.4 — multiplies friction inverse
  sound: boolean;
  vibration: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  aimGuide: true,
  tableSpeed: 1,
  sound: true,
  vibration: true,
};
