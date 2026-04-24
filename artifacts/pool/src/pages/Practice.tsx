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
        <h1 className="text-2xl font-semibold">Practice</h1>
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
