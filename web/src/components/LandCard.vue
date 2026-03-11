<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  land: any
}>()

const land = computed(() => props.land)
const isMergedCard = computed(() => !!land.value?.mergedCard)

function getLandStatusClass(land: any) {
  const status = land.status
  const level = Number(land.level) || 0

  if (status === 'locked')
    return 'bg-gray-100 dark:bg-gray-800 opacity-60 border-dashed'

  let baseClass = 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'

  switch (level) {
    case 1:
      baseClass = 'bg-yellow-50/80 dark:bg-yellow-900/10 border-yellow-200 dark:border-yellow-800'
      break
    case 2:
      baseClass = 'bg-red-50/80 dark:bg-red-900/10 border-red-200 dark:border-red-800'
      break
    case 3:
      baseClass = 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600'
      break
    case 4:
      baseClass = 'bg-amber-100/80 dark:bg-amber-900/20 border-amber-300 dark:border-amber-600'
      break
  }

  if (status === 'dead')
    return 'bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 grayscale'

  if (status === 'harvestable')
    return `${baseClass} ring-2 ring-yellow-500 ring-offset-1 dark:ring-offset-gray-900`

  if (status === 'stealable')
    return `${baseClass} ring-2 ring-purple-500 ring-offset-1 dark:ring-offset-gray-900`

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
    0: '普通地',
    1: '黄土地',
    2: '红土地',
    3: '黑土地',
    4: '金土地',
  }
  return typeMap[Number(level) || 0] || ''
}

function getPlantSizeText(land: any) {
  const size = Number(land?.plantSize) || 1
  if (size <= 1)
    return ''
  return `${size}x${size}`
}
</script>

<template>
  <div
    class="relative flex h-full min-h-[140px] flex-col items-center rounded-lg border p-2 transition hover:shadow-md dark:border-gray-700"
    :class="getLandStatusClass(land)"
  >
    <div class="absolute left-1 top-1 font-mono text-[10px] leading-4 text-gray-400">
      <template v-if="isMergedCard && Array.isArray(land.mergedLandIds) && land.mergedLandIds.length">
        <div
          v-for="(row, rowIndex) in land.mergedLandIds"
          :key="`row-${rowIndex}`"
          class="whitespace-nowrap"
        >
          <span
            v-for="id in row"
            :key="id"
            class="mr-1 inline-block"
          >
            #{{ id }}
          </span>
        </div>
      </template>
      <template v-else>
        #{{ land.id }}
      </template>
    </div>

    <div
      v-if="land.plantSize > 1"
      class="absolute right-1 top-1 rounded bg-pink-100 px-1 py-0.5 text-[10px] text-pink-700 dark:bg-pink-900/30 dark:text-pink-300"
    >
      合种 {{ getPlantSizeText(land) }}
    </div>

    <div
      class="flex w-full flex-1 flex-col items-center"
      :class="isMergedCard ? 'justify-center pt-4' : 'justify-start pt-4'"
    >
      <div class="mb-1 flex h-10 w-10 items-center justify-center">
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

      <div class="text-[10px] text-gray-400">
        {{ getLandTypeName(land.level) }}
      </div>

      <div class="mb-1 text-[10px] text-gray-400">
        季数 {{ land.totalSeason > 0 ? `${land.currentSeason}/${land.totalSeason}` : '-/-' }}
      </div>
    </div>

    <div class="mb-1 flex origin-bottom scale-90 gap-0.5 text-[10px]">
      <span v-if="land.needWater" class="rounded bg-blue-100 px-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">水</span>
      <span v-if="land.needWeed" class="rounded bg-green-100 px-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-400">草</span>
      <span v-if="land.needBug" class="rounded bg-red-100 px-0.5 text-red-700 dark:bg-red-900/30 dark:text-red-400">虫</span>
      <span v-if="land.status === 'harvestable'" class="rounded bg-orange-100 px-0.5 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">可偷</span>
    </div>
  </div>
</template>
