<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  land: any
}>()

const land = computed(() => props.land)

function getLandStatusClass(land: any) {
  const status = land.status
  const level = Number(land.level) || 0

  if (status === 'locked')
    return 'bg-gray-100 dark:bg-gray-800 opacity-60 border-dashed'

  let baseClass = 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'

  // 土地等级样式
  switch (level) {
    case 1: // 黄土地
      baseClass = 'bg-yellow-50/80 dark:bg-yellow-900/10 border-yellow-200 dark:border-yellow-800'
      break
    case 2: // 红土地
      baseClass = 'bg-red-50/80 dark:bg-red-900/10 border-red-200 dark:border-red-800'
      break
    case 3: // 黑土地
      baseClass = 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600'
      break
    case 4: // 金土地
      baseClass = 'bg-amber-100/80 dark:bg-amber-900/20 border-amber-300 dark:border-amber-600'
      break
  }

  // 状态叠加
  if (status === 'dead')
    return 'bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 grayscale'

  if (status === 'harvestable')
    return `${baseClass} ring-2 ring-yellow-500 ring-offset-1 dark:ring-offset-gray-900`

  if (status === 'stealable')
    return `${baseClass} ring-2 ring-purple-500 ring-offset-1 dark:ring-offset-gray-900`

  if (status === 'growing')
    return baseClass

  return baseClass
}

function formatTime(sec: number) {
  if (sec <= 0)
    return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return `${h > 0 ? `${h}:` : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function getSafeImageUrl(url: string) {
  if (!url)
    return ''
  if (url.startsWith('http://'))
    return url.replace('http://', 'https://')
  return url
}

function getLandTypeName(level: number) {
  const typeMap: Record<number, string> = {
    0: '普通',
    1: '黄土地',
    2: '红土地',
    3: '黑土地',
    4: '金土地',
  }
  return typeMap[Number(level) || 0] || ''
}
</script>

<template>
  <div
    class="relative min-h-[140px] flex flex-col items-center border rounded-lg p-2 transition dark:border-gray-700 hover:shadow-md"
    :class="getLandStatusClass(land)"
  >
    <div class="absolute left-1 top-1 text-[10px] text-gray-400 font-mono">
      #{{ land.id }}
    </div>

    <div class="mb-1 mt-4 h-10 w-10 flex items-center justify-center">
      <img
        v-if="land.seedImage"
        :src="getSafeImageUrl(land.seedImage)"
        class="max-h-full max-w-full object-contain"
        loading="lazy"
        referrerpolicy="no-referrer"
      >
      <div v-else class="i-carbon-sprout text-xl text-gray-300" />
    </div>

    <div class="w-full truncate px-1 text-center text-xs font-bold" :title="land.plantName">
      {{ land.plantName || '-' }}
    </div>

    <div class="mb-0.5 mt-0.5 w-full text-center text-[10px] text-gray-500">
      <span v-if="land.matureInSec > 0" class="text-orange-500">
        预计 {{ formatTime(land.matureInSec) }} 后成熟
      </span>
      <span v-else>
        {{ land.phaseName || (land.status === 'locked' ? '未解锁' : '未开垦') }}
      </span>
    </div>

    <div class="mb-1 text-[10px] text-gray-400">
      {{ getLandTypeName(land.level) }}
    </div>

    <!-- Status Badges -->
    <div class="mt-auto flex origin-bottom scale-90 gap-0.5 text-[10px]">
      <span v-if="land.needWater" class="rounded bg-blue-100 px-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">水</span>
      <span v-if="land.needWeed" class="rounded bg-green-100 px-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-400">草</span>
      <span v-if="land.needBug" class="rounded bg-red-100 px-0.5 text-red-700 dark:bg-red-900/30 dark:text-red-400">虫</span>
      <!-- For friends view -->
      <span v-if="land.status === 'harvestable'" class="rounded bg-orange-100 px-0.5 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">可偷</span>
    </div>
  </div>
</template>
