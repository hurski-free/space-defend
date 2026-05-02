<script setup lang="ts">
defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
}>()
</script>

<template>
  <section class="card modal-card">
    <h1 class="title">Space Defend</h1>
    <p class="hint">Choose a nickname to enter the lobby</p>
    <label class="field">
      <span class="label">Nickname</span>
      <input
        :value="modelValue"
        class="input"
        type="text"
        maxlength="64"
        autocomplete="off"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @keydown.enter.prevent="emit('submit')"
      />
    </label>
    <button type="button" class="btn primary" :disabled="!modelValue.trim()" @click="emit('submit')">
      Continue
    </button>
  </section>
</template>
