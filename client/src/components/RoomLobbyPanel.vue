<script setup lang="ts">
defineProps<{
  isHost: boolean
  peerNickname: string | null
  currentRoomTitle: string
  currentRoomId: string | null
  canStartGame: boolean
}>()

const emit = defineEmits<{
  leave: []
  startGame: []
}>()
</script>

<template>
  <section class="card room-active">
    <template v-if="isHost">
      <p v-if="!peerNickname" class="wait">Waiting for a guest…</p>
      <p v-else class="peers">
        Guest: <strong>{{ peerNickname }}</strong>
      </p>
    </template>
    <template v-else>
      <p class="peers">
        Host: <strong>{{ peerNickname }}</strong>
      </p>
    </template>

    <p class="room-meta">Room: {{ currentRoomTitle || currentRoomId }}</p>

    <div class="row">
      <button type="button" class="btn ghost" @click="emit('leave')">Leave room</button>
      <button v-if="isHost" type="button" class="btn primary" :disabled="!canStartGame" @click="emit('startGame')">
        Start game
      </button>
    </div>
  </section>
</template>
