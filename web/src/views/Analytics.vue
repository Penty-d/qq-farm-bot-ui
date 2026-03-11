<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onMounted, ref, watch } from 'vue'
import api from '@/api'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useAccountStore } from '@/stores/account'
import { useStatusStore } from '@/stores/status'

const accountStore = useAccountStore()
const statusStore = useStatusStore()
const { currentAccountId } = storeToRefs(accountStore)
const { status } = storeToRefs(statusStore)

const loading = ref(false)
const list = ref<any[]>([])
const sortKey = ref('exp')
const imageErrors = ref<Record<string | number, boolean>>({})

// 策略计算面板 - 默认使用当前账号等级
const strategyLevel = ref(1)
const strategyPanelCollapsed = ref(false)

// 监听 status 变化，自动更新等级
watch(() => status.value?.status?.level, (newLevel) => {
  if (newLevel && Number(newLevel) > 0) {
    strategyLevel.value = Number(newLevel)
  }
}, { immediate: true })

// 策略定义 - 与设置页面种植策略对应
// 交替排列：保证手机端2列时 左边经验类、右边利润类
// 顺序：经验/时、利润/时、普肥经验/时、普肥利润/时
const strategies = [
  {
    key: 'max_exp',
    label: '经验/时',
    metric: 'expPerHour',
    color: 'purple',
    icon: 'i-carbon-growth',
    unit: 'EXP',
    desc: '每小时经验收益最高',
  },
  {
    key: 'max_profit',
    label: '利润/时',
    metric: 'profitPerHour',
    color: 'amber',
    icon: 'i-carbon-currency',
    unit: '金币',
    desc: '每小时净利润最高',
  },
  {
    key: 'max_fert_exp',
    label: '普肥经验/时',
    metric: 'normalFertilizerExpPerHour',
    color: 'blue',
    icon: 'i-carbon-chemistry',
    unit: 'EXP',
    desc: '使用普通化肥后经验最高',
  },
  {
    key: 'max_fert_profit',
    label: '普肥利润/时',
    metric: 'normalFertilizerProfitPerHour',
    color: 'green',
    icon: 'i-carbon-piggy-bank',
    unit: '金币',
    desc: '使用普通化肥后利润最高',
  },
]

// 根据等级过滤并获取最优作物
function getStrategyBestPlant(strategyKey: string) {
  const strategy = strategies.find(s => s.key === strategyKey)
  if (!strategy)
    return null

  const metric = strategy.metric
  const filtered = list.value.filter((item) => {
    const level = item.level
    if (level === null || level === undefined)
      return true
    return Number(level) <= strategyLevel.value
  })

  if (filtered.length === 0)
    return null

  if (strategyKey === 'level') {
    return [...filtered].sort((a, b) => {
      const av = a.level ?? -1
      const bv = b.level ?? -1
      return bv - av
    })[0]
  }

  return [...filtered].sort((a, b) => {
    const av = Number(a[metric])
    const bv = Number(b[metric])
    if (!Number.isFinite(av) && !Number.isFinite(bv))
      return 0
    if (!Number.isFinite(av))
      return 1
    if (!Number.isFinite(bv))
      return -1
    return bv - av
  })[0]
}

// 获取策略的可用作物数量
function getStrategyAvailableCount() {
  return list.value.filter((item) => {
    const level = item.level
    if (level === null || level === undefined)
      return true
    return Number(level) <= strategyLevel.value
  }).length
}

function getColorClass(color: string, type: 'bg' | 'text' | 'border' | 'gradient') {
  const colorMap: Record<string, Record<string, string>> = {
    purple: {
      bg: 'bg-purple-100 dark:bg-purple-900/30',
      text: 'text-purple-600 dark:text-purple-400',
      border: 'border-purple-200 dark:border-purple-800',
      gradient: 'from-purple-500 to-purple-600',
    },
    blue: {
      bg: 'bg-blue-100 dark:bg-blue-900/30',
      text: 'text-blue-600 dark:text-blue-400',
      border: 'border-blue-200 dark:border-blue-800',
      gradient: 'from-blue-500 to-blue-600',
    },
    amber: {
      bg: 'bg-amber-100 dark:bg-amber-900/30',
      text: 'text-amber-600 dark:text-amber-400',
      border: 'border-amber-200 dark:border-amber-800',
      gradient: 'from-amber-500 to-amber-600',
    },
    green: {
      bg: 'bg-green-100 dark:bg-green-900/30',
      text: 'text-green-600 dark:text-green-400',
      border: 'border-green-200 dark:border-green-800',
      gradient: 'from-green-500 to-green-600',
    },
    rose: {
      bg: 'bg-rose-100 dark:bg-rose-900/30',
      text: 'text-rose-600 dark:text-rose-400',
      border: 'border-rose-200 dark:border-rose-800',
      gradient: 'from-rose-500 to-rose-600',
    },
  }
  return colorMap[color]?.[type] || ''
}

