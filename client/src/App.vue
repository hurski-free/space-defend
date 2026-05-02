<script setup lang="ts">
import { ref } from 'vue'
import DrawCanvas from './components/DrawCanvas.vue'
import JoinRoomDialog from './components/JoinRoomDialog.vue'
import LeaveRoomConfirmDialog from './components/LeaveRoomConfirmDialog.vue'
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
  <div class="app-root">
    <header v-if="lobby.nicknameSet" class="nickname-badge">{{ lobby.nickname }}</header>
    <p v-if="lobby.nicknameSet && lobby.onlineCount !== null" class="online-count-badge">
      online: {{ lobby.onlineCount }}
    </p>

    <main v-if="!lobby.gameActive" class="main">
      <NicknameGate v-if="!lobby.nicknameSet" v-model="lobby.nicknameDraft" @submit="lobby.confirmNickname" />

      <LobbyScreen
        v-else-if="!lobby.inRoom"
        :connection-error="lobby.connectionError"
        :action-error="lobby.actionError"
        v-model:room-name="lobby.roomName"
        v-model:create-password="lobby.createPassword"
        :rooms="lobby.rooms"
        @create-room="lobby.createRoom"
        @open-join="lobby.openJoinDialog"
      />

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
      <p v-if="lobby.actionError" class="banner error">{{ lobby.actionError }}</p>
      <div class="row game-actions">
        <button type="button" class="btn ghost" @click="requestLeaveRoom">Leave room</button>
      </div>
      <DrawCanvas
        :is-host="lobby.isHost"
        :send-signal="lobby.sendPeerSignal"
        :peer-signal="lobby.peerSignal"
      />
      <p class="game-hint">Left-click the canvas to draw a circle. Positions are normalized to the canvas size.</p>
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
  </div>
</template>

<style scoped>
.game-actions {
  justify-content: flex-end;
}
</style>
