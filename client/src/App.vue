<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ClientMessage, ServerMessage } from './protocol'
import { parseServerMessage, wsUrl } from './protocol'

const nickname = ref('')
const nicknameDraft = ref('')
const nicknameSet = ref(false)

const roomName = ref('')
const createPassword = ref('')

const rooms = ref<Array<{ roomId: string; displayName: string; hasPassword: boolean }>>([])
const connectionError = ref<string | null>(null)
const actionError = ref<string | null>(null)

/** host: waiting in created room; guest: joined */
const inRoom = ref(false)
const isHost = ref(false)
const currentRoomId = ref<string | null>(null)
const currentRoomTitle = ref('')
const peerNickname = ref<string | null>(null)

const joinTarget = ref<{ roomId: string; displayName: string; hasPassword: boolean } | null>(
  null,
)
const joinPassword = ref('')

let ws: WebSocket | null = null
let listTimer: ReturnType<typeof setInterval> | null = null

function stopListPolling(): void {
  if (listTimer) {
    clearInterval(listTimer)
    listTimer = null
  }
}

function startListPolling(): void {
  stopListPolling()
  listTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN && nicknameSet.value && !inRoom.value) {
      send({ type: 'list-rooms' })
    }
  }, 2500)
}

function send(msg: ClientMessage): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function connectSocket(): void {
  connectionError.value = null
  if (ws) {
    ws.close()
    ws = null
  }
  try {
    console.log(wsUrl())
    const socket = new WebSocket(wsUrl())
    ws = socket
    socket.onopen = () => {
      send({ type: 'list-rooms' })
      startListPolling()
    }
    socket.onmessage = (ev) => {
      const msg = parseServerMessage(String(ev.data))
      if (!msg) return
      handleServer(msg)
    }
    socket.onerror = () => {
      connectionError.value = 'Ошибка соединения'
    }
    socket.onclose = (ev) => {
      stopListPolling()
      if (!ev.wasClean && nicknameSet.value) {
        connectionError.value = 'Соединение прервано'
      }
    }
  } catch {
    connectionError.value = 'Не удалось подключиться'
  }
}

function handleServer(msg: ServerMessage): void {
  actionError.value = null
  switch (msg.type) {
    case 'room-list':
      rooms.value = msg.rooms
      break
    case 'room-created':
      inRoom.value = true
      isHost.value = true
      currentRoomId.value = msg.roomId
      currentRoomTitle.value = msg.displayName
      peerNickname.value = null
      stopListPolling()
      break
    case 'joined-room':
      inRoom.value = true
      isHost.value = false
      currentRoomId.value = msg.roomId
      currentRoomTitle.value = msg.displayName
      peerNickname.value = msg.hostUsername
      stopListPolling()
      break
    case 'peer-joined':
      peerNickname.value = msg.peerUsername
      break
    case 'peer-left':
      peerNickname.value = null
      break
    case 'left-room':
      resetLobbyAfterLeave()
      break
    case 'room-closed':
      resetLobbyAfterLeave()
      actionError.value = 'Комната закрыта (хост вышел)'
      break
    case 'error':
      actionError.value = msg.message
      break
    default:
      break
  }
}

function resetLobbyAfterLeave(): void {
  inRoom.value = false
  isHost.value = false
  currentRoomId.value = null
  currentRoomTitle.value = ''
  peerNickname.value = null
  send({ type: 'list-rooms' })
  startListPolling()
}

function confirmNickname(): void {
  const n = nicknameDraft.value.trim()
  if (!n) return
  nickname.value = n
  nicknameSet.value = true
  connectSocket()
}

function createRoom(): void {
  const name = roomName.value.trim()
  if (!name) {
    actionError.value = 'Введите название комнаты'
    return
  }
  const pwd = createPassword.value.trim()
  send({
    type: 'create-room',
    hostUsername: nickname.value,
    displayName: name,
    ...(pwd ? { password: pwd } : {}),
  })
}

function openJoinDialog(room: { roomId: string; displayName: string; hasPassword: boolean }): void {
  joinTarget.value = room
  joinPassword.value = ''
}

function confirmJoin(): void {
  const target = joinTarget.value
  if (!target) return
  send({
    type: 'join-room',
    roomId: target.roomId,
    guestUsername: nickname.value,
    ...(joinPassword.value.trim() ? { password: joinPassword.value.trim() } : {}),
  })
  joinTarget.value = null
}

function leaveRoom(): void {
  send({ type: 'leave-room' })
}

const canStartGame = computed(() => isHost.value && peerNickname.value !== null)

watch(nicknameSet, (set) => {
  if (!set && ws) {
    ws.close()
    ws = null
    stopListPolling()
  }
})

onBeforeUnmount(() => {
  stopListPolling()
  ws?.close()
})
</script>

