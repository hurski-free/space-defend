<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const CANVAS_CHANNEL = 'space-defend-canvas'

type Circle = { nx: number; ny: number; nr: number }

const props = defineProps<{
  isHost: boolean
  sendSignal: (payload: unknown) => void
  peerSignal: { seq: number; payload: unknown } | null
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const circles = ref<Circle[]>([])
const defaultNr = 0.02

function isCanvasPayload(p: unknown): p is Record<string, unknown> {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false
  const o = p as Record<string, unknown>
  return o.channel === CANVAS_CHANNEL
}

function redraw(): void {
  const el = canvasRef.value
  if (!el) return
  const ctx = el.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const w = el.clientWidth
  const h = el.clientHeight
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(94, 224, 208, 0.28)'
  ctx.strokeStyle = '#5ee0d0'
  ctx.lineWidth = 2
  const scale = Math.min(w, h)
  for (const c of circles.value) {
    const x = c.nx * w
    const y = c.ny * h
    const r = c.nr * scale
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
}

function resizeCanvas(): void {
  const el = canvasRef.value
  if (!el) return
  const dpr = window.devicePixelRatio || 1
  const w = el.clientWidth
  const h = el.clientHeight
  el.width = Math.max(1, Math.floor(w * dpr))
  el.height = Math.max(1, Math.floor(h * dpr))
  redraw()
}

let ro: ResizeObserver | null = null

onMounted(() => {
  const el = canvasRef.value
  if (!el) return
  resizeCanvas()
  ro = new ResizeObserver(() => resizeCanvas())
  ro.observe(el)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
})

function addCircle(nx: number, ny: number, nr: number = defaultNr): void {
  circles.value = [...circles.value, { nx, ny, nr }]
  redraw()
}

function onPointerDown(ev: PointerEvent): void {
  if (ev.button !== 0) return
  const el = canvasRef.value
  if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
  const nx = ev.offsetX / el.clientWidth
  const ny = ev.offsetY / el.clientHeight
  if (props.isHost) {
    addCircle(nx, ny)
    props.sendSignal({
      channel: CANVAS_CHANNEL,
      kind: 'circle',
      nx,
      ny,
      nr: defaultNr,
    })
  } else {
    props.sendSignal({
      channel: CANVAS_CHANNEL,
      kind: 'guest-click',
      nx,
      ny,
    })
  }
}

function handleHostPeerPayload(payload: unknown): void {
  if (!isCanvasPayload(payload)) return
  if (payload.kind !== 'guest-click') return
  const nx = typeof payload.nx === 'number' ? payload.nx : null
  const ny = typeof payload.ny === 'number' ? payload.ny : null
  if (nx === null || ny === null) return
  addCircle(nx, ny)
  props.sendSignal({
    channel: CANVAS_CHANNEL,
    kind: 'circle',
    nx,
    ny,
    nr: defaultNr,
  })
}

function handleGuestPeerPayload(payload: unknown): void {
  if (!isCanvasPayload(payload)) return
  if (payload.kind !== 'circle') return
  const nx = typeof payload.nx === 'number' ? payload.nx : null
  const ny = typeof payload.ny === 'number' ? payload.ny : null
  const nr = typeof payload.nr === 'number' ? payload.nr : defaultNr
  if (nx === null || ny === null) return
  addCircle(nx, ny, nr)
}

watch(
  () => props.peerSignal?.seq,
  () => {
    const snap = props.peerSignal
    if (!snap) return
    if (props.isHost) handleHostPeerPayload(snap.payload)
    else handleGuestPeerPayload(snap.payload)
  },
)
</script>

<template>
  <section class="card draw-wrap">
    <h2 class="section-title">Drawing</h2>
    <p class="draw-hint">
      {{
        isHost
          ? 'Host: your clicks are shown to the guest. Guest clicks are applied here and echoed back to them.'
          : 'Guest: clicks are sent to the host; circles appear after the host applies them.'
      }}
    </p>
    <canvas
      ref="canvasRef"
      class="draw-canvas"
      @pointerdown.prevent="onPointerDown"
    />
  </section>
</template>

<style scoped>
.draw-hint {
  margin: -0.5rem 0 1rem;
  font-size: 0.88rem;
  color: var(--muted);
  line-height: 1.4;
}

.draw-canvas {
  display: block;
  width: 100%;
  height: min(55vh, 420px);
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--input-bg);
  touch-action: none;
  cursor: crosshair;
}

.draw-wrap {
  margin-top: 0;
}
</style>
