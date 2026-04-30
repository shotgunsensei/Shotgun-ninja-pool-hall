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
  PLAY_WIDTH,
  PLAY_HEIGHT,
  RAIL,
  BALL_RADIUS,
  POCKETS,
  POCKET_RADIUS,
  CUSHIONS,
  HEAD_STRING_X,
  HEAD_SPOT,
  FOOT_SPOT,
  CORNER_RAIL_WINDOW,
  SIDE_RAIL_WINDOW,
  SIM_TICK_MS,
  simulateShot,
  predictAim,
  findFreeSpot,
  makeInitialBalls,
} from "@/lib/physics";
import {
  applyShotResult,
  makeInitialGameState,
  ballsRemainingForGroup,
  acceptTable,
  rerackAndBreak,
} from "@/lib/rules";
import { unlockAudio, sfxCue, sfxClack, sfxPocket, sfxWin, sfxLose, vibrate } from "@/lib/audio";
import { useSettings } from "@/lib/settings";
import type { GameState, Shot, Vec2 } from "@/lib/types";
import HUD from "./HUD";
import PowerMeter from "./PowerMeter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
    sendState?: (state: GameState) => void;
    onRemoteState?: (cb: (state: GameState) => void) => () => void;
    /** Guest-only: ask the host to resolve a pending 8-on-break or
     *  failed-break choice on the guest's behalf. The host is still
     *  authoritative; this just carries the chooser's intent across. */
    sendChoice?: (action: "accept" | "rerack") => void;
    /** Host-only: subscribe to choice messages forwarded by the guest. */
    onRemoteChoice?: (cb: (action: "accept" | "rerack") => void) => () => void;
  };
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
// Spin selector widget — a small cue-ball circle the player drags to
// pick where the cue tip strikes (centre = stun, top = follow, bottom
// = draw, left/right = English).
// =====================================================================

function SpinSelector(props: {
  value: Vec2;
  onChange: (v: Vec2) => void;
  disabled?: boolean;
}): JSX.Element {
  const { value, onChange, disabled } = props;
  const SIZE = 44;
  const R = SIZE / 2 - 3;
  const ref = useRef<HTMLDivElement | null>(null);

  function pick(ev: { clientX: number; clientY: number }): void {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = (ev.clientX - rect.left) - SIZE / 2;
    const cy = (ev.clientY - rect.top) - SIZE / 2;
    let nx = cx / R;
    let ny = cy / R;
    const m = Math.hypot(nx, ny);
    // Clamp to the ball's surface (ring), not the bounding square.
    if (m > 1) {
      nx /= m;
      ny /= m;
    }
    onChange({ x: nx, y: ny });
  }

  return (
    <div className="flex items-center gap-2 select-none" data-testid="spin-selector">
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label="Cue tip offset"
        title={`Tip: ${value.x.toFixed(2)}, ${value.y.toFixed(2)}`}
        className={
          "relative rounded-full border bg-card/70 " +
          (disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:border-primary/60")
        }
        style={{ width: SIZE, height: SIZE }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 0 && e.pointerType === "mouse") return;
          pick(e);
        }}
        onDoubleClick={() => onChange({ x: 0, y: 0 })}
      >
        {/* Ball */}
        <div
          className="absolute inset-1 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 32% 28%, #ffffff 0%, #e7e3d8 55%, #b8b3a4 100%)",
          }}
        />
        {/* Crosshair */}
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute left-1/2 top-1 bottom-1 border-l border-foreground/20"
            style={{ transform: "translateX(-50%)" }}
          />
          <div
            className="absolute top-1/2 left-1 right-1 border-t border-foreground/20"
            style={{ transform: "translateY(-50%)" }}
          />
        </div>
        {/* Tip dot */}
        <div
          className="absolute rounded-full bg-primary border-2 border-background pointer-events-none"
          style={{
            width: 10,
            height: 10,
            left: SIZE / 2 - 5 + value.x * R,
            top: SIZE / 2 - 5 + value.y * R,
          }}
        />
      </div>
    </div>
  );
}

// =====================================================================
// Main component
// =====================================================================

