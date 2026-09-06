<script setup lang="ts">
import type { Rect, Recognition } from '../lib/types'
const props = defineProps<{
  src: string
  width: number
  height: number
  modelValue: Rect
  detections: Recognition[]
}>()
const emit = defineEmits<{
  'update:modelValue': [rect: Rect]
  select: [recognition: Recognition]
}>()
const svg = ref<SVGSVGElement>()
const drawing = ref(false)
defineExpose({
  draw: () => {
    drawing.value = true
  },
})
const drag = ref<{ mode: string; start: { x: number; y: number }; rect: Rect }>()
const handle = computed(() => Math.max(props.width, props.height) * 0.015)
function point(e: PointerEvent) {
  const p = svg.value!.createSVGPoint()
  p.x = e.clientX
  p.y = e.clientY
  const q = p.matrixTransform(svg.value!.getScreenCTM()!.inverse())
  return { x: Math.max(0, Math.min(props.width, q.x)), y: Math.max(0, Math.min(props.height, q.y)) }
}
function start(e: PointerEvent, mode: string) {
  if (e.button !== 0) return
  e.preventDefault()
  svg.value!.setPointerCapture(e.pointerId)
  drag.value = { mode, start: point(e), rect: { ...props.modelValue } }
}
function move(e: PointerEvent) {
  if (!drag.value) return
  const p = point(e),
    d = drag.value,
    dx = p.x - d.start.x,
    dy = p.y - d.start.y,
    r = d.rect
  let x = r.x,
    y = r.y,
    w = r.width,
    h = r.height
  if (d.mode === 'draw') {
    x = Math.min(d.start.x, p.x)
    y = Math.min(d.start.y, p.y)
    w = Math.abs(dx)
    h = Math.abs(dy)
  } else if (d.mode === 'move') {
    x = Math.max(0, Math.min(props.width - w, x + dx))
    y = Math.max(0, Math.min(props.height - h, y + dy))
  } else {
    if (d.mode.includes('w')) {
      x = r.x + dx
      w = r.width - dx
    }
    if (d.mode.includes('e')) w = r.width + dx
    if (d.mode.includes('n')) {
      y = r.y + dy
      h = r.height - dy
    }
    if (d.mode.includes('s')) h = r.height + dy
    if (w < 0) {
      x += w
      w = -w
    }
    if (h < 0) {
      y += h
      h = -h
    }
  }
  x = Math.max(0, x)
  y = Math.max(0, y)
  w = Math.min(props.width - x, Math.max(3, w))
  h = Math.min(props.height - y, Math.max(3, h))
  emit('update:modelValue', { x, y, width: w, height: h })
}
function endDrag() {
  drag.value = undefined
  drawing.value = false
}

function key(e: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
  e.preventDefault()
  const step = e.shiftKey ? 10 : 1,
    r = { ...props.modelValue },
    dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0,
    dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0
  if (e.altKey) {
    r.width = Math.max(3, Math.min(props.width - r.x, r.width + dx))
    r.height = Math.max(3, Math.min(props.height - r.y, r.height + dy))
  } else {
    r.x = Math.max(0, Math.min(props.width - r.width, r.x + dx))
    r.y = Math.max(0, Math.min(props.height - r.height, r.y + dy))
  }
  emit('update:modelValue', r)
}
const corners = computed(() => {
  const r = props.modelValue
  return [
    { id: 'nw', x: r.x, y: r.y },
    { id: 'ne', x: r.x + r.width, y: r.y },
    { id: 'sw', x: r.x, y: r.y + r.height },
    { id: 'se', x: r.x + r.width, y: r.y + r.height },
  ]
})
</script>
<template>
  <div class="crop-editor">
    <svg
      ref="svg"
      :viewBox="`0 0 ${width} ${height}`"
      class="crop-svg"
      :class="{ drawing }"
      aria-label="Edytor zaznaczenia tekstu. Przeciągnij, aby narysować ramkę."
      @pointerdown="start($event, 'draw')"
      @pointermove="move"
      @pointerup="endDrag"
      @pointercancel="endDrag"
    >
      <defs>
        <mask id="crop-mask">
          <rect :width="width" :height="height" fill="white" />
          <rect v-bind="modelValue" fill="black" />
        </mask>
      </defs>
      <image :href="src" :width="width" :height="height" />
      <rect :width="width" :height="height" fill="#121a17" opacity=".48" mask="url(#crop-mask)" />
      <rect
        v-for="(d, i) in detections"
        :key="i"
        v-bind="d.box"
        fill="transparent"
        stroke="#d3f86b"
        stroke-dasharray="5 4"
        vector-effect="non-scaling-stroke"
        class="detected-box"
        @pointerdown.stop="emit('select', d)"
      />
      <rect
        v-bind="modelValue"
        fill="transparent"
        stroke="#d3f86b"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
        class="selected-box"
        tabindex="0"
        role="button"
        aria-label="Zaznaczony tekst. Strzałki przesuwają ramkę, Alt i strzałki zmieniają rozmiar, Shift przyspiesza."
        @pointerdown.stop="start($event, drawing || $event.shiftKey ? 'draw' : 'move')"
        @keydown="key"
      />
      <rect
        v-for="c in corners"
        :key="c.id"
        :x="c.x - handle / 2"
        :y="c.y - handle / 2"
        :width="handle"
        :height="handle"
        fill="white"
        stroke="#426014"
        vector-effect="non-scaling-stroke"
        :class="`crop-handle ${c.id}`"
        @pointerdown.stop="start($event, c.id)"
      />
    </svg>
    <div class="canvas-caption">
      <span
        ><span class="status-dot" />
        {{ drawing ? 'Przeciągnij, aby narysować nową ramkę' : 'Zaznacz jedną linię tekstu' }}</span
      ><span>{{ Math.round(modelValue.width) }} × {{ Math.round(modelValue.height) }} px</span>
    </div>
  </div>
</template>
