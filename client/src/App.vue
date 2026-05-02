<script setup lang="ts">
import { ref } from 'vue'
import DrawCanvas from './components/DrawCanvas.vue'
import JoinRoomDialog from './components/JoinRoomDialog.vue'
import LeaveRoomConfirmDialog from './components/LeaveRoomConfirmDialog.vue'
import LobbyChat from './components/LobbyChat.vue'
import LobbyScreen from './components/LobbyScreen.vue'
import NicknameGate from './components/NicknameGate.vue'
import RoomLobbyPanel from './components/RoomLobbyPanel.vue'
import { useLobbyWs } from './composables/useLobbyWs'

const lobby = useLobbyWs()
const leaveConfirmOpen = ref(false)

function requestLeaveRoom(): void {
  leaveConfirmOpen.value = true
}

function cancelLeaveRoom(): void {
  leaveConfirmOpen.value = false
}

function confirmLeaveRoom(): void {
  leaveConfirmOpen.value = false
  lobby.leaveRoom()
}
</script>

<template>
  <div class="app-root" :class="{ 'app-root--game': lobby.gameActive }">
    <header v-if="lobby.nicknameSet" class="nickname-badge">{{ lobby.nickname }}</header>
    <p v-if="lobby.nicknameSet && lobby.onlineCount !== null" class="online-count-badge">
      online: {{ lobby.onlineCount }}
    </p>

    <main
      v-if="!lobby.gameActive"
      :class="['main', lobby.nicknameSet && !lobby.inRoom ? 'main-lobby-wide' : '']"
    >
      <NicknameGate v-if="!lobby.nicknameSet" v-model="lobby.nicknameDraft" @submit="lobby.confirmNickname" />

      <div v-else-if="!lobby.inRoom" class="lobby-split">
        <div class="lobby-split-main">
          <LobbyScreen
            :connection-error="lobby.connectionError"
            :action-error="lobby.actionError"
            v-model:room-name="lobby.roomName"
            v-model:create-password="lobby.createPassword"
            :rooms="lobby.rooms"
            @create-room="lobby.createRoom"
            @open-join="lobby.openJoinDialog"
            @start-solo="lobby.startSoloGame"
          />
        </div>
        <aside class="card lobby-split-chat">
          <LobbyChat
            :messages="lobby.chatMessages"
            :current-nickname="lobby.nickname"
            :cooldown-seconds="lobby.chatCooldownSeconds"
            @send="lobby.sendChatMessage"
          />
        </aside>
      </div>

      <RoomLobbyPanel
        v-else
        :is-host="lobby.isHost"
        :peer-nickname="lobby.peerNickname"
        :current-room-title="lobby.currentRoomTitle"
        :current-room-id="lobby.currentRoomId"
        :can-start-game="lobby.canStartGame"
        @leave="requestLeaveRoom"
        @start-game="lobby.startGame"
      />
    </main>

    <div v-else class="game-layout">
      <div class="game-toolbar row">
        <p v-if="lobby.actionError" class="banner error game-toolbar-msg">{{ lobby.actionError }}</p>
        <button
          v-if="lobby.soloMode"
          type="button"
          class="btn ghost"
          @click="lobby.leaveSoloGame"
        >
          Back to lobby
        </button>
        <button v-else type="button" class="btn ghost" @click="requestLeaveRoom">Leave room</button>
      </div>
      <DrawCanvas
        :game-session-id="lobby.gameSessionId"
        :is-host="lobby.isHost"
        :solo="lobby.soloMode"
        :send-signal="lobby.sendPeerSignal"
        :peer-signal="lobby.peerSignal"
      />
    </div>

    <JoinRoomDialog
      v-if="lobby.joinTarget"
      :target="lobby.joinTarget"
      v-model:password="lobby.joinPassword"
      @cancel="lobby.closeJoinDialog"
      @confirm="lobby.confirmJoin"
    />

    <LeaveRoomConfirmDialog
      v-if="leaveConfirmOpen"
      @cancel="cancelLeaveRoom"
      @confirm="confirmLeaveRoom"
    />

    <footer class="dev-contact-badge">
      <span class="dev-contact-label">Developer contact</span>
      <a class="dev-contact-mail" href="mailto:hurski.free@gmail.com">hurski.free@gmail.com</a>
    </footer>
  </div>
</template>

<style scoped>
.game-toolbar {
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.game-toolbar-msg {
  margin: 0;
  flex: 1 1 auto;
  min-width: 0;
}
</style>