export default function PoolGame(props: PoolGameProps): JSX.Element {
  const { mode, playerNames, localSeat, network, onExit } = props;
  const [settings] = useSettings();

  const [state, setState] = useState<GameState>(() =>
    makeInitialGameState(makeInitialBalls(), playerNames),
  );

  // Aim/power UI state. Aim angle persists between shots (cue stick stays put).
  const [aim, setAim] = useState<AimState>({ active: false, point: { x: 600, y: 250 } });
  const [power, setPower] = useState(0.55);
  /** Cue tip offset, normalized -1..1 across ball face. (0,0) = stun. */
  const [tipOffset, setTipOffset] = useState<Vec2>({ x: 0, y: 0 });
  const [animating, setAnimating] = useState(false);
  const [statusMsg, setStatusMsgRaw] = useState<string>("Break time!");
  const [statusSeq, setStatusSeq] = useState(0);
  const setStatusMsg = useCallback((msg: string) => {
    setStatusMsgRaw(msg);
    setStatusSeq((n) => n + 1);
  }, []);

  const animRef = useRef<AnimState>({ ballPositions: new Map(), active: false });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const myTurn = useMemo(() => {
    if (animating) return false;
    if (state.gameOver) return false;
    if (state.pendingChoice) return false; // a decision is pending
    if (mode === "freeshoot") return true;
    if (mode === "practice") return state.currentPlayer === 0;
    if (mode === "local") return true;
    if (localSeat === undefined) return false;
    return state.currentPlayer === localSeat;
  }, [animating, state.currentPlayer, state.gameOver, state.pendingChoice, mode, localSeat]);

  const [pendingCuePlacement, setPendingCuePlacement] = useState<Vec2 | null>(null);

  // Track whether the player on the 8 should call a pocket. When the
  // call-shot setting is on AND the player has cleared their group, the
  // shoot button waits for a pocket selection.
  const onEightWithCallShot = useMemo(() => {
    if (!settings.callShotOn8) return false;
    const myGrp = state.players[state.currentPlayer].group;
    if (!myGrp) return false;
    const remaining = state.balls.filter((b) => !b.inPocket).map((b) => b.id);
    const groupIds = myGrp === "solids" ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
    return groupIds.every((id) => !remaining.includes(id));
  }, [settings.callShotOn8, state]);
  const [calledPocket, setCalledPocket] = useState<number | null>(null);
  // Reset called pocket when the on-eight condition changes.
  useEffect(() => {
    if (!onEightWithCallShot) setCalledPocket(null);
  }, [onEightWithCallShot]);

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

  // ----- Ball drawing -----
  function drawBall(ctx: CanvasRenderingContext2D, id: number, p: Vec2): void {
    const color = BALL_COLORS[id] ?? "#fff";
    const stripe = isStripe(id);
    const bodyColor = stripe ? "#f5f3ee" : color;

    // Soft elliptical shadow under the ball (offset toward bottom-right
    // matching the top-left key light below).
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(p.x + 2, p.y + 4, BALL_RADIUS * 0.95, BALL_RADIUS * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body — a small radial gradient gives a subtle directional shading
    // that reads as spherical at any zoom.
    const bodyGrad = ctx.createRadialGradient(
      p.x - BALL_RADIUS * 0.4,
      p.y - BALL_RADIUS * 0.45,
      BALL_RADIUS * 0.15,
      p.x,
      p.y,
      BALL_RADIUS * 1.05,
    );
    bodyGrad.addColorStop(0, lightenColor(bodyColor, 0.25));
    bodyGrad.addColorStop(0.6, bodyColor);
    bodyGrad.addColorStop(1, darkenColor(bodyColor, 0.35));
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    // Equatorial band for stripe balls
    if (stripe) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        p.x - BALL_RADIUS,
        p.y - BALL_RADIUS * 0.55,
        BALL_RADIUS * 2,
        BALL_RADIUS * 1.1,
      );
      ctx.clip();
      const stripeGrad = ctx.createRadialGradient(
        p.x - BALL_RADIUS * 0.4,
        p.y - BALL_RADIUS * 0.2,
        BALL_RADIUS * 0.2,
        p.x,
        p.y,
        BALL_RADIUS,
      );
      stripeGrad.addColorStop(0, lightenColor(color, 0.2));
      stripeGrad.addColorStop(0.7, color);
      stripeGrad.addColorStop(1, darkenColor(color, 0.3));
      ctx.fillStyle = stripeGrad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (id !== 0 && id !== 8) {
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

    // Edge darkening (Fresnel-like rim)
    ctx.strokeStyle = "rgba(0,0,0,0.32)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, BALL_RADIUS - 0.6, 0, Math.PI * 2);
    ctx.stroke();

    // Specular highlight (small, fixed top-left key light)
    const hl = ctx.createRadialGradient(
      p.x - BALL_RADIUS * 0.42,
      p.y - BALL_RADIUS * 0.48,
      0,
      p.x - BALL_RADIUS * 0.42,
      p.y - BALL_RADIUS * 0.48,
      BALL_RADIUS * 0.55,
    );
    hl.addColorStop(0, "rgba(255,255,255,0.85)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.ellipse(
      p.x - BALL_RADIUS * 0.42,
      p.y - BALL_RADIUS * 0.48,
      BALL_RADIUS * 0.42,
      BALL_RADIUS * 0.28,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

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

    // ===== Cushion frame (outer rail body) =====
    // Layered: dark outer rail → wood-grain accent → black inner cushion.
    // The crimson rim is the band BETWEEN the rail and the felt edge.
    const railGrad = ctx.createLinearGradient(0, 0, 0, TABLE_HEIGHT);
    railGrad.addColorStop(0, "#1c1310");
    railGrad.addColorStop(0.5, "#241612");
    railGrad.addColorStop(1, "#10090a");
    ctx.fillStyle = railGrad;
    ctx.fillRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT);

    // Inner crimson rim around the felt
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      RAIL - 5,
      RAIL - 5,
      TABLE_WIDTH - (RAIL - 5) * 2,
      TABLE_HEIGHT - (RAIL - 5) * 2,
    );

    // ===== Felt =====
    const grad = ctx.createRadialGradient(
      TABLE_WIDTH / 2,
      TABLE_HEIGHT / 2,
      40,
      TABLE_WIDTH / 2,
      TABLE_HEIGHT / 2,
      TABLE_WIDTH / 1.3,
    );
    grad.addColorStop(0, "#581218");
    grad.addColorStop(0.6, "#3a0d12");
    grad.addColorStop(1, "#170406");
    ctx.fillStyle = grad;
    ctx.fillRect(RAIL - 4, RAIL - 4, TABLE_WIDTH - (RAIL - 4) * 2, TABLE_HEIGHT - (RAIL - 4) * 2);

    // Felt grain — extremely subtle directional noise from a cached pattern.
    const grainPattern = getFeltGrain(ctx);
    if (grainPattern) {
      ctx.save();
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = grainPattern;
      ctx.fillRect(RAIL - 4, RAIL - 4, TABLE_WIDTH - (RAIL - 4) * 2, TABLE_HEIGHT - (RAIL - 4) * 2);
      ctx.restore();
    }

    // ===== Head string (kitchen line) and spots =====
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(HEAD_STRING_X, PLAY_TOP);
    ctx.lineTo(HEAD_STRING_X, PLAY_BOTTOM);
    ctx.stroke();

    // Foot spot, head spot (small white dots)
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.arc(FOOT_SPOT.x, FOOT_SPOT.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(HEAD_SPOT.x, HEAD_SPOT.y, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Behind-head-string highlight when ball is in hand from a break-scratch.
    if (state.ballInHand && state.ballInHandBehindHeadString && myTurn && !animating) {
      ctx.fillStyle = "rgba(34, 197, 94, 0.10)";
      ctx.fillRect(PLAY_LEFT, PLAY_TOP, HEAD_STRING_X - PLAY_LEFT, PLAY_HEIGHT);
      ctx.strokeStyle = "rgba(34, 197, 94, 0.55)";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(HEAD_STRING_X, PLAY_TOP);
      ctx.lineTo(HEAD_STRING_X, PLAY_BOTTOM);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ===== Diamond markers =====
    drawDiamonds(ctx);

    // ===== Pockets (drawn UNDER the cushion bevel so jaws read clearly) =====
    for (const p of POCKETS) {
      // Throat shadow — wider than the hole
      ctx.fillStyle = "#020203";
      ctx.beginPath();
      ctx.arc(p.x, p.y, POCKET_RADIUS + 2, 0, Math.PI * 2);
      ctx.fill();
      // Hole
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(p.x, p.y, POCKET_RADIUS - 1, 0, Math.PI * 2);
      ctx.fill();
      // Polished lip
      ctx.strokeStyle = "rgba(220, 38, 38, 0.55)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, POCKET_RADIUS - 1, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ===== Cushion bevel (jaws + straight sections) =====
    // A 2-band stroke: a soft lighter highlight on the felt-facing side,
    // then a darker shadow line on top of it. Drawing cushion segments
    // directly means the angled jaws around each pocket are visible too.
    for (const c of CUSHIONS) {
      const px = c.n.x;
      const py = c.n.y;
      // Highlight (3 px inside the cushion)
      ctx.strokeStyle = "rgba(255, 220, 180, 0.10)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(c.a.x + px * 1.2, c.a.y + py * 1.2);
      ctx.lineTo(c.b.x + px * 1.2, c.b.y + py * 1.2);
      ctx.stroke();
      // Shadow line right at the cushion edge
      ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(c.a.x, c.a.y);
      ctx.lineTo(c.b.x, c.b.y);
      ctx.stroke();
    }

    // ===== Determine on-table ball positions =====
    const positions = new Map<number, Vec2>();
    for (const b of state.balls) {
      if (b.inPocket) continue;
      const p = animRef.current.active
        ? animRef.current.ballPositions.get(b.id) ?? b.pos
        : b.pos;
      positions.set(b.id, p);
    }

    // ===== Aim guide =====
    const cuePos = positions.get(0);
    const showAim =
      myTurn && cuePos !== undefined && !animating && !state.ballInHand;
    if (showAim && cuePos && settings.aimGuide) {
      const dx = aim.point.x - cuePos.x;
      const dy = aim.point.y - cuePos.y;
      const lenA = Math.hypot(dx, dy);
      if (lenA > 1) {
        const dir = { x: dx / lenA, y: dy / lenA };
        const pred = predictAim(state, cuePos, dir);
        // Cue ball travel line
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(cuePos.x, cuePos.y);
        ctx.lineTo(pred.end.x, pred.end.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // Ghost ball at end
        ctx.beginPath();
        ctx.arc(pred.end.x, pred.end.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(220,38,38,0.85)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Tangent + target hint (only when the line ends on a ball)
        if (pred.hitBall && pred.contactNormal) {
          const n = pred.contactNormal;
          const target = pred.hitBall;
          // Target travel line — short solid coloured arrow from target
          // along the contact normal.
          const TARGET_HINT_LEN = 70;
          const tEnd = {
            x: target.pos.x + n.x * TARGET_HINT_LEN,
            y: target.pos.y + n.y * TARGET_HINT_LEN,
          };
          ctx.strokeStyle = "rgba(252, 211, 77, 0.85)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(target.pos.x, target.pos.y);
          ctx.lineTo(tEnd.x, tEnd.y);
          ctx.stroke();

          // Cue ball deflection (tangent line) — perpendicular to the
          // contact normal. With center strike (tipOffset.y ≈ 0) the
          // cue follows the 90° rule. Top spin biases toward the target
          // direction (follow-through); back spin biases away (draw).
          const tx = -n.y;
          const ty = n.x;
          const sideBias = tipOffset.y; // -1 (top) .. +1 (bottom)
          // Rotate the tangent slightly: top spin reduces angle (more
          // forward), draw increases it (more backward).
          const biasAngle = -sideBias * 0.6; // radians, max ~34°
          const cosA = Math.cos(biasAngle);
          const sinA = Math.sin(biasAngle);
          // Compose new direction: rotate tangent by biasAngle around z.
          // (tx, ty) rotated → (tx*cos - ty*sin, tx*sin + ty*cos), then
          // also blend a tiny bit of the negative normal (push back) when
          // there's significant draw.
          let dx2 = tx * cosA - ty * sinA;
          let dy2 = tx * sinA + ty * cosA;
          if (sideBias < 0) {
            // top spin → bias toward +n (follow through)
            dx2 += n.x * (-sideBias) * 0.45;
            dy2 += n.y * (-sideBias) * 0.45;
          } else if (sideBias > 0) {
            // draw → bias toward -n
            dx2 -= n.x * sideBias * 0.5;
            dy2 -= n.y * sideBias * 0.5;
          }
          const m2 = Math.hypot(dx2, dy2) || 1;
          const ux = dx2 / m2;
          const uy = dy2 / m2;
          const TANGENT_LEN = 80;
          ctx.strokeStyle = "rgba(255,255,255,0.55)";
          ctx.lineWidth = 1.4;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(pred.end.x, pred.end.y);
          ctx.lineTo(pred.end.x + ux * TANGENT_LEN, pred.end.y + uy * TANGENT_LEN);
          // Also draw the symmetric tangent so the player sees both
          // possible deflection sides at center strike.
          if (Math.abs(sideBias) < 0.15) {
            ctx.moveTo(pred.end.x, pred.end.y);
            ctx.lineTo(pred.end.x - ux * TANGENT_LEN, pred.end.y - uy * TANGENT_LEN);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // ===== Balls =====
    for (const [id, p] of positions) {
      drawBall(ctx, id, p);
    }

    // ===== Cue stick =====
    if (showAim && cuePos) {
      drawCueStick(ctx, cuePos, aim.point, power);
    }

    // ===== Called pocket marker =====
    if (calledPocket !== null && onEightWithCallShot && POCKETS[calledPocket]) {
      const cp = POCKETS[calledPocket]!;
      ctx.strokeStyle = "rgba(252, 211, 77, 0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, POCKET_RADIUS + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(252, 211, 77, 0.95)";
      ctx.font = "700 11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("CALLED", cp.x, cp.y + POCKET_RADIUS + 18);
    }

    // ===== Status overlays =====
    if (state.ballInHand && myTurn && !animating) {
      ctx.fillStyle = "rgba(220,38,38,0.95)";
      ctx.font = "700 18px Inter, sans-serif";
      ctx.textAlign = "center";
      const msg = state.ballInHandBehindHeadString
        ? "BALL IN HAND — BEHIND THE HEAD STRING"
        : "BALL IN HAND — TAP TO PLACE CUE";
      ctx.fillText(msg, TABLE_WIDTH / 2, 22);
    }
    if (onEightWithCallShot && calledPocket === null && myTurn && !animating && !state.ballInHand) {
      ctx.fillStyle = "rgba(252, 211, 77, 0.95)";
      ctx.font = "700 16px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("CALL A POCKET FOR THE 8 — TAP A POCKET", TABLE_WIDTH / 2, 22);
    }

    ctx.restore();
  }, [state, aim, power, myTurn, animating, settings.aimGuide, tipOffset, onEightWithCallShot, calledPocket]);

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

    // Call-shot pocket selection (when player is on the 8 ball with the
    // setting on): tapping near a pocket selects it as the called pocket.
    if (onEightWithCallShot && !state.ballInHand) {
      let bestIdx = -1;
      let bestD2 = (POCKET_RADIUS + 24) ** 2;
      for (let i = 0; i < POCKETS.length; i += 1) {
        const k = POCKETS[i]!;
        const d2 = (w.x - k.x) ** 2 + (w.y - k.y) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        setCalledPocket(bestIdx);
        vibrate(10, settings.vibration);
        return;
      }
    }

    if (state.ballInHand) {
      const placed = findFreeSpot(state, w, state.ballInHandBehindHeadString === true);
      if (mode === "online-guest") {
        setPendingCuePlacement(placed);
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
          return { ...prev, balls, ballInHand: false, ballInHandBehindHeadString: false };
        });
      }
      vibrate(15, settings.vibration);
      return;
    }

    setAim({ active: true, point: w });
  }

  function handlePointerMove(ev: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!myTurn || animating) return;
    if (state.ballInHand && !(mode === "online-guest" && pendingCuePlacement)) return;
    if (!aim.active) return;
    if (ev.buttons === 0 && ev.pointerType === "mouse") return;
    const w = pointerToWorld(ev);
    if (!w) return;
    setAim({ active: true, point: w });
  }

  // ----- Shot execution -----
  const PLAYBACK_SPEED = 1.25;
  const FRAME_INTERVAL = 2;

  const animateShot = useCallback(
    (
      startState: GameState,
      shot: Shot,
    ): Promise<{ finalState: GameState; events: ReturnType<typeof simulateShot>["events"] }> => {
      const sim = simulateShot(startState, shot, {
        tableSpeed: settings.tableSpeed,
        recordFrames: true,
        frameInterval: FRAME_INTERVAL,
      });
      const { finalState, events, frames, firstContactTick, pocketTicks, ticks } = sim;

      const tickToMs = SIM_TICK_MS / PLAYBACK_SPEED;
      const frameToMs = FRAME_INTERVAL * tickToMs;

      sfxCue(shot.power, settings.sound);
      vibrate(Math.floor(15 + shot.power * 25), settings.vibration);

      const timers: number[] = [];
      if (firstContactTick !== null) {
        timers.push(
          window.setTimeout(
            () => sfxClack(shot.power, settings.sound),
            firstContactTick * tickToMs,
          ),
        );
      }
      pocketTicks.forEach((t) => {
        timers.push(window.setTimeout(() => sfxPocket(settings.sound), t * tickToMs));
      });

      const animationStart = performance.now();
      const totalDuration = Math.max(1, ticks * tickToMs);

      return new Promise((resolve) => {
        if (!frames || frames.length === 0) {
          for (const t of timers) clearTimeout(t);
          const map = new Map<number, Vec2>();
          for (const b of finalState.balls) {
            if (!b.inPocket) map.set(b.id, { x: b.pos.x, y: b.pos.y });
          }
          animRef.current.ballPositions = map;
          animRef.current.active = false;
          resolve({ finalState, events });
          return;
        }

        animRef.current.active = true;

        function applyFrame(idx: number): void {
          const safeIdx = Math.max(0, Math.min(idx, frames.length - 1));
          const frame = frames[safeIdx];
          if (!frame) return;
          const map = new Map<number, Vec2>();
          for (const pos of frame.positions) {
            if (pos.inPocket) continue;
            map.set(pos.id, { x: pos.x, y: pos.y });
          }
          animRef.current.ballPositions = map;
        }

        function step(now: number): void {
          const elapsed = now - animationStart;
          const frameIdx = Math.floor(elapsed / frameToMs);
          if (elapsed >= totalDuration || frameIdx >= frames.length) {
            applyFrame(frames.length - 1);
            animRef.current.active = false;
            resolve({ finalState, events });
            return;
          }
          applyFrame(frameIdx);
          requestAnimationFrame(step);
        }

        requestAnimationFrame(step);
      });
    },
    [settings.tableSpeed, settings.sound, settings.vibration],
  );

  const performShot = useCallback(
    async (shot: Shot, fromRemote = false) => {
      if (animating) return;
      // Block any shot execution while an 8-on-break / failed-break choice
      // is pending. Without this guard a stale or malicious client (or a
      // race in the bot loop) could push a shot past the choice window
      // and silently skip the chooser's accept/rerack decision.
      if (state.pendingChoice) return;
      setAnimating(true);
      try {
        const { finalState, events } = await animateShot(state, shot);
        let resolved = applyShotResult(
          state,
          finalState,
          events,
          { callShotOn8: settings.callShotOn8, threeFoulRule: settings.threeFoulRule },
          { calledPocket: typeof shot.calledPocket === "number" ? shot.calledPocket : undefined },
        );

        if (mode === "freeshoot") {
          resolved = {
            ...resolved,
            state: {
              ...resolved.state,
              currentPlayer: 0,
              ballInHand: false,
              ballInHandBehindHeadString: false,
              gameOver: null,
              pendingChoice: null,
            },
            foul: null,
            turnContinues: true,
          };
        }

        // Reset called-pocket UI after the shot resolves.
        setCalledPocket(null);

        const summary: string[] = [];
        if (resolved.foul) summary.push(`Foul: ${resolved.foul.reason}`);
        else if (resolved.potNotes.length > 0) summary.push(resolved.potNotes.join(", "));
        else summary.push("No pot");

        if (resolved.state.pendingChoice) {
          if (resolved.state.pendingChoice.type === "8OnBreak") {
            summary.push("Choose: spot the 8 and play, or re-rack and re-break.");
          } else if (resolved.state.pendingChoice.type === "FailedBreak") {
            summary.push("Choose: accept the table, or re-rack and re-break.");
          }
        } else if (resolved.state.gameOver) {
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
        setAim((prev) => ({ ...prev, active: false }));

        // Host always broadcasts the post-shot authoritative state,
        // including for shots that originated from the guest. Without
        // this, a guest's own shot would update the host's view but
        // the guest would stay stuck on its pre-shot state. There is
        // no echo risk: sendState is host->guest only.
        if (mode === "online-host" && network?.sendState) {
          network.sendState(resolved.state);
        }
      } finally {
        setAnimating(false);
      }
    },
    [animating, animateShot, state, mode, network, settings.sound, settings.callShotOn8, settings.threeFoulRule],
  );

  // ----- Network wiring -----
  useEffect(() => {
    if (!network) return;
    if (mode === "online-host") {
      // Listen for the guest's choice on a pending 8-on-break / failed
      // break decision and apply it authoritatively. We re-validate
      // against the latest state inside the setState callback so a stale
      // or duplicate message can't double-apply.
      let offChoice: (() => void) | undefined;
      if (network.onRemoteChoice) {
        offChoice = network.onRemoteChoice((action) => {
          if (action !== "accept" && action !== "rerack") return;
          setState((prev) => {
            if (!prev.pendingChoice) return prev;
            // Only honor the message when the guest is actually the
            // chooser; otherwise the host's own overlay is in charge.
            if (prev.pendingChoice.chooser !== 1) return prev;
            const next =
              action === "accept"
                ? acceptTable(prev)
                : rerackAndBreak(prev, makeInitialBalls());
            if (network.sendState) network.sendState(next);
            return next;
          });
          if (action === "rerack") setStatusMsg("Re-racked. Break time!");
        });
      }
      const off = network.onRemoteShot((shot) => {
        if (state.currentPlayer === localSeat) return; // ignore stale
        // Drop any incoming shot while a player decision is pending —
        // the chooser must resolve 8-on-break / failed-break before
        // play can resume.
        if (state.pendingChoice) return;
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
        // Optional spin: validate and clamp to the unit ball face.
        if (shot.tipOffset && typeof shot.tipOffset === "object") {
          const tx = shot.tipOffset.x;
          const ty = shot.tipOffset.y;
          if (typeof tx === "number" && Number.isFinite(tx) && typeof ty === "number" && Number.isFinite(ty)) {
            let nx = Math.max(-1, Math.min(1, tx));
            let ny = Math.max(-1, Math.min(1, ty));
            const m = Math.hypot(nx, ny);
            if (m > 1) { nx /= m; ny /= m; }
            validated = { ...validated, tipOffset: { x: nx, y: ny } };
          }
        }
        // Optional called pocket: only accept a valid index.
        if (typeof shot.calledPocket === "number" && Number.isInteger(shot.calledPocket)
          && shot.calledPocket >= 0 && shot.calledPocket < POCKETS.length) {
          validated = { ...validated, calledPocket: shot.calledPocket };
        }
        if (shot.cuePlacement) {
          const cp = shot.cuePlacement;
          const validCp =
            cp &&
            typeof cp.x === "number" &&
            typeof cp.y === "number" &&
            Number.isFinite(cp.x) &&
            Number.isFinite(cp.y);
          if (validCp && state.ballInHand) {
            validated = {
              ...validated,
              cuePlacement: findFreeSpot(state, cp, state.ballInHandBehindHeadString === true),
            };
          }
        }
        void performShot(validated, true);
      });
      return () => {
        off();
        offChoice?.();
      };
    }
    if (mode === "online-guest") {
      if (!network.onRemoteState) return;
      const off = network.onRemoteState((newState) => {
        setState(newState);
        setAim((prev) => ({ ...prev, active: false }));
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
  }, [network, mode, performShot, state.currentPlayer, state.ballInHand, state.ballInHandBehindHeadString, localSeat]);

  // Broadcast initial state to a guest when they connect (host only)
  useEffect(() => {
    if (mode === "online-host" && network?.sendState) {
      network.sendState(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ----- Shot trigger from UI -----
  const triggerShot = useCallback(() => {
    if (!myTurn || animating) return;
    if (state.pendingChoice) return;
    if (state.ballInHand && !(mode === "online-guest" && pendingCuePlacement)) {
      setStatusMsg("Tap the table to place the cue ball first.");
      return;
    }
    if (onEightWithCallShot && calledPocket === null) {
      setStatusMsg("Call a pocket for the 8 ball — tap one of the six pockets.");
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
      ...(tipOffset.x !== 0 || tipOffset.y !== 0 ? { tipOffset } : {}),
      ...(onEightWithCallShot && calledPocket !== null ? { calledPocket } : {}),
    };
    if (mode === "online-guest" && network) {
      network.sendShot(shot);
      setPendingCuePlacement(null);
      setStatusMsg("Shot sent — waiting for the host to play it back.");
      return;
    }
    setPendingCuePlacement(null);
    void performShot(shot);
  }, [aim, power, tipOffset, state, myTurn, animating, performShot, mode, network, pendingCuePlacement, onEightWithCallShot, calledPocket]);

  // ----- Bot move (Practice mode only) -----
  const lastBotShotRef = useRef<number>(0);
  useEffect(() => {
    if (mode !== "practice") return;
    if (state.gameOver) return;
    if (animating) return;
    if (state.currentPlayer !== 1) return;
    if (state.pendingChoice) return; // bot doesn't make pending-choice picks here
    const now = Date.now();
    if (now - lastBotShotRef.current < 600) return;
    lastBotShotRef.current = now;
    const t = setTimeout(() => {
      void (async () => {
        const { chooseBotShot } = await import("@/lib/bot");
        const shot = chooseBotShot(state);
        if (state.ballInHand) {
          setState((prev) => {
            const target = prev.ballInHandBehindHeadString
              ? { x: HEAD_SPOT.x - 8, y: TABLE_HEIGHT / 2 }
              : { x: 250, y: 250 };
            return {
              ...prev,
              ballInHand: false,
              ballInHandBehindHeadString: false,
              balls: prev.balls.map((b) =>
                b.id === 0
                  ? { ...b, pos: findFreeSpot(prev, target, prev.ballInHandBehindHeadString === true), inPocket: false, vel: { x: 0, y: 0 } }
                  : b,
              ),
            };
          });
          setTimeout(() => void performShot(shot), 350);
        } else {
          void performShot(shot);
        }
      })();
    }, 700);
    return () => clearTimeout(t);
  }, [mode, state, animating, performShot]);

  // ----- Pending-choice resolution -----
  // When a chooser is the bot in practice mode, auto-accept after a beat.
  useEffect(() => {
    if (!state.pendingChoice) return;
    if (mode !== "practice") return;
    if (state.pendingChoice.chooser !== 1) return;
    const t = setTimeout(() => {
      // Bot always accepts the table — keeps things moving.
      setState((prev) => acceptTable(prev));
    }, 700);
    return () => clearTimeout(t);
  }, [state.pendingChoice, mode]);

  // The chooser of an 8-on-break / failed-break decision is whoever
  // didn't break (carried in pendingChoice.chooser). For online play
  // each side resolves on their own device when they are the chooser:
  // the guest's click is sent to the host as a "choice" message, the
  // host applies it authoritatively and broadcasts the new state. For
  // hot-seat / practice the active player on this device makes the
  // call directly.
  const myChoice = !!state.pendingChoice && (() => {
    if (mode === "freeshoot") return false;
    if (mode === "local" || mode === "practice") return true;
    if (localSeat === undefined) return false;
    return state.pendingChoice!.chooser === localSeat;
  })();

  // Tracks "I clicked accept/rerack as the guest and am awaiting the
  // host's authoritative state echo". Reset whenever pendingChoice
  // changes (resolves, or a new choice appears). Also auto-resets after
  // a short timeout so a dropped message during a flaky connection
  // doesn't leave the chooser stuck on a "Sending…" indicator forever
  // — they get the overlay back and can click again.
  const [sendingChoice, setSendingChoice] = useState(false);
  useEffect(() => {
    setSendingChoice(false);
  }, [state.pendingChoice]);
  useEffect(() => {
    if (!sendingChoice) return;
    const t = window.setTimeout(() => setSendingChoice(false), 4000);
    return () => window.clearTimeout(t);
  }, [sendingChoice]);

  function chooseAccept(): void {
    if (mode === "online-guest" && network?.sendChoice) {
      network.sendChoice("accept");
      setSendingChoice(true);
      setStatusMsg("Choice sent — waiting for the host to apply it…");
      return;
    }
    setState((prev) => {
      if (!prev.pendingChoice) return prev;
      const next = acceptTable(prev);
      if (mode === "online-host" && network?.sendState) network.sendState(next);
      return next;
    });
  }
  function chooseRerack(): void {
    if (mode === "online-guest" && network?.sendChoice) {
      network.sendChoice("rerack");
      setSendingChoice(true);
      setStatusMsg("Choice sent — waiting for the host to apply it…");
      return;
    }
    setState((prev) => {
      if (!prev.pendingChoice) return prev;
      const next = rerackAndBreak(prev, makeInitialBalls());
      if (mode === "online-host" && network?.sendState) network.sendState(next);
      return next;
    });
    setStatusMsg("Re-racked. Break time!");
  }

  // ----- New game -----
  const newGame = useCallback(() => {
    setState(makeInitialGameState(makeInitialBalls(), playerNames));
    setAim({ active: false, point: { x: 600, y: 250 } });
    setStatusMsg("Break time!");
    setTipOffset({ x: 0, y: 0 });
    setCalledPocket(null);
  }, [playerNames]);

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
        myTurn={myTurn}
        mode={mode}
        localSeat={localSeat}
        threeFoulRule={settings.threeFoulRule}
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
        <StatusToast message={statusMsg} seq={statusSeq} />
        {state.pendingChoice && myChoice && !sendingChoice && (
          <PendingChoiceOverlay
            choice={state.pendingChoice}
            onAccept={chooseAccept}
            onRerack={chooseRerack}
          />
        )}
        {state.pendingChoice && (!myChoice || sendingChoice) && (
          <div className="absolute inset-x-0 top-2 flex justify-center pointer-events-none">
            <div
              className="px-3 py-1.5 rounded-md bg-card/85 border border-card-border text-xs"
              data-testid="banner-waiting-choice"
            >
              {sendingChoice
                ? "Sending your choice…"
                : "Waiting for opponent's choice…"}
            </div>
          </div>
        )}
      </div>

      <div className="flex h-12 shrink-0 items-center gap-2 border-t border-card-border bg-card/80 px-2 backdrop-blur">
        <SpinSelector value={tipOffset} onChange={setTipOffset} disabled={!myTurn || animating} />
        <PowerMeter value={power} onChange={setPower} disabled={!myTurn || animating} />
        <Button
          variant="default"
          className="h-10 px-4 font-semibold shrink-0"
          onClick={triggerShot}
          disabled={
            !myTurn ||
            animating ||
            !!state.pendingChoice ||
            (state.ballInHand && !(mode === "online-guest" && pendingCuePlacement)) ||
            (onEightWithCallShot && calledPocket === null)
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
            className="h-10 shrink-0"
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

// ---------------------------------------------------------------------
// Transient status toast: shows over the canvas for ~2.6s after the
// status message changes, then auto-fades. The `seq` prop bumps every
// time the parent calls setStatusMsg so even an identical message
// (e.g. two consecutive "No pot — opponent's turn" outcomes) re-shows
// and restarts the timer.
//
// Two render paths:
//   - The visual toast over the canvas (transient, decorative).
//   - A persistent `role="status" aria-live="polite"` sr-only mirror
//     so screen-reader users always hear the latest status text even
//     after the visual toast has faded. Keeps `data-testid="status-msg"`
//     for e2e tests and pairs with the canvas-drawn HUD prompts which
//     are otherwise inaccessible.
// ---------------------------------------------------------------------
function StatusToast(props: { message: string; seq: number }): JSX.Element {
  const { message, seq } = props;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!message) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 2600);
    return () => window.clearTimeout(t);
  }, [message, seq]);
  return (
    <>
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-1.5 flex justify-center transition-opacity duration-300",
          visible ? "opacity-100" : "opacity-0",
        )}
        aria-hidden="true"
      >
        <div className="max-w-[90%] truncate rounded-md border border-card-border bg-card/85 px-3 py-1 text-xs text-foreground/90 shadow-sm">
          {message}
        </div>
      </div>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="status-msg"
      >
        {message}
      </div>
    </>
  );
}

// =====================================================================
// Helpers (canvas drawing primitives)
// =====================================================================

function drawDiamonds(ctx: CanvasRenderingContext2D): void {
  // Six diamonds per long rail (at 1/8, 2/8, ..., 7/8 of width — but
  // skip the position directly under the side pocket which sits at 4/8
  // and is replaced by the pocket itself). Three per short rail at
  // 1/4, 2/4 (= mid-height), 3/4.
  const longCount = 8; // segments
  const shortCount = 4;
  const D = 4; // half-size of diamond shape

  function diamondAt(x: number, y: number): void {
    ctx.fillStyle = "#f1f1ec";
    ctx.beginPath();
    ctx.moveTo(x, y - D);
    ctx.lineTo(x + D, y);
    ctx.lineTo(x, y + D);
    ctx.lineTo(x - D, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // Top + bottom rails: diamonds drawn ON the rail (just outside the
  // play area), centered vertically in the rail thickness.
  for (let i = 1; i < longCount; i += 1) {
    if (i === longCount / 2) continue; // skip side pocket position
    const x = PLAY_LEFT + (PLAY_WIDTH * i) / longCount;
    diamondAt(x, PLAY_TOP - RAIL / 2);
    diamondAt(x, PLAY_BOTTOM + RAIL / 2);
  }
  // Left + right rails
  for (let i = 1; i < shortCount; i += 1) {
    const y = PLAY_TOP + (PLAY_HEIGHT * i) / shortCount;
    diamondAt(PLAY_LEFT - RAIL / 2, y);
    diamondAt(PLAY_RIGHT + RAIL / 2, y);
  }
}

function drawCueStick(
  ctx: CanvasRenderingContext2D,
  cuePos: Vec2,
  aimPoint: Vec2,
  power: number,
): void {
  const dx = aimPoint.x - cuePos.x;
  const dy = aimPoint.y - cuePos.y;
  const lenA = Math.hypot(dx, dy);
  if (lenA <= 5) return;
  const ux = dx / lenA;
  const uy = dy / lenA;
  const back = 18 + power * 50;
  const idealGap = BALL_RADIUS + back;
  const idealStick = 360;
  const margin = 6;

  let maxBehind = Infinity;
  if (-ux > 0) maxBehind = Math.min(maxBehind, (TABLE_WIDTH - margin - cuePos.x) / -ux);
  if (-ux < 0) maxBehind = Math.min(maxBehind, (margin - cuePos.x) / -ux);
  if (-uy > 0) maxBehind = Math.min(maxBehind, (TABLE_HEIGHT - margin - cuePos.y) / -uy);
  if (-uy < 0) maxBehind = Math.min(maxBehind, (margin - cuePos.y) / -uy);
  if (!Number.isFinite(maxBehind)) maxBehind = idealGap + idealStick;

  const totalBehind = Math.max(0, Math.min(idealGap + idealStick, maxBehind));
  const startGap = Math.min(idealGap, totalBehind);
  const stickLen = Math.max(0, totalBehind - startGap);

  const start = { x: cuePos.x - ux * startGap, y: cuePos.y - uy * startGap };

  if (stickLen >= 4) {
    // The cue stick is split into three sections from tip → butt:
    //   ferrule (white tip ~6% of length, capped at 9 units)
    //   wrap (coloured grip, ~22% of length)
    //   shaft (light wood) → butt (dark wood, last 35%)
    const tail = { x: start.x - ux * stickLen, y: start.y - uy * stickLen };
    const ferruleLen = Math.min(9, stickLen * 0.06);
    const wrapStart = stickLen * 0.55;
    const wrapEnd = stickLen * 0.78;

    const ferruleEnd = { x: start.x - ux * ferruleLen, y: start.y - uy * ferruleLen };
    const wrapA = { x: start.x - ux * wrapStart, y: start.y - uy * wrapStart };
    const wrapB = { x: start.x - ux * wrapEnd, y: start.y - uy * wrapEnd };

    // Shaft (ferrule end → wrap start): light maple
    const shaftGrad = ctx.createLinearGradient(ferruleEnd.x, ferruleEnd.y, wrapA.x, wrapA.y);
    shaftGrad.addColorStop(0, "#f3d9b1");
    shaftGrad.addColorStop(1, "#d4a35a");
    ctx.strokeStyle = shaftGrad;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ferruleEnd.x, ferruleEnd.y);
    ctx.lineTo(wrapA.x, wrapA.y);
    ctx.stroke();

    // Wrap (grip)
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    ctx.moveTo(wrapA.x, wrapA.y);
    ctx.lineTo(wrapB.x, wrapB.y);
    ctx.stroke();
    // Wrap rib pattern
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 0.7;
    const ribCount = Math.max(2, Math.floor((wrapEnd - wrapStart) / 4));
    for (let i = 1; i < ribCount; i += 1) {
      const tt = i / ribCount;
      const x = wrapA.x + (wrapB.x - wrapA.x) * tt;
      const y = wrapA.y + (wrapB.y - wrapA.y) * tt;
      const px = -uy;
      const py = ux;
      ctx.beginPath();
      ctx.moveTo(x + px * 2.5, y + py * 2.5);
      ctx.lineTo(x - px * 2.5, y - py * 2.5);
      ctx.stroke();
    }

    // Butt (wrap end → tail): dark wood with a matte sheen
    const buttGrad = ctx.createLinearGradient(wrapB.x, wrapB.y, tail.x, tail.y);
    buttGrad.addColorStop(0, "#5a3320");
    buttGrad.addColorStop(0.6, "#3a1f12");
    buttGrad.addColorStop(1, "#1a0c08");
    ctx.strokeStyle = buttGrad;
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    ctx.moveTo(wrapB.x, wrapB.y);
    ctx.lineTo(tail.x, tail.y);
    ctx.stroke();
    // Butt cap
    ctx.fillStyle = "#0f0a08";
    ctx.beginPath();
    ctx.arc(tail.x, tail.y, 3.6, 0, Math.PI * 2);
    ctx.fill();

    // Ferrule (white plastic at tip)
    ctx.strokeStyle = "#f8f5ec";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(ferruleEnd.x, ferruleEnd.y);
    ctx.stroke();
  }

  // Tip — always shown so the player sees exactly where the cue contacts.
  ctx.fillStyle = "#3a4a6f";
  ctx.beginPath();
  ctx.arc(start.x, start.y, 3, 0, Math.PI * 2);
  ctx.fill();
}

// Cached felt grain pattern (created once per canvas).
let cachedGrain: { ctx: CanvasRenderingContext2D; pattern: CanvasPattern | null } | null = null;
function getFeltGrain(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (cachedGrain && cachedGrain.ctx === ctx) return cachedGrain.pattern;
  const off = document.createElement("canvas");
  off.width = 64;
  off.height = 64;
  const octx = off.getContext("2d");
  if (!octx) {
    cachedGrain = { ctx, pattern: null };
    return null;
  }
  const img = octx.createImageData(off.width, off.height);
  for (let i = 0; i < img.data.length; i += 4) {
    // Random low-amplitude noise. Grain has a slight horizontal bias.
    const n = (Math.random() * 60) | 0;
    img.data[i] = n;
    img.data[i + 1] = n * 0.6;
    img.data[i + 2] = n * 0.4;
    img.data[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  const p = ctx.createPattern(off, "repeat");
  cachedGrain = { ctx, pattern: p };
  return p;
}

// Color helpers — light/dark a hex color by a factor (0..1).
function lightenColor(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex);
  const nr = Math.min(255, r + (255 - r) * amount);
  const ng = Math.min(255, g + (255 - g) * amount);
  const nb = Math.min(255, b + (255 - b) * amount);
  return `rgb(${nr | 0}, ${ng | 0}, ${nb | 0})`;
}
function darkenColor(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgb(${(r * (1 - amount)) | 0}, ${(g * (1 - amount)) | 0}, ${(b * (1 - amount)) | 0})`;
}
function parseHex(hex: string): { r: number; g: number; b: number } {
  if (hex.startsWith("rgb")) {
    const m = hex.match(/\d+/g);
    if (m && m.length >= 3) return { r: +m[0]!, g: +m[1]!, b: +m[2]! };
  }
  const h = hex.replace("#", "");
  const v =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(v, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

// =====================================================================
// Pending choice overlay (8-on-break, failed break)
// =====================================================================

function PendingChoiceOverlay(props: {
  choice: { type: "8OnBreak" | "FailedBreak"; chooser: 0 | 1 };
  onAccept: () => void;
  onRerack: () => void;
}): JSX.Element {
  const { choice, onAccept, onRerack } = props;
  const title = choice.type === "8OnBreak" ? "8-ball pocketed on the break" : "Failed break";
  const body =
    choice.type === "8OnBreak"
      ? "The 8-ball was pocketed on the opening break. The 8 has been spotted at the foot. Choose to play on, or re-rack and re-break."
      : "The break failed (no ball pocketed and fewer than four to a rail). Accept the table as it lies, or re-rack and break yourself.";
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-sm p-4">
      <div className="max-w-md w-full rounded-lg border border-card-border bg-card p-5 shadow-lg">
        <div className="font-semibold text-base mb-1">{title}</div>
        <p className="text-sm text-muted-foreground mb-4">{body}</p>
        <div className="flex gap-2">
          <Button onClick={onAccept} className="flex-1" data-testid="button-accept-table">
            Play the table
          </Button>
          <Button onClick={onRerack} variant="secondary" className="flex-1" data-testid="button-rerack">
            Re-rack &amp; re-break
          </Button>
        </div>
      </div>
    </div>
  );
}
