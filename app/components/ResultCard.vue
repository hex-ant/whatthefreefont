<script setup lang="ts">
import type { MatchResult } from '../lib/types'
import { fontSources } from '../lib/font-sources'
const props = defineProps<{ result: MatchResult; index: number; text: string }>()
const ready = ref(false),
  failed = ref(false),
  copied = ref(false)
watch(
  [() => props.result.font.id, () => props.text],
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
    <div
      class="font-specimen"
      :class="{ loading: !ready }"
      :style="
        ready
          ? {
              fontFamily: `preview${result.font.id}`,
              fontWeight: result.font.weight,
              fontStyle: result.font.style,
            }
          : {}
      "
    >
      {{ ready ? text : failed ? 'Preview unavailable' : 'Loading font…' }}
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