// 作物列表收起状态
const cropListCollapsed = ref(false)

const sortOptions = [
  { value: 'exp', label: '经验/小时' },
  { value: 'fert', label: '普通肥经验/小时' },
  { value: 'profit', label: '净利润/小时' },
  { value: 'fert_profit', label: '普通肥利润/小时' },
  { value: 'level', label: '作物等级' },
]

async function loadAnalytics() {
  if (!currentAccountId.value)
    return
  loading.value = true
  try {
    const res = await api.get(`/api/analytics`, {
      params: { sort: sortKey.value },
      headers: { 'x-account-id': currentAccountId.value },
    })
    const data = res.data.data
    if (Array.isArray(data)) {
      list.value = data
      // web sort as fallback
      const metricMap: Record<string, string> = {
        exp: 'expPerHour',
        fert: 'normalFertilizerExpPerHour',
        profit: 'profitPerHour',
        fert_profit: 'normalFertilizerProfitPerHour',
        level: 'level',
      }
      const metric = metricMap[sortKey.value]
      if (metric) {
        list.value.sort((a, b) => {
          const av = Number(a[metric])
          const bv = Number(b[metric])
          if (!Number.isFinite(av) && !Number.isFinite(bv))
            return 0
          if (!Number.isFinite(av))
            return 1
          if (!Number.isFinite(bv))
            return -1
          return bv - av
        })
      }
    }
    else {
      list.value = []
    }
  }
  catch (e) {
    console.error(e)
    list.value = []
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  loadAnalytics()
})

watch([currentAccountId, sortKey], () => {
  loadAnalytics()
})

function formatLv(level: any) {
  if (level === null || level === undefined || level === '' || Number(level) < 0)
    return '未知'
  return String(level)
}

function formatGrowTime(seconds: any) {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0)
    return '0秒'
  if (s < 60)
    return `${s}秒`
  if (s < 3600) {
    const mins = Math.floor(s / 60)
    const secs = s % 60
    return secs > 0 ? `${mins}分${secs}秒` : `${mins}分`
  }
  const hours = Math.floor(s / 3600)
  const mins = Math.floor((s % 3600) / 60)
  return mins > 0 ? `${hours}时${mins}分` : `${hours}时`
}
</script>

