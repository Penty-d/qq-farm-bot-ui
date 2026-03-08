<script setup lang="ts">
import { computed, ref, watch } from 'vue'

interface CropOption {
  seedId: number
  name: string
  requiredLevel?: number
  image?: string
}

const props = defineProps<{
  options?: CropOption[]
  disabled?: boolean
  loading?: boolean
}>()

const model = defineModel<number[]>({ required: true })

const expanded = ref(false)
const searchKeyword = ref('')
const imageErrors = ref<Record<number, boolean>>({})

const normalizedValue = computed(() => {
  return Array.isArray(model.value) ? model.value : []
})

const selectedSeedIds = computed(() => {
  return new Set(normalizedValue.value)
})

const filteredOptions = computed(() => {
  const list = Array.isArray(props.options) ? props.options : []
  const keyword = searchKeyword.value.trim().toLowerCase()
  if (!keyword)
    return list
  return list.filter((item) => {
    return [
      item.name,
      String(item.seedId),
      item.requiredLevel ? `${item.requiredLevel}` : '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(keyword)
  })
})

watch(() => normalizedValue.value.length, (length) => {
  if (length > 0)
    expanded.value = true
}, { immediate: true })

function toggleExpanded() {
  expanded.value = !expanded.value
}

function toggleSeed(seedId: number) {
  if (props.disabled)
    return
  const next = new Set(normalizedValue.value)
  if (next.has(seedId))
    next.delete(seedId)
  else
    next.add(seedId)
  model.value = Array.from(next).sort((a, b) => a - b)
}

function clearSelection() {
  if (props.disabled)
    return
  model.value = []
}

function selectFiltered() {
  if (props.disabled)
    return
  const next = new Set(normalizedValue.value)
  filteredOptions.value.forEach(item => next.add(item.seedId))
  model.value = Array.from(next).sort((a, b) => a - b)
}

function handleImageError(seedId: number) {
  imageErrors.value[seedId] = true
}
</script>

<template>
  <div class="rounded-lg border border-blue-100/80 bg-white/70 dark:border-blue-800/40 dark:bg-gray-900/30">
    <button
      type="button"
      class="w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-blue-50/80 dark:hover:bg-blue-900/20"
      @click="toggleExpanded"
    >
      <div class="min-w-0 flex items-center gap-3">
        <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
          <div class="i-carbon-filter-edit text-lg" />
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2 text-sm text-gray-800 font-medium dark:text-gray-100">
            <span>排除作物</span>
            <span class="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 font-semibold dark:bg-blue-900/40 dark:text-blue-200">
              {{ normalizedValue.length }} / {{ options?.length || 0 }}
            </span>
          </div>
          <p class="truncate text-xs text-gray-500 dark:text-gray-400">
            勾选后，自动偷菜会跳过这些作物；手动偷菜不受影响。
          </p>
        </div>
      </div>
      <div class="i-carbon-chevron-down shrink-0 text-lg text-gray-400 transition-transform" :class="{ 'rotate-180': expanded }" />
    </button>

    <div v-if="expanded" class="border-t border-blue-100/80 p-3 space-y-3 dark:border-blue-800/40">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          支持按作物名或 `seedId` 搜索
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-md border border-blue-200 px-2.5 py-1 text-xs text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-700 dark:text-blue-200 dark:hover:bg-blue-900/20"
            :disabled="disabled || filteredOptions.length === 0"
            @click="selectFiltered"
          >
            排除当前筛选
          </button>
          <button
            type="button"
            class="rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            :disabled="disabled || normalizedValue.length === 0"
            @click="clearSelection"
          >
            清空
          </button>
        </div>
      </div>

      <div class="relative">
        <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
          <div class="i-carbon-search" />
        </div>
        <input
          v-model="searchKeyword"
          type="text"
          class="w-full border border-gray-200 rounded-lg bg-white py-2 pl-10 pr-3 text-sm outline-none transition focus:border-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          :disabled="disabled"
          placeholder="搜索作物名或 Seed ID"
        >
      </div>

      <div v-if="loading" class="flex items-center justify-center py-8 text-sm text-gray-500 dark:text-gray-400">
        <div class="i-svg-spinners-ring-resize mr-2 text-lg" />
        正在加载全部作物...
      </div>
      <div v-else-if="filteredOptions.length === 0" class="rounded-lg border border-dashed border-gray-200 px-3 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        没有找到匹配作物
      </div>
      <div v-else class="max-h-88 overflow-y-auto pr-1">
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <button
            v-for="item in filteredOptions"
            :key="item.seedId"
            type="button"
            class="flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition"
            :class="selectedSeedIds.has(item.seedId)
              ? 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100'
              : 'border-gray-200 bg-white text-gray-800 hover:border-blue-300 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-100 dark:hover:border-blue-500/50 dark:hover:bg-blue-900/20'"
            :disabled="disabled"
            @click="toggleSeed(item.seedId)"
          >
            <div class="h-12 w-12 flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-700/70">
              <img
                v-if="item.image && !imageErrors[item.seedId]"
                :src="item.image"
                :alt="item.name"
                class="h-full w-full object-cover"
                loading="lazy"
                @error="handleImageError(item.seedId)"
              >
              <div v-else class="i-carbon-crop-growth text-2xl text-gray-400" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-semibold">
                {{ item.name }}
              </div>
              <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                <span>Seed ID: <span class="font-medium tabular-nums">{{ item.seedId }}</span></span>
                <span>Lv.{{ item.requiredLevel || 0 }}</span>
              </div>
            </div>
            <div
              class="h-5 w-5 flex shrink-0 items-center justify-center rounded-full border text-xs"
              :class="selectedSeedIds.has(item.seedId)
                ? 'border-rose-400 bg-rose-500 text-white dark:border-rose-400'
                : 'border-gray-300 text-transparent dark:border-gray-600'"
            >
              ✓
            </div>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
