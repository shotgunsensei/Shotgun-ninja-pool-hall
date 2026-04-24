// Thin WebSocket client for the pool relay. The server is host-authoritative:
// the host runs simulation and broadcasts the result; this client only
// handles transport, reconnection, and message dispatch.

import { getClientId } from "./clientId";

export type Role = "host" | "guest";

export interface RoomState {
  code: string;
  players: { id: string; role: Role; connected: boolean }[];
}

export type ServerMessage =
  | { type: "hello" }
  | { type: "joined"; role: Role; code: string; state: RoomState }
  | { type: "peerUpdate"; state: RoomState }
  | { type: "pong"; t: number }
  | { type: "error"; error: string }
  | { type: "relay"; from: string; payload: unknown };

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "joined"
  | "closed"
  | "error";

export interface PoolNetOpts {
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: ConnectionStatus, info?: { error?: string }) => void;
}

export interface JoinParams {
  mode: "host" | "join";
  code?: string;
}

export interface PoolNet {
  status: () => ConnectionStatus;
  send: (payload: unknown) => void;
  close: () => void;
  start: (params: JoinParams) => void;
  clientId: string;
}

const BASE = "/ws/pool";

function buildWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${BASE}`;
}

export function createPoolNet(opts: PoolNetOpts): PoolNet {
  const clientId = getClientId();
  let ws: WebSocket | null = null;
  let status: ConnectionStatus = "connecting";
  let pendingJoin: JoinParams | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAttempts = 0;
  let closed = false;
  let lastJoined: { code: string; role: Role } | null = null;

  function setStatus(s: ConnectionStatus, info?: { error?: string }): void {
    status = s;
    opts.onStatus(s, info);
  }

  function performJoinPayload(): unknown {
    if (lastJoined) {
      return { type: "join", code: lastJoined.code, role: lastJoined.role, clientId };
    }
    if (pendingJoin?.mode === "host") {
      return { type: "host", clientId };
    }
    if (pendingJoin?.mode === "join" && pendingJoin.code) {
      return { type: "join", code: pendingJoin.code, role: "guest", clientId };
    }
    return null;
  }

  function open(): void {
    if (closed) return;
    setStatus("connecting");
    try {
      ws = new WebSocket(buildWsUrl());
    } catch (err) {
      setStatus("error", { error: String(err) });
      scheduleReconnect();
      return;
    }
    ws.addEventListener("open", () => {
      reconnectAttempts = 0;
      setStatus("connected");
      const payload = performJoinPayload();
      if (payload) ws?.send(JSON.stringify(payload));
    });
    ws.addEventListener("message", (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "") as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "joined") {
        lastJoined = { code: msg.code, role: msg.role };
        setStatus("joined");
      }
      opts.onMessage(msg);
    });
    ws.addEventListener("close", () => {
      ws = null;
      if (closed) return;
      setStatus("closed");
      scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      setStatus("error", { error: "WebSocket error" });
    });
  }

  function scheduleReconnect(): void {
    if (closed) return;
    if (reconnectTimer !== null) return;
    reconnectAttempts += 1;
    const delay = Math.min(8000, 500 * 2 ** Math.min(reconnectAttempts, 5));
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
  }

  return {
    status: () => status,
    clientId,
    send(payload: unknown) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "relay", payload }));
    },
    close() {
      closed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      ws = null;
    },
    start(params: JoinParams) {
      pendingJoin = params;
      open();
    },
  };
}
