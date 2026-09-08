<script setup lang="ts">
import type { MatchResult } from '../lib/types'
import { fontSources } from '../lib/font-sources'
const props = defineProps<{
  result: MatchResult
  index: number
  text: string
  originalText: string
}>()
const emit = defineEmits<{ 'update:text': [text: string] }>()
const preview = computed({
  get: () => props.text,
  set: (text: string) => emit('update:text', text),
})
const input = ref<HTMLTextAreaElement>()
const fontKey = computed(() =>
  JSON.stringify([props.result.font.id, fontSources(props.result.font, props.text)]),
)
const ready = ref(false),
  failed = ref(false),
  copied = ref(false)
watch(
  fontKey,
  async (_value, _oldValue, onCleanup) => {
    let active = true
    const faces: FontFace[] = []
    onCleanup(() => {
      active = false
      for (const face of faces) document.fonts.delete(face)
    })
    ready.value = false
    failed.value = false
    try {
      const v = props.result.font,
        name = `preview${v.id}`
      for (const url of fontSources(v, props.text)) {
        const font = new FontFace(name, `url("${url}")`, {
          weight: String(v.weight),
          style: v.style,
        })
        await font.load()
        if (!active) return
        document.fonts.add(font)
        faces.push(font)
      }
      if (active) ready.value = true
    } catch {
      if (active) failed.value = true
    }
  },
  { immediate: true },
)
function resizeInput() {
  if (!input.value) return
  input.value.style.height = '0px'
  input.value.style.height = `${input.value.scrollHeight}px`
}
watch([() => props.text, ready], async () => {
  await nextTick()
  resizeInput()
})
let observer: ResizeObserver | undefined
onMounted(() => {
  resizeInput()
  let previousWidth = 0
  observer = new ResizeObserver(([entry]) => {
    if (entry && entry.contentRect.width !== previousWidth) {
      previousWidth = entry.contentRect.width
      resizeInput()
    }
  })
  if (input.value) observer.observe(input.value)
})
onBeforeUnmount(() => observer?.disconnect())
async function resetPreview() {
  emit('update:text', props.originalText)
  await nextTick()
  input.value?.focus({ preventScroll: true })
}
async function copy() {
  try {
    await navigator.clipboard.writeText(props.result.font.family)
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  } catch {
    copied.value = false
  }
}
</script>
<template>
  <article class="result-card" :class="{ best: index === 0 }">
    <div class="result-heading">
      <span class="rank">{{ String(index + 1).padStart(2, '0') }}</span>
      <div>
        <h3>{{ result.font.family }}</h3>
        <span class="font-meta"
          >{{ result.font.weight }} ·
          {{ result.font.style === 'italic' ? 'Italic' : 'Regular' }}</span
        >
      </div>
      <span class="probability" title="Relative likelihood among these suggestions"
        >{{ (result.probability * 100).toFixed(1) }}<small>%</small></span
      >
    </div>
    <div class="font-specimen editable-specimen">
      <textarea
        ref="input"
        class="specimen-input"
        :class="{ 'font-pending': !ready }"
        v-model="preview"
        :aria-label="`Preview text for ${result.font.family}; edits update all previews`"
        :aria-busy="!ready && !failed"
        rows="1"
        maxlength="500"
        spellcheck="false"
        :style="
          ready
            ? {
                fontFamily: `preview${result.font.id}`,
                fontWeight: result.font.weight,
                fontStyle: result.font.style,
              }
            : {}
        "
      />
      <span v-if="!ready" class="specimen-status" role="status">
        {{ failed ? 'Preview unavailable' : 'Loading font…' }}
      </span>
      <button
        v-if="text !== originalText"
        class="preview-reset"
        aria-label="Reset preview text in all cards"
        title="Reset preview text in all cards"
        @click="resetPreview"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M3 10a9 9 0 1 1 2.5 8.5M3 4v6h6" />
        </svg>
      </button>
    </div>
    <details v-if="result.alternatives?.length" class="similar-fonts">
      <summary>Very similar fonts ({{ result.alternatives.length }})</summary>
      <a
        v-for="name in result.alternatives"
        :key="name"
        :href="`https://fonts.google.com/specimen/${encodeURIComponent(name).replaceAll('%20', '+')}`"
        target="_blank"
        rel="noopener noreferrer"
        >{{ name }} ↗</a
      >
    </details>
    <div class="result-actions">
      <button class="text-button" @click="copy">
        {{ copied ? 'Copied ✓' : 'Copy name' }}</button
      ><a
        :href="`https://fonts.google.com/specimen/${encodeURIComponent(result.font.family).replaceAll('%20', '+')}`"
        target="_blank"
        rel="noopener noreferrer"
        >Google Fonts ↗</a
      >
    </div>
  </article>
</template>