<template>
  <div class="p-4">
    <div class="mb-4">
      <h2 class="flex items-center gap-2 text-2xl font-bold">
        <div class="i-carbon-chart-line" />
        数据分析
      </h2>
    </div>

    <div v-if="loading" class="flex justify-center py-12">
      <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
    </div>

    <div v-else-if="!currentAccountId" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      请选择账号后查看数据分析
    </div>

    <div v-else-if="list.length === 0" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      暂无数据
    </div>

    <!-- 策略推荐 -->
    <div v-if="list.length > 0" class="mb-6 overflow-hidden border border-gray-200 rounded-lg bg-white shadow dark:border-gray-700 dark:bg-gray-800">
      <!-- 头部 -->
      <div
        class="flex cursor-pointer select-none items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-700/50"
        @click="strategyPanelCollapsed = !strategyPanelCollapsed"
      >
        <div class="flex items-center gap-2">
          <div
            class="text-gray-400 transition-transform"
            :class="strategyPanelCollapsed ? 'i-carbon-chevron-right' : 'i-carbon-chevron-down'"
          />
          <div class="i-carbon-calculation text-lg text-blue-500" />
          <span class="text-gray-700 font-medium dark:text-gray-300">策略推荐</span>
        </div>
        <div class="flex items-center gap-2" @click.stop>
          <span class="text-sm text-gray-500">Lv.</span>
          <input
            v-model.number="strategyLevel"
            type="number"
            min="1"
            max="100"
            class="w-14 border border-gray-300 rounded bg-white px-2 py-1 text-center text-sm outline-none dark:border-gray-600 focus:border-blue-400 dark:bg-gray-700 dark:text-gray-200"
          >
        </div>
      </div>

      <!-- 面板内容 -->
      <div v-show="!strategyPanelCollapsed" class="p-4">
        <!-- 四策略布局：大屏一排4个，手机端2x2网格 -->
        <!-- 顺序：经验、普肥经验、利润、普肥利润（交替排列保证手机端左右分组） -->
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div
            v-for="strategy in strategies"
            :key="strategy.key"
            class="overflow-hidden border rounded-lg bg-white transition-shadow dark:bg-gray-800 hover:shadow-md"
            :class="getColorClass(strategy.color, 'border')"
          >
            <div class="p-3">
              <!-- 策略标题 -->
              <div class="mb-2 flex items-center gap-2">
                <div
                  class="h-7 w-7 flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white"
                  :class="getColorClass(strategy.color, 'gradient')"
                >
                  <div class="text-sm" :class="strategy.icon" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-semibold" :class="getColorClass(strategy.color, 'text')">
                    {{ strategy.label }}
                  </div>
                </div>
              </div>

              <!-- 推荐作物 -->
              <div v-if="getStrategyBestPlant(strategy.key)" class="space-y-2">
                <div class="flex items-center gap-2">
                  <div class="h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden border rounded-lg bg-gray-50 dark:border-gray-600 dark:bg-gray-700" :class="getColorClass(strategy.color, 'border')">
                    <img
                      v-if="getStrategyBestPlant(strategy.key)?.image && !imageErrors[getStrategyBestPlant(strategy.key)?.seedId]"
                      :src="getStrategyBestPlant(strategy.key)?.image"
                      class="h-8 w-8 object-contain"
                      loading="lazy"
                      @error="imageErrors[getStrategyBestPlant(strategy.key)?.seedId] = true"
                    >
                    <div v-else class="i-carbon-sprout text-lg text-gray-400" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm text-gray-800 font-medium dark:text-gray-200">
                      {{ getStrategyBestPlant(strategy.key)?.name }}
                    </div>
                    <div class="text-xs text-gray-500">
                      Lv{{ formatLv(getStrategyBestPlant(strategy.key)?.level) }}
                    </div>
                  </div>
                </div>
                <!-- 效率值 -->
                <div class="rounded-md bg-gray-50 px-2 py-1.5 dark:bg-gray-900/50">
                  <div class="flex items-baseline justify-between">
                    <span class="text-xs text-gray-500">{{ strategy.unit }}/时</span>
                    <span class="text-base font-bold" :class="getColorClass(strategy.color, 'text')">
                      {{ getStrategyBestPlant(strategy.key)?.[strategy.metric] }}
                    </span>
                  </div>
                </div>
              </div>
              <div v-else class="py-3 text-center text-xs text-gray-400">
                暂无可种植作物
              </div>
            </div>
          </div>
        </div>

        <!-- 简化的提示信息 -->
        <div class="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <div class="i-carbon-information" />
          <span>可种植 {{ getStrategyAvailableCount() }}/{{ list.length }} 种作物 · 策略计算与设置页面种植策略一致</span>
        </div>
      </div>
    </div>

    <div v-else-if="!loading && currentAccountId && list.length === 0" />

    <!-- 作物信息列表（可收起） -->
    <div v-if="list.length > 0" class="overflow-hidden border border-gray-200 rounded-lg bg-white shadow dark:border-gray-700 dark:bg-gray-800">
      <div
        class="flex cursor-pointer select-none items-center justify-between border-b border-gray-200 bg-gray-50 p-4 transition dark:border-gray-700 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700"
        @click="cropListCollapsed = !cropListCollapsed"
      >
        <div class="flex items-center gap-3">
          <div
            class="text-lg transition-transform"
            :class="cropListCollapsed ? 'i-carbon-chevron-right text-gray-400' : 'i-carbon-chevron-down text-gray-400'"
          />
          <div class="i-carbon-sprout text-xl text-green-500" />
          <div>
            <h3 class="text-gray-700 font-semibold dark:text-gray-300">
              全部作物信息
            </h3>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              共 {{ list.length }} 种作物
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <label class="whitespace-nowrap text-sm font-medium" @click.stop>排序:</label>
          <BaseSelect
            v-model="sortKey"
            :options="sortOptions"
            class="w-40"
            @click.stop
          />
        </div>
      </div>

      <div v-show="!cropListCollapsed" class="p-4 space-y-4">
        <!-- Mobile Card View -->
        <div class="block sm:hidden space-y-4">
          <div v-for="(item, idx) in list" :key="idx" class="border border-gray-200 rounded-lg bg-white p-4 shadow dark:border-gray-700 dark:bg-gray-800">
            <div class="mb-3 flex items-start gap-3">
              <div class="relative h-12 w-12 flex shrink-0 items-center justify-center overflow-hidden border border-gray-200 rounded-lg bg-gray-100 dark:border-gray-600 dark:bg-gray-700">
                <img
                  v-if="item.image && !imageErrors[item.seedId]"
                  :src="item.image"
                  class="h-10 w-10 object-contain"
                  loading="lazy"
                  @error="imageErrors[item.seedId] = true"
                >
                <div v-else class="i-carbon-sprout text-2xl text-gray-400" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between">
                  <div class="truncate text-gray-900 font-bold dark:text-gray-100">
                    {{ item.name }}
                  </div>
                  <div class="text-xs text-gray-500">
                    ID:{{ item.seedId }}
                  </div>
                </div>
                <div class="mt-1 flex items-center gap-2">
                  <span class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 font-medium dark:bg-gray-700">Lv{{ formatLv(item.level) }}</span>
                  <span class="text-xs text-gray-400">{{ item.seasons }}季</span>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div class="flex flex-col">
                <span class="text-xs text-gray-500">时间</span>
                <span class="text-gray-700 font-medium dark:text-gray-300">{{ formatGrowTime(item.growTime) }}</span>
              </div>
              <div class="flex flex-col">
                <span class="text-xs text-gray-500">经验/时</span>
                <span class="text-purple-600 font-bold dark:text-purple-400">{{ item.expPerHour }}</span>
              </div>
              <div class="flex flex-col">
                <span class="text-xs text-gray-500">净利润/时</span>
                <span class="text-amber-500 font-bold">{{ item.profitPerHour ?? '-' }}</span>
              </div>
              <div class="flex flex-col">
                <span class="text-xs text-gray-500">普肥经验/时</span>
                <span class="text-blue-600 font-bold dark:text-blue-400">{{ item.normalFertilizerExpPerHour ?? '-' }}</span>
              </div>
              <div class="flex flex-col">
                <span class="text-xs text-gray-500">普肥利润/时</span>
                <span class="text-green-500 font-bold">{{ item.normalFertilizerProfitPerHour ?? '-' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Desktop Table View -->
        <div class="hidden overflow-hidden border border-gray-200 rounded-lg bg-white shadow sm:block dark:border-gray-700 dark:bg-gray-800">
          <div class="overflow-x-auto">
            <table class="w-full whitespace-nowrap text-left text-sm">
              <thead class="border-b bg-gray-50 text-xs text-gray-500 uppercase dark:border-gray-700 dark:bg-gray-700/50 dark:text-gray-400">
                <tr>
                  <th class="sticky left-0 z-10 bg-gray-50 px-4 py-3 font-medium shadow-[1px_0_0_0_rgba(0,0,0,0.05)] dark:bg-gray-800 dark:shadow-[1px_0_0_0_rgba(255,255,255,0.05)]">
                    作物 (Lv)
                  </th>
                  <th class="px-4 py-3 font-medium">
                    时间
                  </th>
                  <th class="px-4 py-3 text-right font-medium">
                    经验/时
                  </th>
                  <th class="px-4 py-3 text-right font-medium">
                    普通肥经验/时
                  </th>
                  <th class="px-4 py-3 text-right font-medium">
                    净利润/时
                  </th>
                  <th class="px-4 py-3 text-right font-medium">
                    普通肥净利润/时
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
                <tr v-for="(item, idx) in list" :key="idx" class="group transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td class="sticky left-0 bg-white px-4 py-2 shadow-[1px_0_0_0_rgba(0,0,0,0.05)] transition-colors dark:bg-gray-800 group-hover:bg-gray-50 dark:shadow-[1px_0_0_0_rgba(255,255,255,0.05)] dark:group-hover:bg-gray-700/50">
                    <div class="flex items-center gap-3">
                      <div class="relative h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden border border-gray-200 rounded-lg bg-gray-100 dark:border-gray-600 dark:bg-gray-700">
                        <img
                          v-if="item.image && !imageErrors[item.seedId]"
                          :src="item.image"
                          class="h-8 w-8 object-contain"
                          loading="lazy"
                          @error="imageErrors[item.seedId] = true"
                        >
                        <div v-else class="i-carbon-sprout text-xl text-gray-400" />
                      </div>
                      <div>
                        <div class="text-gray-900 font-bold dark:text-gray-100">
                          {{ item.name }}
                        </div>
                        <div class="mt-0.5 flex items-center gap-1.5">
                          <span class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 font-medium dark:bg-gray-700">Lv{{ formatLv(item.level) }}</span>
                          <span class="text-[10px] text-gray-400">ID:{{ item.seedId }}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td class="px-4 py-2 text-gray-600 dark:text-gray-300">
                    <div class="font-medium">
                      {{ formatGrowTime(item.growTime) }}
                    </div>
                    <div class="text-xs text-gray-400">
                      {{ item.seasons }}季
                    </div>
                  </td>
                  <td class="px-4 py-2 text-right">
                    <div class="text-purple-600 font-bold dark:text-purple-400">
                      {{ item.expPerHour }}
                    </div>
                  </td>
                  <td class="px-4 py-2 text-right">
                    <div class="text-blue-600 font-bold dark:text-blue-400">
                      {{ item.normalFertilizerExpPerHour ?? '-' }}
                    </div>
                  </td>
                  <td class="px-4 py-2 text-right">
                    <div class="text-amber-500 font-bold">
                      {{ item.profitPerHour ?? '-' }}
                    </div>
                  </td>
                  <td class="px-4 py-2 text-right">
                    <div class="text-green-500 font-bold">
                      {{ item.normalFertilizerProfitPerHour ?? '-' }}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
