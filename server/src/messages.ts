export type ClientMessage =
  | { type: "create-room"; hostUsername?: string; displayName?: string; password?: string }
  | { type: "list-rooms" }
  | { type: "join-room"; roomId: string; guestUsername?: string; password?: string }
  | { type: "signal"; payload: unknown }
  | { type: "leave-room" };

export type ServerMessage =
  | { type: "room-created"; roomId: string; displayName: string; password?: string }
  | {
      type: "room-list";
      rooms: Array<{
        roomId: string;
        displayName: string;
        hasPassword: boolean;
      }>;
    }
  | {
      type: "joined-room";
      roomId: string;
      displayName: string;
      role: "guest";
      hostUsername: string;
    }
  | { type: "peer-joined"; peerUsername: string }
  | { type: "signal"; payload: unknown }
  | { type: "error"; code: string; message: string }
  | { type: "peer-left" }
  | { type: "room-closed"; reason: string }
  | { type: "left-room" }
  | { type: "online-count"; count: number };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(data) || typeof data.type !== "string") return null;

  switch (data.type) {
    case "create-room":
      return {
        type: "create-room",
        hostUsername:
          typeof data.hostUsername === "string" ? data.hostUsername : undefined,
        displayName:
          typeof data.displayName === "string" ? data.displayName : undefined,
        password:
          typeof data.password === "string" ? data.password : undefined,
      };
    case "list-rooms":
      return { type: "list-rooms" };
    case "join-room":
      return typeof data.roomId === "string"
        ? {
          type: "join-room",
          roomId: data.roomId,
          guestUsername:
            typeof data.guestUsername === "string"
              ? data.guestUsername
              : undefined,
          password: typeof data.password === "string" ? data.password : undefined,
        }
        : null;
    case "signal":
      return {
        type: "signal",
        payload: data.payload,
      };
    case "leave-room":
      return {
        type: "leave-room",
      };
    default:
      return null;
  }
}
