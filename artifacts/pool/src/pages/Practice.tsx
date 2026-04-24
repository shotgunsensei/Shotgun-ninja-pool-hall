import type { JSX } from "react";
import { useLocation } from "wouter";
import PoolGame from "@/components/PoolGame";

export default function Practice(): JSX.Element {
  const [, navigate] = useLocation();
  return (
    <div className="h-[100dvh] w-full flex flex-col">
      <PoolGame
        mode="practice"
        playerNames={["You", "CPU"]}
        onExit={() => navigate("/")}
      />
    </div>
  );
}
