import type { JSX } from "react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  TABLE_WIDTH,
  TABLE_HEIGHT,
  PLAY_LEFT,
  PLAY_RIGHT,
  PLAY_TOP,
  PLAY_BOTTOM,
  RAIL,
  BALL_RADIUS,
  POCKETS,
  POCKET_RADIUS,
  simulateShot,
  predictAimLine,
  findFreeSpot,
  makeInitialBalls,
} from "@/lib/physics";
import { applyShotResult, makeInitialGameState, ballsRemainingForGroup } from "@/lib/rules";
import { unlockAudio, sfxCue, sfxClack, sfxPocket, sfxWin, sfxLose, vibrate } from "@/lib/audio";
import { useSettings } from "@/lib/settings";
import type { GameState, Shot, Vec2 } from "@/lib/types";
import HUD from "./HUD";
import PowerMeter from "./PowerMeter";
import { Button } from "@/components/ui/button";

// =====================================================================
// Ball appearance
// =====================================================================

const BALL_COLORS: Record<number, string> = {
  0: "#f5f3ee",
  1: "#fcd34d",
  2: "#3b82f6",
  3: "#ef4444",
  4: "#7c3aed",
  5: "#f97316",
  6: "#16a34a",
  7: "#7f1d1d",
  8: "#0a0a0a",
  9: "#fcd34d",
  10: "#3b82f6",
  11: "#ef4444",
  12: "#7c3aed",
  13: "#f97316",
  14: "#16a34a",
  15: "#7f1d1d",
};

function isStripe(id: number): boolean {
  return id >= 9 && id <= 15;
}

// =====================================================================
// Component props
// =====================================================================

export type GameMode =
  | "practice"
  | "freeshoot"
  | "local"
  | "online-host"
  | "online-guest";

export interface PoolGameProps {
  mode: GameMode;
  /** Player display names (always two). */
  playerNames: [string, string];
  /** For online play, which seat this device controls (0 or 1). undefined for hot-seat. */
  localSeat?: 0 | 1;
  /** Network bridge for online play. Optional. */
  network?: {
    sendShot: (shot: Shot) => void;
    onRemoteShot: (cb: (shot: Shot) => void) => () => void;
    /** Host only: send authoritative state snapshot. */
    sendState?: (state: GameState) => void;
    onRemoteState?: (cb: (state: GameState) => void) => () => void;
  };
  /** Called when the game ends. */
  onExit?: () => void;
}

interface AimState {
  active: boolean;
  point: Vec2; // world coords
}

interface AnimState {
  ballPositions: Map<number, Vec2>;
  active: boolean;
}

// =====================================================================
// Main component
// =====================================================================

