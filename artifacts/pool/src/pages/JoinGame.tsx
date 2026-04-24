import type { JSX } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Loader2, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PoolGame from "@/components/PoolGame";
import { createPoolNet, type PoolNet, type ConnectionStatus, type ServerMessage } from "@/lib/network";
import type { GameState, Shot } from "@/lib/types";

export default function JoinGame(): JSX.Element {
  const [, navigate] = useLocation();
  const [code, setCode] = useState<string>("");
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [peerConnected, setPeerConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const netRef = useRef<PoolNet | null>(null);

  const stateListeners = useRef<Set<(state: GameState) => void>>(new Set());
  const shotListeners = useRef<Set<(shot: Shot) => void>>(new Set());

  // Read ?room= from the URL on first render
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");
    if (room) setCode(room.toUpperCase().slice(0, 4));
  }, []);

  function joinRoom(): void {
    if (code.length !== 4) {
      setErrorMsg("Codes are 4 letters/numbers");
      return;
    }
    setErrorMsg("");
    setSubmitted(true);
    if (netRef.current) {
      netRef.current.close();
    }
    const net = createPoolNet({
      onStatus: (s, info) => {
        setStatus(s);
        if (info?.error) setErrorMsg(info.error);
      },
      onMessage: (msg: ServerMessage) => {
        if (msg.type === "joined") {
          setPeerConnected(msg.state.players.length >= 2 && msg.state.players.every((p) => p.connected));
          // Ask the host for the latest authoritative state. Handles fresh
          // joins as well as mid-game reconnects.
          netRef.current?.send({ kind: "stateRequest" });
        } else if (msg.type === "peerUpdate") {
          setPeerConnected(msg.state.players.length >= 2 && msg.state.players.every((p) => p.connected));
        } else if (msg.type === "error") {
          setErrorMsg(msg.error);
          setSubmitted(false);
        } else if (msg.type === "relay") {
          const payload = msg.payload as { kind?: string; state?: GameState; shot?: Shot };
          if (payload?.kind === "state" && payload.state) {
            for (const l of stateListeners.current) l(payload.state);
          } else if (payload?.kind === "shot" && payload.shot) {
            for (const l of shotListeners.current) l(payload.shot);
          }
        }
      },
    });
    net.start({ mode: "join", code });
    netRef.current = net;
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      netRef.current?.close();
    };
  }, []);

  const network = useMemo(
    () => ({
      sendShot: (shot: Shot) => {
        netRef.current?.send({ kind: "shot", shot });
      },
      onRemoteShot: (cb: (shot: Shot) => void) => {
        shotListeners.current.add(cb);
        return () => shotListeners.current.delete(cb);
      },
      sendState: (_state: GameState) => {
        // Guest never sends state
      },
      onRemoteState: (cb: (state: GameState) => void) => {
        stateListeners.current.add(cb);
        return () => stateListeners.current.delete(cb);
      },
    }),
    [],
  );

  if (!submitted || !peerConnected) {
    return (
      <div className="min-h-[100dvh] w-full flex flex-col">
        <header className="px-3 pt-3 pb-2 flex items-center gap-2 border-b border-card-border bg-card/70">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => navigate("/")}
            aria-label="Back to menu"
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h2 className="font-semibold">Join a room</h2>
          <div className="ml-auto flex items-center gap-1 text-xs">
            {submitted && (status === "joined" || status === "connected") ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-amber-400" />
            )}
            <span className="text-muted-foreground capitalize">{submitted ? status : "Idle"}</span>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm">
            <CardContent className="p-5 flex flex-col items-stretch gap-4">
              <div>
                <Label htmlFor="code-input" className="text-xs uppercase tracking-wider">
                  Room code
                </Label>
                <Input
                  id="code-input"
                  inputMode="text"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="font-mono text-2xl tracking-[0.3em] uppercase text-center mt-2 h-14"
                  maxLength={4}
                  value={code}
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
                    setCode(v);
                  }}
                  placeholder="ABCD"
                  disabled={submitted}
                  data-testid="input-code"
                />
              </div>

              {!submitted ? (
                <Button
                  size="lg"
                  className="h-12"
                  onClick={joinRoom}
                  disabled={code.length !== 4}
                  data-testid="button-join"
                >
                  Join room
                </Button>
              ) : (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-3">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {peerConnected ? "Loading game…" : "Connecting…"}
                </div>
              )}

              {errorMsg && (
                <div className="text-xs text-destructive text-center" data-testid="text-error">
                  {errorMsg}
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] w-full flex flex-col">
      <PoolGame
        mode="online-guest"
        playerNames={["Host", "Guest"]}
        localSeat={1}
        network={network}
        onExit={() => navigate("/")}
      />
    </div>
  );
}
