import { useState, type JSX } from "react";
import { useLocation } from "wouter";
import PoolGame from "@/components/PoolGame";
import { Button } from "@/components/ui/button";

type PracticeMode = "freeshoot" | "bot";

export default function Practice(): JSX.Element {
  const [, navigate] = useLocation();
  const [chosen, setChosen] = useState<PracticeMode | null>(null);

  if (chosen === null) {
    return (
      <div className="h-[100dvh] w-full flex flex-col items-center justify-center gap-6 p-6 bg-background text-foreground">
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm border border-primary/40 bg-primary/10 text-primary font-mono text-[10px] tracking-[0.25em] uppercase">
          SYS::PRACTICE
        </div>
        <h1 className="text-3xl font-black tracking-tight uppercase">
          Drill <span className="text-primary">Mode</span>
        </h1>
        <p className="text-sm text-muted-foreground text-center max-w-sm">
          Free shoot lets you take any shot you like — no turns, no rules. Vs CPU plays a full
          8-ball game against a basic bot.
        </p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <Button
            size="lg"
            onClick={() => setChosen("freeshoot")}
            data-testid="button-practice-freeshoot"
          >
            Free shoot
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => setChosen("bot")}
            data-testid="button-practice-bot"
          >
            Vs CPU
          </Button>
          <Button variant="ghost" onClick={() => navigate("/")}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] w-full flex flex-col">
      <PoolGame
        mode={chosen === "freeshoot" ? "freeshoot" : "practice"}
        playerNames={chosen === "freeshoot" ? ["You", "—"] : ["You", "CPU"]}
        onExit={() => navigate("/")}
      />
    </div>
  );
}