export default function PoolGame(props: PoolGameProps): JSX.Element {
  const { mode, playerNames, localSeat, network, onExit } = props;
  const [settings] = useSettings();

  // Persistent game state — current logical state (after last shot resolved).
  const [state, setState] = useState<GameState>(() =>
    makeInitialGameState(makeInitialBalls(), playerNames),
  );

  // Aim/power UI state
  const [aim, setAim] = useState<AimState>({ active: false, point: { x: 600, y: 250 } });
  const [power, setPower] = useState(0.55);
  const [animating, setAnimating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("Break time!");

  // Render-time ball positions during shot animation
  const animRef = useRef<AnimState>({ ballPositions: new Map(), active: false });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Compute "is this seat in control right now?"
  const myTurn = useMemo(() => {
    if (animating) return false;
    if (state.gameOver) return false;
    if (mode === "freeshoot") return true; // single player, no turns
    if (mode === "practice") return state.currentPlayer === 0;
    if (mode === "local") return true; // hot-seat — always
    if (localSeat === undefined) return false;
    return state.currentPlayer === localSeat;
  }, [animating, state.currentPlayer, state.gameOver, mode, localSeat]);

  // Pending cue placement (used when guest places the cue ball before shooting,
  // so the placement can be sent to the host as part of the shot intent).
  const [pendingCuePlacement, setPendingCuePlacement] = useState<Vec2 | null>(null);

  // ----- Canvas sizing & rendering -----
  const sizeRef = useRef<{ scale: number; ox: number; oy: number; w: number; h: number }>({
    scale: 1,
    ox: 0,
    oy: 0,
    w: TABLE_WIDTH,
    h: TABLE_HEIGHT,
  });

  const layoutCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const scale = Math.min(rect.width / TABLE_WIDTH, rect.height / TABLE_HEIGHT) * dpr;
    sizeRef.current = {
      scale,
      ox: (canvas.width - TABLE_WIDTH * scale) / 2,
      oy: (canvas.height - TABLE_HEIGHT * scale) / 2,
      w: canvas.width,
      h: canvas.height,
    };
  }, []);

  useEffect(() => {
    layoutCanvas();
    const onResize = (): void => layoutCanvas();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [layoutCanvas]);

  // ----- Drawing -----
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { scale, ox, oy, w, h } = sizeRef.current;

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    // Cushion frame
    ctx.fillStyle = "#3a1f12";
    ctx.fillRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT);

    // Felt
    const grad = ctx.createRadialGradient(
      TABLE_WIDTH / 2,
      TABLE_HEIGHT / 2,
      40,
      TABLE_WIDTH / 2,
      TABLE_HEIGHT / 2,
      TABLE_WIDTH / 1.4,
    );
    grad.addColorStop(0, "#15663f");
    grad.addColorStop(1, "#0c4127");
    ctx.fillStyle = grad;
    ctx.fillRect(RAIL - 4, RAIL - 4, TABLE_WIDTH - (RAIL - 4) * 2, TABLE_HEIGHT - (RAIL - 4) * 2);

    // Felt subtle line markers (head string + foot spot)
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const headX = PLAY_LEFT + (PLAY_RIGHT - PLAY_LEFT) * 0.25;
    ctx.moveTo(headX, PLAY_TOP);
    ctx.lineTo(headX, PLAY_BOTTOM);
    ctx.stroke();

    // Pockets
    for (const p of POCKETS) {
      ctx.fillStyle = "#06120c";
      ctx.beginPath();
      ctx.arc(p.x, p.y, POCKET_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Determine ball positions to draw (animation overrides logical state)
    const positions = new Map<number, Vec2>();
    for (const b of state.balls) {
      if (b.inPocket) continue;
      const p = animRef.current.active
        ? animRef.current.ballPositions.get(b.id) ?? b.pos
        : b.pos;
      positions.set(b.id, p);
    }

    // Aim guide (draw before balls so balls float on top)
    const cuePos = positions.get(0);
    if (
      myTurn &&
      cuePos &&
      !animating &&
      settings.aimGuide &&
      aim.active
    ) {
      const dx = aim.point.x - cuePos.x;
      const dy = aim.point.y - cuePos.y;
      const lenA = Math.hypot(dx, dy);
      if (lenA > 1) {
        const dir = { x: dx / lenA, y: dy / lenA };
        const end = predictAimLine(state, cuePos, dir);
        ctx.strokeStyle = "rgba(255,232,150,0.8)";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(cuePos.x, cuePos.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // ghost ball at end
        ctx.beginPath();
        ctx.arc(end.x, end.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,232,150,0.6)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Balls
    for (const [id, p] of positions) {
      drawBall(ctx, id, p);
    }

    // Cue stick (only when aiming and not animating)
    if (myTurn && cuePos && !animating && aim.active) {
      const dx = aim.point.x - cuePos.x;
      const dy = aim.point.y - cuePos.y;
      const lenA = Math.hypot(dx, dy);
      if (lenA > 5) {
        const ux = dx / lenA;
        const uy = dy / lenA;
        const back = 18 + power * 50;
        const start = { x: cuePos.x - ux * (BALL_RADIUS + back), y: cuePos.y - uy * (BALL_RADIUS + back) };
        const tail = { x: start.x - ux * 320, y: start.y - uy * 320 };
        const grad2 = ctx.createLinearGradient(start.x, start.y, tail.x, tail.y);
        grad2.addColorStop(0, "#f1b46e");
        grad2.addColorStop(0.4, "#a3673a");
        grad2.addColorStop(1, "#3b2418");
        ctx.strokeStyle = grad2;
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(tail.x, tail.y);
        ctx.stroke();
        // Tip
        ctx.fillStyle = "#3a4a6f";
        ctx.beginPath();
        ctx.arc(start.x, start.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Ball-in-hand indicator
    if (state.ballInHand && myTurn && !animating) {
      ctx.fillStyle = "rgba(255,232,150,0.85)";
      ctx.font = "600 18px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Ball in hand — tap to place cue", TABLE_WIDTH / 2, 22);
    }

    ctx.restore();
  }, [state, aim, power, myTurn, animating, settings.aimGuide]);

  function drawBall(ctx: CanvasRenderingContext2D, id: number, p: Vec2): void {
    const color = BALL_COLORS[id] ?? "#fff";
    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(p.x + 1.5, p.y + 3, BALL_RADIUS * 0.95, BALL_RADIUS * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    if (id !== 0 && id !== 8) {
      if (isStripe(id)) {
        // Stripe: white band top and bottom
        ctx.fillStyle = "#f5f3ee";
        ctx.beginPath();
        ctx.arc(p.x, p.y, BALL_RADIUS, Math.PI * 1.15, Math.PI * 1.85);
        ctx.arc(p.x, p.y, BALL_RADIUS, Math.PI * 0.15, Math.PI * 0.85, true);
        ctx.closePath();
        ctx.fill();
      }
      // Number circle
      ctx.fillStyle = "#f5f3ee";
      ctx.beginPath();
      ctx.arc(p.x, p.y, BALL_RADIUS * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.font = `700 ${Math.floor(BALL_RADIUS * 0.7)}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(id), p.x, p.y + 0.5);
    } else if (id === 8) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, BALL_RADIUS * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0a0a0a";
      ctx.font = `700 ${Math.floor(BALL_RADIUS * 0.7)}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("8", p.x, p.y + 0.5);
    }

    // Highlight
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(p.x - BALL_RADIUS * 0.35, p.y - BALL_RADIUS * 0.4, BALL_RADIUS * 0.3, BALL_RADIUS * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Continuous render loop
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  // ----- Pointer handling -----
  function pointerToWorld(ev: { clientX: number; clientY: number }): Vec2 | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cx = (ev.clientX - rect.left) * dpr;
    const cy = (ev.clientY - rect.top) * dpr;
    const { scale, ox, oy } = sizeRef.current;
    return { x: (cx - ox) / scale, y: (cy - oy) / scale };
  }

  function handlePointerDown(ev: ReactPointerEvent<HTMLCanvasElement>): void {
    unlockAudio();
    if (!myTurn || animating) return;
    const w = pointerToWorld(ev);
    if (!w) return;

    if (state.ballInHand) {
      // Snap to a free spot. For online-guest the placement must travel with
      // the shot intent so the host (authoritative) can use it. For all other
      // modes we apply locally so the cue ball moves immediately.
      const placed = findFreeSpot(state, w);
      if (mode === "online-guest") {
        setPendingCuePlacement(placed);
        // Show the cue at the chosen spot for visual feedback only.
        setState((prev) => ({
          ...prev,
          balls: prev.balls.map((b) =>
            b.id === 0
              ? { ...b, pos: placed, inPocket: false, vel: { x: 0, y: 0 } }
              : b,
          ),
        }));
      } else {
        setState((prev) => {
          const balls = prev.balls.map((b) =>
            b.id === 0
              ? { ...b, pos: placed, inPocket: false, vel: { x: 0, y: 0 } }
              : b,
          );
          return { ...prev, balls, ballInHand: false };
        });
      }
      vibrate(15, settings.vibration);
      return;
    }

    setAim({ active: true, point: w });
  }

  function handlePointerMove(ev: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!myTurn || animating) return;
    // While ball-in-hand is unresolved (no placement chosen yet) skip aim move.
    if (state.ballInHand && !(mode === "online-guest" && pendingCuePlacement)) return;
    if (!aim.active) return;
    if (ev.buttons === 0 && ev.pointerType === "mouse") return;
    const w = pointerToWorld(ev);
    if (!w) return;
    setAim({ active: true, point: w });
  }

  // ----- Shot execution -----
  const animateShot = useCallback(
    (startState: GameState, shot: Shot): Promise<{ finalState: GameState; events: ReturnType<typeof simulateShot>["events"] }> => {
      const { finalState, events } = simulateShot(startState, shot, {
        tableSpeed: settings.tableSpeed,
      });

      // For animation we re-run the simulation tick-by-tick, but more cheaply
      // we just interpolate from start positions to final positions over a
      // duration proportional to the shot's "travel".
      const startPositions = new Map<number, Vec2>();
      for (const b of startState.balls) {
        if (!b.inPocket) startPositions.set(b.id, { x: b.pos.x, y: b.pos.y });
      }

      // Estimate animation duration: longer for harder shots.
      const duration = 800 + shot.power * 1600;

      // Schedule sound effects roughly: cue strike now, pocket sounds spread out.
      sfxCue(shot.power, settings.sound);
      vibrate(Math.floor(15 + shot.power * 25), settings.vibration);
      // Approximate first contact / pocket sounds at 30% / 60% of duration
      if (events.firstContact !== null) {
        setTimeout(() => sfxClack(shot.power, settings.sound), duration * 0.3);
      }
      events.pocketed.forEach((_id, idx) => {
        setTimeout(() => sfxPocket(settings.sound), duration * (0.55 + idx * 0.1));
      });

      // Run two-phase tween: balls travel from start to a "midstate" (just past
      // first contact, approximated as 35%) using linear motion, then to final.
      // To keep things simple we use a single ease-out interpolation per ball.
      // Pocketed balls fade out near the end of their travel.
      const animationStart = performance.now();

      return new Promise((resolve) => {
        animRef.current.active = true;
        function step(now: number): void {
          const t = Math.min(1, (now - animationStart) / duration);
          // Ease out cubic
          const e = 1 - (1 - t) ** 3;
          const map = new Map<number, Vec2>();
          for (const b of finalState.balls) {
            const start = startPositions.get(b.id);
            if (!start) continue;
            if (b.inPocket) {
              if (t < 0.95) {
                map.set(b.id, {
                  x: start.x + (b.pos.x - start.x) * e,
                  y: start.y + (b.pos.y - start.y) * e,
                });
              }
            } else {
              map.set(b.id, {
                x: start.x + (b.pos.x - start.x) * e,
                y: start.y + (b.pos.y - start.y) * e,
              });
            }
          }
          animRef.current.ballPositions = map;
          if (t < 1) {
            requestAnimationFrame(step);
          } else {
            animRef.current.active = false;
            resolve({ finalState, events });
          }
        }
        requestAnimationFrame(step);
      });
    },
    [settings.tableSpeed, settings.sound, settings.vibration],
  );

  const performShot = useCallback(
    async (shot: Shot, fromRemote = false) => {
      if (animating) return;
      setAnimating(true);
      try {
        const { finalState, events } = await animateShot(state, shot);
        let resolved = applyShotResult(state, finalState, events);

        // Free-shoot mode: ignore rules — keep playing freely as player 0,
        // never end the game, never give ball-in-hand.
        if (mode === "freeshoot") {
          resolved = {
            ...resolved,
            state: {
              ...resolved.state,
              currentPlayer: 0,
              ballInHand: false,
              gameOver: null,
            },
            foul: null,
            turnContinues: true,
          };
        }

        // Status messaging
        const summary: string[] = [];
        if (resolved.foul) summary.push(`Foul: ${resolved.foul.reason}`);
        else if (resolved.potNotes.length > 0) summary.push(resolved.potNotes.join(", "));
        else summary.push("No pot");

        if (resolved.state.gameOver) {
          const winner = resolved.state.gameOver.winner;
          const winnerName = winner !== null ? resolved.state.players[winner].name : "Nobody";
          summary.push(`${winnerName} wins! (${resolved.state.gameOver.reason})`);
          if (mode === "practice") {
            if (winner === 0) sfxWin(settings.sound);
            else sfxLose(settings.sound);
          } else {
            sfxWin(settings.sound);
          }
        } else {
          summary.push(
            resolved.turnContinues
              ? `${resolved.state.players[resolved.state.currentPlayer].name} continues`
              : `${resolved.state.players[resolved.state.currentPlayer].name}'s turn`,
          );
        }
        setStatusMsg(summary.join(" — "));

        setState(resolved.state);
        setAim({ active: false, point: { x: 600, y: 250 } });

        // For host-authoritative online play, broadcast the new state after a shot.
        if (
          mode === "online-host" &&
          network?.sendState &&
          !fromRemote /* host already executes locally; result is shared via state */
        ) {
          network.sendState(resolved.state);
        }
      } finally {
        setAnimating(false);
      }
    },
    [animating, animateShot, state, mode, network, settings.sound],
  );

  // ----- Network wiring -----
  useEffect(() => {
    if (!network) return;
    if (mode === "online-host") {
      // Host receives shot intents from guest. Validate authoritatively
      // before simulating: ignore stale (out-of-turn) intents, reject
      // malformed numeric values (NaN / Infinity / out-of-range), and snap
      // any guest-supplied cue placement to a legal free spot inside the
      // play area so a malicious or buggy guest cannot corrupt the
      // simulation or place the cue ball off the table.
      const off = network.onRemoteShot((shot) => {
        if (state.currentPlayer === localSeat) return; // ignore stale
        // Schema/number validation
        if (
          typeof shot.angle !== "number" ||
          !Number.isFinite(shot.angle) ||
          typeof shot.power !== "number" ||
          !Number.isFinite(shot.power)
        ) {
          return;
        }
        const angle = shot.angle;
        const power = Math.min(1, Math.max(0.05, shot.power));
        let validated: Shot = { angle, power };
        if (shot.cuePlacement) {
          const cp = shot.cuePlacement;
          const validCp =
            cp &&
            typeof cp.x === "number" &&
            typeof cp.y === "number" &&
            Number.isFinite(cp.x) &&
            Number.isFinite(cp.y);
          if (validCp && state.ballInHand) {
            // Snap to a legal in-bounds, non-overlapping spot.
            validated = { angle, power, cuePlacement: findFreeSpot(state, cp) };
          }
          // If cuePlacement is invalid OR ballInHand is false, drop the
          // placement and use existing cue position.
        }
        void performShot(validated, true);
      });
      return off;
    }
    if (mode === "online-guest") {
      // Guest receives authoritative state snapshots from host
      if (!network.onRemoteState) return;
      const off = network.onRemoteState((newState) => {
        setState(newState);
        setAim({ active: false, point: { x: 600, y: 250 } });
        setAnimating(false);
        setStatusMsg(
          newState.gameOver
            ? `${
                newState.gameOver.winner !== null
                  ? newState.players[newState.gameOver.winner].name
                  : "Nobody"
              } wins!`
            : `${newState.players[newState.currentPlayer].name}'s turn`,
        );
      });
      return off;
    }
    return undefined;
  }, [network, mode, performShot, state.currentPlayer, localSeat]);

  // Broadcast initial state to a guest when they connect (host only)
  useEffect(() => {
    if (mode === "online-host" && network?.sendState) {
      network.sendState(state);
    }
    // We intentionally only fire on initial mount; subsequent state updates
    // are sent inside performShot to avoid loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ----- Shot trigger from UI -----
  const triggerShot = useCallback(() => {
    if (!myTurn || animating) return;
    // Online guest must have placed the cue ball first when ball-in-hand.
    if (state.ballInHand && !(mode === "online-guest" && pendingCuePlacement)) {
      setStatusMsg("Tap the table to place the cue ball first.");
      return;
    }
    const cue = state.balls.find((b) => b.id === 0);
    if (!cue) return;
    const dx = aim.point.x - cue.pos.x;
    const dy = aim.point.y - cue.pos.y;
    if (Math.hypot(dx, dy) < 1) {
      setStatusMsg("Drag on the table to aim, then shoot.");
      return;
    }
    const shot: Shot = {
      angle: Math.atan2(dy, dx),
      power,
      ...(pendingCuePlacement ? { cuePlacement: pendingCuePlacement } : {}),
    };
    if (mode === "online-guest" && network) {
      network.sendShot(shot);
      setPendingCuePlacement(null);
      setStatusMsg("Shot sent — waiting for the host to play it back.");
      return;
    }
    setPendingCuePlacement(null);
    void performShot(shot);
  }, [aim, power, state, myTurn, animating, performShot, mode, network, pendingCuePlacement]);

  // ----- Bot move (Practice "vs CPU" mode only — never in freeshoot) -----
  const lastBotShotRef = useRef<number>(0);
  useEffect(() => {
    if (mode !== "practice") return;
    if (state.gameOver) return;
    if (animating) return;
    if (state.currentPlayer !== 1) return;
    const now = Date.now();
    if (now - lastBotShotRef.current < 600) return;
    lastBotShotRef.current = now;
    const t = setTimeout(() => {
      void (async () => {
        const { chooseBotShot } = await import("@/lib/bot");
        const shot = chooseBotShot(state);
        if (state.ballInHand) {
          // Bot places cue at a sensible spot (head string)
          setState((prev) => ({
            ...prev,
            ballInHand: false,
            balls: prev.balls.map((b) =>
              b.id === 0
                ? { ...b, pos: findFreeSpot(prev, { x: 250, y: 250 }), inPocket: false, vel: { x: 0, y: 0 } }
                : b,
            ),
          }));
          // small delay so the user sees the placement
          setTimeout(() => void performShot(shot), 350);
        } else {
          void performShot(shot);
        }
      })();
    }, 700);
    return () => clearTimeout(t);
  }, [mode, state, animating, performShot]);

  // ----- New game -----
  const newGame = useCallback(() => {
    setState(makeInitialGameState(makeInitialBalls(), playerNames));
    setAim({ active: false, point: { x: 600, y: 250 } });
    setStatusMsg("Break time!");
  }, [playerNames]);

  // Broadcast new game from host
  useEffect(() => {
    if (mode === "online-host" && network?.sendState && state.shotCount === 0 && !state.gameOver) {
      network.sendState(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.shotCount === 0]);

  return (
    <div className="flex flex-col items-stretch w-full h-full">
      <HUD
        state={state}
        statusMsg={statusMsg}
        myTurn={myTurn}
        mode={mode}
        localSeat={localSeat}
        ballsLeft={{
          solids:
            state.players[0].group === "solids"
              ? ballsRemainingForGroup(state, "solids")
              : state.players[0].group === "stripes"
                ? ballsRemainingForGroup(state, "stripes")
                : ballsRemainingForGroup(state, "solids"),
          stripes:
            state.players[0].group === "solids"
              ? ballsRemainingForGroup(state, "stripes")
              : state.players[0].group === "stripes"
                ? ballsRemainingForGroup(state, "solids")
                : ballsRemainingForGroup(state, "stripes"),
        }}
        onExit={onExit}
      />

      <div
        ref={wrapRef}
        className="relative flex-1 min-h-0 w-full"
        style={{ touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          className="block w-full h-full"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
        />
      </div>

      <div className="px-3 pb-3 pt-2 flex items-center gap-3 bg-card/80 backdrop-blur border-t border-card-border">
        <PowerMeter value={power} onChange={setPower} disabled={!myTurn || animating} />
        <Button
          size="lg"
          variant="default"
          className="h-12 px-6 font-semibold"
          onClick={triggerShot}
          disabled={
            !myTurn ||
            animating ||
            (state.ballInHand && !(mode === "online-guest" && pendingCuePlacement))
          }
          data-testid="button-shoot"
        >
          {animating
            ? "..."
            : state.gameOver
              ? "Game over"
              : myTurn
                ? "Shoot"
                : mode === "practice"
                  ? "Bot's turn"
                  : "Wait"}
        </Button>
        {state.gameOver && (
          <Button
            variant="secondary"
            className="h-12"
            onClick={newGame}
            data-testid="button-new-game"
          >
            New game
          </Button>
        )}
      </div>
    </div>
  );
}
