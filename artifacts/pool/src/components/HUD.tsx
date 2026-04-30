import type { JSX } from "react";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { GameState } from "@/lib/types";
import type { GameMode } from "./PoolGame";

interface HUDProps {
  state: GameState;
  myTurn: boolean;
  mode: GameMode;
  localSeat?: 0 | 1;
  ballsLeft: { solids: number; stripes: number };
  /** Show consecutive-foul warnings when the 3-foul rule is enabled. */
  threeFoulRule?: boolean;
  onExit?: () => void;
}

function GroupDot(props: { group: "solids" | "stripes" | null }): JSX.Element {
  const { group } = props;
  if (group === "solids") {
    return (
      <span
        className="inline-block h-2.5 w-2.5 rounded-full bg-orange-400 shrink-0"
        aria-label="Solids"
      />
    );
  }
  if (group === "stripes") {
    return (
      <span
        className="inline-block h-2.5 w-2.5 rounded-full border-2 border-blue-400 shrink-0"
        aria-label="Stripes"
      />
    );
  }
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full border border-foreground/40 shrink-0"
      aria-label="Open table"
    />
  );
}

function PlayerChip(props: {
  name: string;
  group: "solids" | "stripes" | null;
  active: boolean;
  isMe: boolean;
  count?: number;
  fouls?: number;
}): JSX.Element {
  const { name, group, active, isMe, count, fouls } = props;
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
        active
          ? "border border-primary/60 bg-primary/15 text-foreground"
          : "border border-transparent text-muted-foreground",
      )}
      data-testid={`player-card-${name}`}
    >
      <GroupDot group={group} />
      <span className="truncate font-semibold">{name}</span>
      {isMe && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          (you)
        </span>
      )}
      {typeof count === "number" && (
        <span className="font-mono tabular-nums text-foreground/90">
          {count}
        </span>
      )}
      {fouls !== undefined && fouls > 0 && (
        <Badge
          variant="destructive"
          className="ml-0.5 flex items-center gap-0.5 px-1 py-0 text-[10px]"
          title={`${fouls} consecutive foul${fouls === 1 ? "" : "s"} — three in a row loses`}
        >
          <AlertTriangle className="h-2.5 w-2.5" />
          {fouls}/3
        </Badge>
      )}
    </div>
  );
}

export default function HUD(props: HUDProps): JSX.Element {
  const { state, myTurn, mode, localSeat, ballsLeft, threeFoulRule, onExit } = props;

  const p0Active = state.currentPlayer === 0 && !state.gameOver;
  const p1Active = state.currentPlayer === 1 && !state.gameOver;

  const isMe0 = mode === "local" || mode === "practice" ? false : localSeat === 0;
  const isMe1 = mode === "local" || mode === "practice" ? false : localSeat === 1;

  const fouls = threeFoulRule ? state.consecutiveFouls : undefined;

  const p0Count =
    state.players[0].group === "solids"
      ? ballsLeft.solids
      : state.players[0].group === "stripes"
        ? ballsLeft.stripes
        : undefined;
  const p1Count =
    state.players[1].group === "solids"
      ? ballsLeft.solids
      : state.players[1].group === "stripes"
        ? ballsLeft.stripes
        : undefined;

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-card-border bg-card/70 px-2 backdrop-blur">
      {onExit && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={onExit}
          aria-label="Back to menu"
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        <PlayerChip
          name={state.players[0].name}
          group={state.players[0].group}
          active={p0Active}
          isMe={isMe0}
          count={p0Count}
          fouls={fouls?.[0]}
        />
        <span className="text-[10px] text-muted-foreground/70 shrink-0">vs</span>
        <PlayerChip
          name={state.players[1].name}
          group={state.players[1].group}
          active={p1Active}
          isMe={isMe1}
          count={p1Count}
          fouls={fouls?.[1]}
        />
      </div>
      {!state.gameOver && (
        <Badge
          variant={myTurn ? "default" : "outline"}
          className="shrink-0 text-[10px] px-1.5 py-0"
          data-testid="badge-turn"
        >
          {myTurn ? "Your shot" : "Waiting"}
        </Badge>
      )}
    </div>
  );
}
