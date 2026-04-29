import type { JSX } from "react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import QRCode from "qrcode";
import { ArrowLeft, Copy, Wifi, WifiOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import PoolGame from "@/components/PoolGame";
import { createPoolNet, type PoolNet, type ConnectionStatus, type ServerMessage } from "@/lib/network";
import type { GameState, Shot } from "@/lib/types";

export default function HostGame(): JSX.Element {
  const [, navigate] = useLocation();
  const [code, setCode] = useState<string>("");
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [peerConnected, setPeerConnected] = useState(false);
  // Once a guest has joined we consider the match "started". From then on we
  // keep PoolGame mounted (and therefore preserve authoritative game state)
  // even if the guest's connection briefly drops, so the match resumes on
  // reconnect instead of resetting.
  const [gameStarted, setGameStarted] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const netRef = useRef<PoolNet | null>(null);

  // Listeners for in-game forwarding
  const shotListeners = useRef<Set<(shot: Shot) => void>>(new Set());
  const stateListeners = useRef<Set<(state: GameState) => void>>(new Set());
  const choiceListeners = useRef<Set<(action: "accept" | "rerack") => void>>(
    new Set(),
  );
  // Cache the latest authoritative state so we can resend on reconnect or
  // when the guest explicitly asks for it (handles mid-game rejoin).
  const latestStateRef = useRef<GameState | null>(null);

  useEffect(() => {
    const net = createPoolNet({
      onStatus: (s, info) => {
        setStatus(s);
        if (info?.error) setErrorMsg(info.error);
      },
      onMessage: (msg: ServerMessage) => {
        if (msg.type === "joined") {
          setCode(msg.code);
          const allConnected =
            msg.state.players.length >= 2 && msg.state.players.every((p) => p.connected);
          setPeerConnected(allConnected);
          if (allConnected) setGameStarted(true);
        } else if (msg.type === "peerUpdate") {
          const allConnected =
            msg.state.players.length >= 2 && msg.state.players.every((p) => p.connected);
          setPeerConnected(allConnected);
          // Once the guest has joined for the first time, lock in "started"
          // so a subsequent disconnect does not unmount the game.
          if (allConnected) setGameStarted(true);
          // If the guest just (re)connected and we have an in-flight game,
          // re-broadcast the current authoritative state so they catch up.
          if (allConnected && latestStateRef.current) {
            netRef.current?.send({ kind: "state", state: latestStateRef.current });
          }
        } else if (msg.type === "error") {
          setErrorMsg(msg.error);
        } else if (msg.type === "relay") {
          const payload = msg.payload as {
            kind?: string;
            shot?: Shot;
            action?: "accept" | "rerack";
          };
          if (payload?.kind === "shot" && payload.shot) {
            for (const l of shotListeners.current) l(payload.shot);
          } else if (payload?.kind === "stateRequest") {
            // Guest is asking for a fresh snapshot.
            if (latestStateRef.current) {
              netRef.current?.send({ kind: "state", state: latestStateRef.current });
            }
          } else if (
            payload?.kind === "choice" &&
            (payload.action === "accept" || payload.action === "rerack")
          ) {
            for (const l of choiceListeners.current) l(payload.action);
          }
        }
      },
    });
    net.start({ mode: "host" });
    netRef.current = net;
    return () => net.close();
  }, []);

  // Generate QR code for the join URL
  const joinUrl = useMemo(() => {
    if (!code) return "";
    // BASE_URL is the artifact's mount path (e.g. "/" or "/pool/"). Strip the
    // trailing slash, then append the join route + room query.
    const baseRoot = import.meta.env.BASE_URL.replace(/\/$/, "");
    return `${window.location.origin}${baseRoot}/join?room=${encodeURIComponent(code)}`;
  }, [code]);

  useEffect(() => {
    if (!joinUrl) {
      setQrDataUrl("");
      return;
    }
    void QRCode.toDataURL(joinUrl, {
      margin: 1,
      width: 220,
      color: { dark: "#0a0a0a", light: "#fafafa" },
    }).then((url) => setQrDataUrl(url));
  }, [joinUrl]);

  // ---- Network bridge for PoolGame ----
  const sendState = useCallback((state: GameState) => {
    latestStateRef.current = state;
    netRef.current?.send({ kind: "state", state });
  }, []);

  const network = useMemo(
    () => ({
      sendShot: (_shot: Shot) => {
        // Host doesn't send shots — host is authoritative.
      },
      onRemoteShot: (cb: (shot: Shot) => void) => {
        shotListeners.current.add(cb);
        return () => shotListeners.current.delete(cb);
      },
      sendState,
      onRemoteState: (cb: (state: GameState) => void) => {
        stateListeners.current.add(cb);
        return () => stateListeners.current.delete(cb);
      },
      onRemoteChoice: (cb: (action: "accept" | "rerack") => void) => {
        choiceListeners.current.add(cb);
        return () => choiceListeners.current.delete(cb);
      },
    }),
    [sendState],
  );

  // ----- Lobby vs Game -----
  // Show the lobby only until the guest joins for the first time. After that,
  // a brief disconnect should NOT collapse back into the lobby (which would
  // unmount PoolGame and reset the match) — instead we keep PoolGame mounted
  // and surface a small "Opponent disconnected" banner.
  if (!gameStarted) {
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
          <h2 className="font-semibold uppercase tracking-wider text-sm">
            <span className="text-primary">SYS::HOST</span> · Room
          </h2>
          <div className="ml-auto flex items-center gap-1 text-xs">
            {status === "joined" || status === "connected" ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-amber-400" />
            )}
            <span className="text-muted-foreground capitalize">{status}</span>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm">
            <CardContent className="p-5 flex flex-col items-center gap-4">
              {!code ? (
                <div className="flex items-center gap-2 py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Creating room…
                </div>
              ) : (
                <>
                  <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground font-mono">
                    Share this code
                  </div>
                  <div
                    className="font-mono text-5xl font-black tracking-[0.2em] text-primary"
                    data-testid="text-room-code"
                  >
                    {code}
                  </div>

                  {qrDataUrl && (
                    <img
                      src={qrDataUrl}
                      alt="QR code to join the room"
                      className="rounded-md border border-card-border"
                      data-testid="img-qr"
                    />
                  )}

                  <div className="text-xs text-muted-foreground text-center break-all">
                    {joinUrl}
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      void navigator.clipboard.writeText(joinUrl).catch(() => {
                        /* ignore */
                      });
                    }}
                    data-testid="button-copy-link"
                  >
                    <Copy className="h-4 w-4 mr-1" /> Copy link
                  </Button>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-card-border w-full justify-center">
                    <Loader2 className="h-3 w-3 animate-spin" /> Waiting for opponent…
                  </div>
                </>
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
      {!peerConnected && (
        <div
          className="px-3 py-1.5 text-center text-xs bg-amber-500/15 text-amber-200 border-b border-amber-500/30"
          data-testid="banner-peer-disconnected"
        >
          <WifiOff className="inline h-3.5 w-3.5 mr-1 align-text-bottom" />
          Opponent disconnected — waiting for them to reconnect…
        </div>
      )}
      <PoolGame
        mode="online-host"
        playerNames={["Host", "Guest"]}
        localSeat={0}
        network={network}
        onExit={() => navigate("/")}
      />
    </div>
  );
}
