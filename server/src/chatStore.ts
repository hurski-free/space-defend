import { randomUUID } from "crypto";

export type ChatMessagePublic = {
  id: string;
  at: string;
  nickname: string;
  text: string;
};

const MAX_MESSAGES = 50;
const MAX_TEXT_LEN = 200;
const MAX_NICK_LEN = 64;

const messages: ChatMessagePublic[] = [];

export function getChatHistory(): ChatMessagePublic[] {
  return [...messages];
}

/** Returns the new message, or null if invalid / empty after trim. */
export function appendChatMessage(nickname: string, text: string): ChatMessagePublic | null {
  const t = text.trim().slice(0, MAX_TEXT_LEN);
  if (t.length === 0) return null;
  const n = nickname.trim().slice(0, MAX_NICK_LEN);
  if (n.length === 0) return null;
  const entry: ChatMessagePublic = {
    id: randomUUID(),
    at: new Date().toISOString(),
    nickname: n,
    text: t,
  };
  messages.push(entry);
  while (messages.length > MAX_MESSAGES) {
    messages.shift();
  }
  return entry;
}
