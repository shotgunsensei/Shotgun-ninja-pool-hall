import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { logger } from "./logger";

interface RoomPlayer {
  id: string;
  ws: WebSocket | null;
  role: "host" | "guest";
  alive: boolean;
}

interface PoolRoom {
  code: string;
  createdAt: number;
  players: RoomPlayer[];
  lastActivity: number;
}

const ROOMS = new Map<string, PoolRoom>();
const ROOM_TTL_MS = 1000 * 60 * 60;
const CLIENT_TIMEOUT_MS = 1000 * 60 * 5;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(): string {
  let code = "";
  for (let i = 0; i < 4; i += 1) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

function makeUniqueCode(): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = makeCode();
    if (!ROOMS.has(code)) return code;
  }
  return makeCode() + makeCode();
}

function getRoom(code: string): PoolRoom | null {
  return ROOMS.get(code.toUpperCase()) ?? null;
}

function cleanupRooms(): void {
  const now = Date.now();
  for (const [code, room] of ROOMS) {
    const aliveCount = room.players.filter((p) => p.ws && p.alive).length;
    const stale = now - room.lastActivity > ROOM_TTL_MS;
    if (aliveCount === 0 && stale) {
      ROOMS.delete(code);
    }
  }
}

setInterval(cleanupRooms, 1000 * 60).unref();

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (err) {
    logger.warn({ err }, "Failed to send WS message");
  }
}

function broadcast(room: PoolRoom, payload: unknown, except?: WebSocket): void {
  for (const p of room.players) {
    if (!p.ws) continue;
    if (p.ws === except) continue;
    send(p.ws, payload);
  }
}

function buildRoomState(room: PoolRoom): Record<string, unknown> {
  return {
    code: room.code,
    players: room.players.map((p) => ({
      id: p.id,
      role: p.role,
      connected: !!(p.ws && p.alive),
    })),
  };
}

interface ClientCtx {
  ws: WebSocket;
  clientId: string | null;
  room: PoolRoom | null;
}

function attachClientToRoom(
  ctx: ClientCtx,
  room: PoolRoom,
  clientId: string,
  preferRole: "host" | "guest" | null,
): { ok: true; role: "host" | "guest" } | { ok: false; error: string } {
  // If client already exists in room, reattach
  const existing = room.players.find((p) => p.id === clientId);
  if (existing) {
    if (existing.ws && existing.ws !== ctx.ws) {
      try {
        existing.ws.close();
      } catch {
        /* ignore */
      }
    }
    existing.ws = ctx.ws;
    existing.alive = true;
    return { ok: true, role: existing.role };
  }

  // New client. If a player slot of the requested role exists but is
  // disconnected (e.g. the original guest closed the tab), allow this new
  // client to take over that slot. This makes rejoining a room from a fresh
  // browser session "just work" instead of returning "Room is full".
  if (preferRole === "host") {
    const liveHost = room.players.find(
      (p) => p.role === "host" && p.ws && p.alive,
    );
    if (liveHost) {
      return { ok: false, error: "Host slot already taken" };
    }
    const staleHost = room.players.find((p) => p.role === "host");
    if (staleHost) {
      staleHost.id = clientId;
      staleHost.ws = ctx.ws;
      staleHost.alive = true;
      return { ok: true, role: "host" };
    }
    room.players.push({ id: clientId, ws: ctx.ws, role: "host", alive: true });
    return { ok: true, role: "host" };
  }

  // Guest
  const liveGuest = room.players.find(
    (p) => p.role === "guest" && p.ws && p.alive,
  );
  if (liveGuest) {
    return { ok: false, error: "Room is full" };
  }
  if (!room.players.some((p) => p.role === "host")) {
    return { ok: false, error: "No host in room" };
  }
  const staleGuest = room.players.find((p) => p.role === "guest");
  if (staleGuest) {
    staleGuest.id = clientId;
    staleGuest.ws = ctx.ws;
    staleGuest.alive = true;
    return { ok: true, role: "guest" };
  }
  room.players.push({ id: clientId, ws: ctx.ws, role: "guest", alive: true });
  return { ok: true, role: "guest" };
}

