import type { JSX } from "react";
import { useLocation } from "wouter";
import PoolGame from "@/components/PoolGame";

export default function LocalTwoPlayer(): JSX.Element {
  const [, navigate] = useLocation();
  return (
    <div className="h-[100dvh] w-full flex flex-col">
      <PoolGame
        mode="local"
        playerNames={["Player 1", "Player 2"]}
        onExit={() => navigate("/")}
      />
    </div>
  );
}
