import { randomUUID } from "crypto";
import type { WebSocket } from "ws";
import type { ServerMessage } from "./messages";

const MAX_DISPLAY_NAME = 64;
const MAX_SIGNAL_JSON = 64_000;

type Role = "host" | "guest";

type Attachment = {
  roomId: string | null;
  role: Role | null;
};

export type Room = {
  id: string;
  displayName: string;
  host: WebSocket;
  hostUsername: string;
  guest: WebSocket | null;
  guestUsername: string | null;
  password?: string;
};

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function safeDisplayName(raw: string | undefined): string {
  const s = (raw ?? "").trim().slice(0, MAX_DISPLAY_NAME);
  return s.length > 0 ? s : "Room";
}

export class RoomStore {
  private readonly rooms = new Map<string, Room>();
  private readonly attachment = new WeakMap<WebSocket, Attachment>();

  private getAtt(ws: WebSocket): Attachment {
    let a = this.attachment.get(ws);
    if (!a) {
      a = { roomId: null, role: null };
      this.attachment.set(ws, a);
    }
    return a;
  }

  createRoom(host: WebSocket, hostUsername?: string, displayName?: string, password?: string): ServerMessage {
    const att = this.getAtt(host);
    if (att.roomId) {
      return {
        type: "error",
        code: "already-in-room",
        message: "Leave the current room before creating a new one."
      };
    }

    if (!hostUsername) {
      return {
        type: "error",
        code: "host-username-required",
        message: "Host username is required."
      };
    }

    const id = randomUUID();
    const name = safeDisplayName(displayName);

    this.rooms.set(id, {
      id,
      hostUsername,
      displayName: name,
      host,
      guest: null,
      guestUsername: null,
      password,
    });
  
    att.roomId = id;
    att.role = "host";
    return { type: "room-created", roomId: id, displayName: name, password };
  }

  listRooms(): ServerMessage {
    const rooms = [...this.rooms.values()]
      .filter((r) => r.guest === null)
      .map((r) => ({
        roomId: r.id,
        displayName: r.displayName,
        hasPassword: Boolean(r.password),
      }));
    return { type: "room-list", rooms };
  }

  joinRoom(guest: WebSocket, roomId: string, guestUsername?: string, password?: string): ServerMessage {
    const att = this.getAtt(guest);
    if (att.roomId) {
      return {
        type: "error",
        code: "already-in-room",
        message: "Already in a room."
      };
    }

    if (!guestUsername) {
      return {
        type: "error",
        code: "guest-username-required",
        message: "Guest username is required."
      };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return {
        type: "error",
        code: "room-not-found",
        message: "Room does not exist."
      };
    }
    if (room.guest !== null) {
      return {
        type: "error",
        code: "room-full",
        message: "This room already has a guest (1v1)."
      };
    }

    if (room.password && room.password !== password) {
      return {
        type: "error",
        code: "wrong-password",
        message: "Wrong password."
      };
    }

    room.guest = guest;
    room.guestUsername = guestUsername;
    att.roomId = room.id;
    att.role = "guest";

    send(room.host, { type: "peer-joined", peerUsername: guestUsername });
    return {
      type: "joined-room",
      roomId: room.id,
      displayName: room.displayName,
      role: "guest",
      hostUsername: room.hostUsername,
    };
  }

  relaySignal(from: WebSocket, payload: unknown): ServerMessage | null {
    const att = this.attachment.get(from);
    if (!att?.roomId || !att.role) {
      return {
        type: "error",
        code: "not-in-room",
        message: "Join or create a room before signaling."
      };
    }

    const room = this.rooms.get(att.roomId);
    if (!room) {
      return {
        type: "error",
        code: "room-missing",
        message: "Room no longer exists."
      };
    }

    const peer = att.role === "host" ? room.guest : room.host;

    if (!peer || peer.readyState !== 1) {
      return {
        type: "error",
        code: "peer-not-ready",
        message: "The other peer is not connected yet."
      };
    }

    let json: string;
    try {
      json = JSON.stringify(payload);
    } catch {
      return {
        type: "error",
        code: "bad-signal",
        message: "Signal payload is not JSON-serializable."
      };
    }
    if (json.length > MAX_SIGNAL_JSON) {
      return {
        type: "error",
        code: "signal-too-large",
        message: "Signal payload is too large."
      };
    }

    send(peer, { type: "signal", payload });
    return null;
  }

  leaveRoom(ws: WebSocket): void {
    const att = this.attachment.get(ws);
    if (!att?.roomId) return;

    const room = this.rooms.get(att.roomId);
    if (!room) {
      att.roomId = null;
      att.role = null;
      return;
    }

    if (att.role === "host") {
      const guest = room.guest;
      this.rooms.delete(room.id);
      att.roomId = null;
      att.role = null;
      if (guest) {
        const ga = this.attachment.get(guest);
        if (ga) {
          ga.roomId = null;
          ga.role = null;
        }
        send(guest, { type: "room-closed", reason: "host-left" });
      }
      send(ws, { type: "left-room" });
      return;
    }

    if (att.role === "guest") {
      room.guest = null;
      att.roomId = null;
      att.role = null;
      send(room.host, { type: "peer-left" });
      send(ws, { type: "left-room" });
    }
  }

  removeSocket(ws: WebSocket): void {
    this.leaveRoom(ws);
  }
}