function handleMessage(ctx: ClientCtx, raw: string): void {
  let msg: { type?: string; [key: string]: unknown };
  try {
    msg = JSON.parse(raw) as typeof msg;
  } catch {
    send(ctx.ws, { type: "error", error: "Invalid JSON" });
    return;
  }

  const type = msg.type;

  if (type === "host") {
    const clientId = String(msg["clientId"] ?? "");
    if (!clientId) {
      send(ctx.ws, { type: "error", error: "Missing clientId" });
      return;
    }
    const code = makeUniqueCode();
    const room: PoolRoom = {
      code,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      players: [],
    };
    ROOMS.set(code, room);
    const att = attachClientToRoom(ctx, room, clientId, "host");
    if (!att.ok) {
      send(ctx.ws, { type: "error", error: att.error });
      return;
    }
    ctx.clientId = clientId;
    ctx.room = room;
    send(ctx.ws, {
      type: "joined",
      role: att.role,
      code,
      state: buildRoomState(room),
    });
    return;
  }

  if (type === "join") {
    const clientId = String(msg["clientId"] ?? "");
    const codeRaw = String(msg["code"] ?? "");
    const role = msg["role"] === "host" ? "host" : "guest";
    if (!clientId || !codeRaw) {
      send(ctx.ws, { type: "error", error: "Missing clientId or code" });
      return;
    }
    const room = getRoom(codeRaw);
    if (!room) {
      send(ctx.ws, { type: "error", error: "Room not found" });
      return;
    }
    const att = attachClientToRoom(ctx, room, clientId, role);
    if (!att.ok) {
      send(ctx.ws, { type: "error", error: att.error });
      return;
    }
    ctx.clientId = clientId;
    ctx.room = room;
    room.lastActivity = Date.now();
    send(ctx.ws, {
      type: "joined",
      role: att.role,
      code: room.code,
      state: buildRoomState(room),
    });
    broadcast(
      room,
      { type: "peerUpdate", state: buildRoomState(room) },
      ctx.ws,
    );
    return;
  }

  if (type === "ping") {
    send(ctx.ws, { type: "pong", t: msg["t"] ?? Date.now() });
    return;
  }

  if (type === "relay") {
    if (!ctx.room) {
      send(ctx.ws, { type: "error", error: "Not in a room" });
      return;
    }
    ctx.room.lastActivity = Date.now();
    // Forward payload to all other peers
    broadcast(
      ctx.room,
      {
        type: "relay",
        from: ctx.clientId,
        payload: msg["payload"],
      },
      ctx.ws,
    );
    return;
  }

  send(ctx.ws, { type: "error", error: `Unknown type: ${String(type)}` });
}

function handleClose(ctx: ClientCtx): void {
  if (!ctx.room || !ctx.clientId) return;
  const player = ctx.room.players.find((p) => p.id === ctx.clientId);
  if (player) {
    player.ws = null;
    player.alive = false;
  }
  broadcast(ctx.room, {
    type: "peerUpdate",
    state: buildRoomState(ctx.room),
  });

  // Schedule eventual removal of stale players
  const room = ctx.room;
  setTimeout(() => {
    const idx = room.players.findIndex(
      (p) => p.id === ctx.clientId && !p.ws,
    );
    if (idx >= 0) {
      room.players.splice(idx, 1);
      broadcast(room, { type: "peerUpdate", state: buildRoomState(room) });
    }
  }, CLIENT_TIMEOUT_MS).unref();
}

export function attachPoolWebSocketServer(
  wss: WebSocketServer,
): void {
  wss.on(
    "connection",
    (ws: WebSocket, _req: IncomingMessage) => {
      const ctx: ClientCtx = { ws, clientId: null, room: null };

      // Heartbeat to detect dead connections
      let alive = true;
      const interval = setInterval(() => {
        if (!alive) {
          try {
            ws.terminate();
          } catch {
            /* ignore */
          }
          clearInterval(interval);
          return;
        }
        alive = false;
        try {
          ws.ping();
        } catch {
          /* ignore */
        }
      }, 30_000);
      ws.on("pong", () => {
        alive = true;
      });

      ws.on("message", (data) => {
        const raw = typeof data === "string" ? data : data.toString();
        try {
          handleMessage(ctx, raw);
        } catch (err) {
          logger.warn({ err }, "Error handling pool WS message");
          send(ws, { type: "error", error: "Internal error" });
        }
      });
      ws.on("close", () => {
        clearInterval(interval);
        handleClose(ctx);
      });
      ws.on("error", (err) => {
        logger.warn({ err }, "Pool WS error");
      });

      send(ws, { type: "hello" });
    },
  );
}