<template>
  <div class="app">
    <header v-if="nicknameSet" class="nickname-badge">{{ nickname }}</header>

    <main class="main">
      <section v-if="!nicknameSet" class="card modal-card">
        <h1 class="title">Space Defend</h1>
        <p class="hint">Введите никнейм для входа в лобби</p>
        <label class="field">
          <span class="label">Никнейм</span>
          <input
            v-model="nicknameDraft"
            class="input"
            type="text"
            maxlength="64"
            autocomplete="off"
            @keydown.enter.prevent="confirmNickname"
          />
        </label>
        <button type="button" class="btn primary" :disabled="!nicknameDraft.trim()" @click="confirmNickname">
          Продолжить
        </button>
      </section>

      <template v-else-if="!inRoom">
        <p v-if="connectionError" class="banner error">{{ connectionError }}</p>
        <p v-else-if="actionError" class="banner error">{{ actionError }}</p>

        <section class="card">
          <h2 class="section-title">Создать комнату</h2>
          <label class="field">
            <span class="label">Название</span>
            <input v-model="roomName" class="input" type="text" maxlength="64" autocomplete="off" />
          </label>
          <label class="field">
            <span class="label">Пароль (необязательно)</span>
            <input
              v-model="createPassword"
              class="input"
              type="password"
              maxlength="128"
              autocomplete="new-password"
            />
          </label>
          <button type="button" class="btn primary" @click="createRoom">Create room</button>
        </section>

        <section class="card">
          <h2 class="section-title">Доступные комнаты</h2>
          <ul v-if="rooms.length" class="room-list">
            <li v-for="r in rooms" :key="r.roomId" class="room-row">
              <span class="room-name">{{ r.displayName }}</span>
              <span v-if="r.hasPassword" class="lock" title="Есть пароль">🔒</span>
              <button type="button" class="btn small" @click="openJoinDialog(r)">Присоединиться</button>
            </li>
          </ul>
          <p v-else class="empty">Нет свободных комнат</p>
        </section>
      </template>

      <section v-else class="card room-active">
        <template v-if="isHost">
          <p v-if="!peerNickname" class="wait">wait guest...</p>
          <p v-else class="peers">
            Гость: <strong>{{ peerNickname }}</strong>
          </p>
        </template>
        <template v-else>
          <p class="peers">
            Хост: <strong>{{ peerNickname }}</strong>
          </p>
        </template>

        <p class="room-meta">Комната: {{ currentRoomTitle || currentRoomId }}</p>

        <div class="row">
          <button type="button" class="btn ghost" @click="leaveRoom">Leave room</button>
          <button v-if="isHost" type="button" class="btn primary" :disabled="!canStartGame">Start game</button>
        </div>
      </section>
    </main>

    <div v-if="joinTarget" class="overlay" @click.self="joinTarget = null">
      <div class="card dialog">
        <h2 class="section-title">Вход: {{ joinTarget.displayName }}</h2>
        <label class="field">
          <span class="label">Пароль</span>
          <input
            v-model="joinPassword"
            class="input"
            type="password"
            maxlength="128"
            autocomplete="off"
            placeholder=""
            @keydown.enter.prevent="confirmJoin"
          />
        </label>
        <div class="row">
          <button type="button" class="btn ghost" @click="joinTarget = null">Отмена</button>
          <button type="button" class="btn primary" @click="confirmJoin">Connect</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  padding: 1.5rem;
  box-sizing: border-box;
}

.nickname-badge {
  position: fixed;
  top: 0.75rem;
  left: 0.75rem;
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text);
  opacity: 0.45;
  z-index: 10;
  pointer-events: none;
}

.main {
  max-width: 520px;
  margin: 2.5rem auto 0;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.25rem 1.35rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
}

.modal-card {
  margin-top: 10vh;
}

.title {
  margin: 0 0 0.35rem;
  font-size: 1.65rem;
  font-weight: 700;
}

.section-title {
  margin: 0 0 1rem;
  font-size: 1.1rem;
  font-weight: 600;
}

.hint {
  margin: 0 0 1rem;
  color: var(--muted);
  font-size: 0.9rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.9rem;
}

.label {
  font-size: 0.8rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.input {
  background: var(--input-bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 8px;
  padding: 0.55rem 0.75rem;
  font-size: 1rem;
  outline: none;
}

.input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
}

.btn {
  border: none;
  border-radius: 8px;
  padding: 0.55rem 1rem;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn.primary {
  background: linear-gradient(135deg, var(--accent), var(--accent-dim));
  color: #0a0e14;
}

.btn.primary:not(:disabled):hover {
  filter: brightness(1.08);
}

.btn.ghost {
  background: transparent;
  color: var(--text);
  border: 1px solid var(--border);
}

.btn.ghost:hover {
  background: rgba(255, 255, 255, 0.06);
}

.btn.small {
  padding: 0.4rem 0.75rem;
  font-size: 0.85rem;
}

.room-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.room-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.65rem;
  background: var(--input-bg);
  border-radius: 8px;
  border: 1px solid var(--border);
}

.room-name {
  flex: 1;
  font-weight: 500;
}

.lock {
  font-size: 0.85rem;
  opacity: 0.8;
}

.empty {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
}

.banner {
  margin: 0;
  padding: 0.65rem 0.85rem;
  border-radius: 8px;
  font-size: 0.9rem;
}

.banner.error {
  background: rgba(220, 80, 80, 0.15);
  border: 1px solid rgba(220, 80, 80, 0.4);
  color: #f0a0a0;
}

.wait {
  margin: 0 0 1rem;
  font-size: 1.05rem;
  color: var(--accent);
  letter-spacing: 0.04em;
}

.peers {
  margin: 0 0 0.75rem;
  font-size: 1rem;
}

.room-meta {
  margin: 0 0 1rem;
  font-size: 0.85rem;
  color: var(--muted);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
}

.room-active .row {
  margin-top: 0.25rem;
}

.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: 20;
}

.dialog {
  width: min(400px, 100%);
}
</style>
