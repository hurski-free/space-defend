import http from "http";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { parseClientMessage } from "./messages";
import type { ServerMessage } from "./messages";
import { RoomStore } from "./roomStore";

const port = Number(process.env.PORT) || 3000;
const WS_PATH = "/ws";

/** Origins allowed for browser HTTP (ping API, etc.). Set on Render, e.g. `https://space-defend-develop.onrender.com` or comma-separated list. If unset, CORS uses `*`. */
function allowedCorsOrigins(): string[] {
  const raw = process.env.SITE_DOMAIN;
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

const CORS_ALLOWED = allowedCorsOrigins();
console.log('CORS_ALLOWED: ', CORS_ALLOWED);

function corsHeaders(req: http.IncomingMessage): Record<string, string> {
  if (CORS_ALLOWED.length === 0) {
    return { "Access-Control-Allow-Origin": "*" };
  }
  const origin = req.headers.origin;
  if (typeof origin === "string") {
    const o = origin.trim().replace(/\/+$/, "");
    if (CORS_ALLOWED.includes(o)) {
      return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
    }
  }
  return {};
}

const rooms = new RoomStore();

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcastOnlineCount(clients: Iterable<WebSocket>): void {
  let count = 0;
  for (const c of clients) {
    if (c.readyState === 1) count += 1;
  }
  const payload = JSON.stringify({ type: "online-count", count } satisfies ServerMessage);
  for (const c of clients) {
    if (c.readyState === 1) c.send(payload);
  }
}

function onSocketMessage(ws: WebSocket, raw: RawData): void {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  const msg = parseClientMessage(text);
  if (!msg) {
    send(ws, {
      type: "error",
      code: "bad-message",
      message: "Invalid or unknown message."
    });
    return;
  }

  switch (msg.type) {
    case "create-room":
      send(ws, rooms.createRoom(ws, msg.hostUsername, msg.displayName, msg.password));
      break;
    case "list-rooms":
      send(ws, rooms.listRooms());
      break;
    case "join-room":
      send(ws, rooms.joinRoom(ws, msg.roomId, msg.guestUsername, msg.password));
      break;
    case "leave-room":
      rooms.leaveRoom(ws);
      break;
    case "signal": {
      const err = rooms.relaySignal(ws, msg.payload);
      if (err) send(ws, err);
      break;
    }
    default:
      send(ws, {
        type: "error",
        code: "unhandled",
        message: "Unhandled message type."
      });
  }
}

const server = http.createServer((req, res) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...cors,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }
  if (req.url === "/" || req.url === "") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      ...cors,
    });
    res.end(JSON.stringify({ ok: true, wsPath: WS_PATH }));
    return;
  }
  res.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8",
    ...cors,
  });
  res.end("not found");
});

const wss = new WebSocketServer({ server, path: WS_PATH });

wss.on("connection", (ws) => {
  console.log("user connected");
  ws.on("message", (data) => onSocketMessage(ws, data));
  const onGone = (): void => {
    rooms.removeSocket(ws);
    queueMicrotask(() => broadcastOnlineCount(wss.clients));
  };
  ws.on("close", onGone);
  ws.on("error", onGone);
  queueMicrotask(() => broadcastOnlineCount(wss.clients));
});

server.listen(port, () => {
  console.log(`HTTP http://localhost:${port}/  WebSocket ws://localhost:${port}${WS_PATH}`);
});
