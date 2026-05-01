import http from "http";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { parseClientMessage } from "./messages";
import type { ServerMessage } from "./messages";
import { RoomStore } from "./roomStore";

const port = Number(process.env.PORT) || 3000;
const WS_PATH = "/ws";

const rooms = new RoomStore();

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
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
  if (req.url === "/" || req.url === "") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, wsPath: WS_PATH }));
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

const wss = new WebSocketServer({ server, path: WS_PATH });

wss.on("connection", (ws) => {
  ws.on("message", (data) => onSocketMessage(ws, data));
  ws.on("close", () => rooms.removeSocket(ws));
  ws.on("error", () => rooms.removeSocket(ws));
});

server.listen(port, () => {
  console.log(`HTTP http://localhost:${port}/  WebSocket ws://localhost:${port}${WS_PATH}`);
});
