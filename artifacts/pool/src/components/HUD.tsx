import type { JSX } from "react";
import { ArrowLeft, Circle, Disc, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { GameState } from "@/lib/types";
import type { GameMode } from "./PoolGame";

interface HUDProps {
  state: GameState;
  statusMsg: string;
  myTurn: boolean;
  mode: GameMode;
  localSeat?: 0 | 1;
  ballsLeft: { solids: number; stripes: number };
  onExit?: () => void;
}

function PlayerCard(props: {
  name: string;
  group: "solids" | "stripes" | null;
  active: boolean;
  isMe: boolean;
  count?: number;
}): JSX.Element {
  const { name, group, active, isMe, count } = props;
  return (
    <div
      className={cn(
        "flex-1 min-w-0 rounded-md border px-3 py-2 transition-colors",
        active
          ? "border-primary/60 bg-primary/10"
          : "border-card-border bg-card/60",
      )}
      data-testid={`player-card-${name}`}
    >
      <div className="flex items-center gap-2">
        <div className="text-sm font-semibold truncate">{name}</div>
        {isMe && (
          <Badge variant="secondary" className="text-[10px] px-1 py-0">
            you
          </Badge>
        )}
        {active && (
          <Target className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        )}
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        {group === "solids" && (
          <>
            <Circle className="h-3 w-3 fill-current text-orange-400" />
            <span>Solids</span>
          </>
        )}
        {group === "stripes" && (
          <>
            <Disc className="h-3 w-3 text-blue-400" />
            <span>Stripes</span>
          </>
        )}
        {group === null && <span>Open</span>}
        {typeof count === "number" && (
          <span className="ml-auto font-mono text-foreground">{count} left</span>
        )}
      </div>
    </div>
  );
}

export default function HUD(props: HUDProps): JSX.Element {
  const { state, statusMsg, myTurn, mode, localSeat, ballsLeft, onExit } = props;

  const p0Active = state.currentPlayer === 0 && !state.gameOver;
  const p1Active = state.currentPlayer === 1 && !state.gameOver;

  const isMe0 = mode === "local" || mode === "practice" ? false : localSeat === 0;
  const isMe1 = mode === "local" ? false : mode === "practice" ? false : localSeat === 1;

  return (
    <div className="flex flex-col gap-2 px-3 pt-3 pb-2 bg-card/70 backdrop-blur border-b border-card-border">
      <div className="flex items-center gap-2">
        {onExit && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={onExit}
            aria-label="Back to menu"
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <div className="flex-1 text-xs text-muted-foreground truncate" data-testid="status-msg">
          {statusMsg}
        </div>
        {!state.gameOver && (
          <Badge
            variant={myTurn ? "default" : "outline"}
            className="text-[11px]"
            data-testid="badge-turn"
          >
            {myTurn ? "Your shot" : "Waiting"}
          </Badge>
        )}
      </div>
      <div className="flex gap-2">
        <PlayerCard
          name={state.players[0].name}
          group={state.players[0].group}
          active={p0Active}
          isMe={isMe0}
          count={state.players[0].group === "solids" ? ballsLeft.solids : state.players[0].group === "stripes" ? ballsLeft.stripes : undefined}
        />
        <PlayerCard
          name={state.players[1].name}
          group={state.players[1].group}
          active={p1Active}
          isMe={isMe1}
          count={state.players[1].group === "solids" ? ballsLeft.solids : state.players[1].group === "stripes" ? ballsLeft.stripes : undefined}
        />
      </div>
    </div>
  );
}
