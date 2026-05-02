import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { ClientMessage, ServerMessage } from '../protocol'
import { parseServerMessage, wsUrl } from '../protocol'

export type RoomListItem = { roomId: string; displayName: string; hasPassword: boolean }

export type ChatMessageItem = { id: string; at: string; nickname: string; text: string }

const MAX_CHAT_CLIENT = 200
const CHAT_COOLDOWN_MS = 10_000

const CANVAS_CHANNEL = 'space-defend-canvas'
const NICKNAME_STORAGE_KEY = 'space-defend-nickname'

function readStoredNicknameDraft(): string {
  try {
    const raw = localStorage.getItem(NICKNAME_STORAGE_KEY)
    if (raw == null) return ''
    const trimmed = raw.trim().slice(0, 64)
    return trimmed
  } catch {
    return ''
  }
}

function persistNickname(n: string): void {
  try {
    localStorage.setItem(NICKNAME_STORAGE_KEY, n)
  } catch {
    // ignore quota / private mode
  }
}

function isGameStartPayload(p: unknown): boolean {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false
  const o = p as Record<string, unknown>
  return o.channel === CANVAS_CHANNEL && o.kind === 'game-start'
}

export function useLobbyWs() {
  const nickname = ref('')
  const nicknameDraft = ref(readStoredNicknameDraft())
  const nicknameSet = ref(false)

  const roomName = ref('')
  const createPassword = ref('')

  const rooms = ref<RoomListItem[]>([])
  const connectionError = ref<string | null>(null)
  const actionError = ref<string | null>(null)
  const onlineCount = ref<number | null>(null)
  const chatMessages = ref<ChatMessageItem[]>([])
  const chatCooldownUntil = ref(0)
  const chatCooldownSeconds = ref(0)
  let chatCooldownTick: ReturnType<typeof setInterval> | null = null

  const inRoom = ref(false)
  const isHost = ref(false)
  const currentRoomId = ref<string | null>(null)
  const currentRoomTitle = ref('')
  const peerNickname = ref<string | null>(null)
  const gameActive = ref(false)
  const soloMode = ref(false)
  /** Incremented when a new play session starts (solo / host start / guest receives game-start). */
  const gameSessionId = ref(0)

  const peerSignal = ref<{ seq: number; payload: unknown } | null>(null)
  let signalSeq = 0

  const joinTarget = ref<RoomListItem | null>(null)
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
      if (
        ws?.readyState === WebSocket.OPEN &&
        nicknameSet.value &&
        !inRoom.value &&
        !gameActive.value
      ) {
        send({ type: 'list-rooms' })
      }
    }, 2500)
  }

  function send(msg: ClientMessage): void {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }

  function sendPeerSignal(payload: unknown): void {
    send({ type: 'signal', payload })
  }

  function refreshChatCooldownSeconds(): void {
    chatCooldownSeconds.value = Math.max(0, Math.ceil((chatCooldownUntil.value - Date.now()) / 1000))
  }

  function startChatCooldownTimer(): void {
    stopChatCooldownTimer()
    refreshChatCooldownSeconds()
    if (chatCooldownSeconds.value <= 0) return
    chatCooldownTick = setInterval(() => {
      refreshChatCooldownSeconds()
      if (chatCooldownSeconds.value <= 0) stopChatCooldownTimer()
    }, 1000)
  }

  function stopChatCooldownTimer(): void {
    if (chatCooldownTick) {
      clearInterval(chatCooldownTick)
      chatCooldownTick = null
    }
  }

  function connectSocket(): void {
    connectionError.value = null
    if (ws) {
      ws.close()
      ws = null
    }
    try {
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
        connectionError.value = 'Connection error'
      }
      socket.onclose = (ev) => {
        stopListPolling()
        onlineCount.value = null
        if (!ev.wasClean && nicknameSet.value) {
          connectionError.value = 'Connection interrupted'
        }
      }
    } catch {
      connectionError.value = 'Could not connect'
    }
  }

  function handleServer(msg: ServerMessage): void {
    if (msg.type !== 'chat-message' && msg.type !== 'chat-history') {
      actionError.value = null
    }
    switch (msg.type) {
      case 'online-count':
        onlineCount.value = typeof msg.count === 'number' && Number.isFinite(msg.count) ? Math.max(0, msg.count) : 0
        break
      case 'room-list':
        rooms.value = msg.rooms
        break
      case 'room-created':
        inRoom.value = true
        isHost.value = true
        currentRoomId.value = msg.roomId
        currentRoomTitle.value = msg.displayName
        peerNickname.value = null
        gameActive.value = false
        stopListPolling()
        break
      case 'joined-room':
        inRoom.value = true
        isHost.value = false
        currentRoomId.value = msg.roomId
        currentRoomTitle.value = msg.displayName
        peerNickname.value = msg.hostUsername
        gameActive.value = false
        stopListPolling()
        break
      case 'peer-joined':
        peerNickname.value = msg.peerUsername
        break
      case 'peer-left':
        peerNickname.value = null
        gameActive.value = false
        break
      case 'signal': {
        if (isGameStartPayload(msg.payload) && !isHost.value) {
          gameSessionId.value += 1
          gameActive.value = true
        }
        signalSeq += 1
        peerSignal.value = { seq: signalSeq, payload: msg.payload }
        break
      }
      case 'left-room':
        resetLobbyAfterLeave()
        break
      case 'room-closed':
        resetLobbyAfterLeave()
        actionError.value = 'Room closed (host left)'
        break
      case 'chat-history': {
        if (!Array.isArray(msg.messages)) break
        const seen = new Set(chatMessages.value.map((m) => m.id))
        for (const row of msg.messages) {
          if (!row || typeof row !== 'object') continue
          const r = row as Record<string, unknown>
          if (
            typeof r.id !== 'string' ||
            typeof r.at !== 'string' ||
            typeof r.nickname !== 'string' ||
            typeof r.text !== 'string'
          ) {
            continue
          }
          if (seen.has(r.id)) continue
          seen.add(r.id)
          chatMessages.value.push({ id: r.id, at: r.at, nickname: r.nickname, text: r.text })
        }
        break
      }
      case 'chat-message':
        if (!chatMessages.value.some((m) => m.id === msg.id)) {
          chatMessages.value.push({
            id: msg.id,
            at: msg.at,
            nickname: msg.nickname,
            text: msg.text,
          })
        }
        break
      case 'error':
        actionError.value = msg.message
        if (msg.code === 'chat-cooldown') {
          const m = /^Wait (\d+)s\b/.exec(msg.message)
          const sec = m
            ? Math.min(CHAT_COOLDOWN_MS / 1000, Math.max(1, Number(m[1]) || 10))
            : 10
          chatCooldownUntil.value = Date.now() + sec * 1000
          startChatCooldownTimer()
        }
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
    gameActive.value = false
    peerSignal.value = null
    send({ type: 'list-rooms' })
    startListPolling()
  }

  function confirmNickname(): void {
    const n = nicknameDraft.value.trim()
    if (!n) return
    nickname.value = n
    nicknameSet.value = true
    persistNickname(n)
    connectSocket()
  }

  function createRoom(): void {
    const name = roomName.value.trim()
    if (!name) {
      actionError.value = 'Enter a room name'
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

  function openJoinDialog(room: RoomListItem): void {
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

  function closeJoinDialog(): void {
    joinTarget.value = null
  }

  function leaveRoom(): void {
    send({ type: 'leave-room' })
  }

  function startSoloGame(): void {
    actionError.value = null
    gameSessionId.value += 1
    soloMode.value = true
    gameActive.value = true
    isHost.value = true
    peerSignal.value = null
  }

  function leaveSoloGame(): void {
    soloMode.value = false
    gameActive.value = false
  }

  function sendChatMessage(text: string): void {
    if (Date.now() < chatCooldownUntil.value) return
    const t = text.trim().slice(0, MAX_CHAT_CLIENT)
    if (!t) return
    chatCooldownUntil.value = Date.now() + CHAT_COOLDOWN_MS
    startChatCooldownTimer()
    send({ type: 'chat-send', nickname: nickname.value, text: t })
  }

  function startGame(): void {
    if (!isHost.value || peerNickname.value === null) return
    gameSessionId.value += 1
    gameActive.value = true
    sendPeerSignal({ channel: CANVAS_CHANNEL, kind: 'game-start' })
  }

  const canStartGame = computed(() => isHost.value && peerNickname.value !== null)

  watch(nicknameSet, (set) => {
    if (!set && ws) {
      soloMode.value = false
      gameActive.value = false
      chatMessages.value = []
      chatCooldownUntil.value = 0
      chatCooldownSeconds.value = 0
      stopChatCooldownTimer()
      onlineCount.value = null
      ws.close()
      ws = null
      stopListPolling()
    }
  })

  onBeforeUnmount(() => {
    stopListPolling()
    stopChatCooldownTimer()
    ws?.close()
  })

  return reactive({
    nickname,
    nicknameDraft,
    nicknameSet,
    roomName,
    createPassword,
    rooms,
    connectionError,
    actionError,
    onlineCount,
    chatMessages,
    chatCooldownSeconds,
    inRoom,
    isHost,
    currentRoomId,
    currentRoomTitle,
    peerNickname,
    gameActive,
    soloMode,
    gameSessionId,
    peerSignal,
    joinTarget,
    joinPassword,
    canStartGame,
    confirmNickname,
    createRoom,
    openJoinDialog,
    closeJoinDialog,
    confirmJoin,
    leaveRoom,
    startGame,
    startSoloGame,
    leaveSoloGame,
    sendChatMessage,
    sendPeerSignal,
  })
}
