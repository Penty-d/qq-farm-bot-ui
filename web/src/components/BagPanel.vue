<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { onMounted, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'
import { useStatusStore } from '@/stores/status'

const accountStore = useAccountStore()
const bagStore = useBagStore()
const statusStore = useStatusStore()

const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { items, loading: bagLoading } = storeToRefs(bagStore)
const { status, loading: statusLoading, error: statusError, realtimeConnected } = storeToRefs(statusStore)

const imageErrors = ref<Record<string | number, boolean>>({})

function getPriceClass(item: any) {
  const priceId = Number(item?.priceId || 0)
  if (priceId === 1005)
    return 'text-amber-400 dark:text-amber-300'
  if (priceId === 1002)
    return 'text-sky-400 dark:text-sky-300'
  return 'text-gray-400'
}

async function loadBag() {
  if (!currentAccountId.value)
    return

  const acc = currentAccount.value
  if (!acc)
    return

  if (!realtimeConnected.value)
    await statusStore.fetchStatus(currentAccountId.value)

  if (acc.running && status.value?.connection?.connected)
    await bagStore.fetchBag(currentAccountId.value)

  imageErrors.value = {}
}

onMounted(() => {
  loadBag()
})

watch(currentAccountId, () => {
  loadBag()
})

useIntervalFn(loadBag, 60000)
</script>

<template>
  <div class="space-y-4">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="flex items-center gap-2 text-2xl font-bold">
        <div class="i-carbon-inventory-management" />
        背包
      </h2>
      <div v-if="items.length" class="text-sm text-gray-500">
        共 {{ items.length }} 种物品
      </div>
    </div>

    <div v-if="bagLoading || statusLoading" class="flex justify-center py-12">
      <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
    </div>

    <div v-else-if="!currentAccountId" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      请选择账号后查看背包
    </div>

    <div v-else-if="statusError" class="rounded-lg border border-red-200 bg-red-50 p-8 text-center text-red-500 shadow dark:border-red-800 dark:bg-red-900/20">
      <div class="mb-2 text-lg font-bold">
        获取数据失败
      </div>
      <div class="text-sm">
        {{ statusError }}
      </div>
    </div>

    <div v-else-if="!status?.connection?.connected" class="flex flex-col items-center justify-center gap-4 rounded-lg bg-white p-12 text-center text-gray-500 shadow dark:bg-gray-800">
      <div class="i-carbon-connection-signal-off text-4xl text-gray-400" />
      <div>
        <div class="text-lg font-medium text-gray-700 dark:text-gray-300">
          账号未登录
        </div>
        <div class="mt-1 text-sm text-gray-400">
          请先运行账号或检查网络连接
        </div>
      </div>
    </div>

    <div v-else-if="items.length === 0" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      无可展示物品
    </div>

    <div v-else class="grid grid-cols-2 gap-4 lg:grid-cols-5 md:grid-cols-4 sm:grid-cols-3 xl:grid-cols-6">
      <div
        v-for="item in items"
        :key="item.id"
        class="group relative flex flex-col items-center rounded-lg border bg-white p-3 transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
      >
        <div class="absolute left-2 top-2 font-mono text-xs text-gray-400">
          #{{ item.id }}
        </div>

        <div
          class="thumb-wrap mb-2 mt-6 flex h-16 w-16 items-center justify-center rounded-full bg-gray-50 dark:bg-gray-700/50"
          :data-fallback="(item.name || '物').slice(0, 1)"
        >
          <img
            v-if="item.image && !imageErrors[item.id]"
            :src="item.image"
            :alt="item.name"
            class="max-h-full max-w-full object-contain"
            loading="lazy"
            @error="imageErrors[item.id] = true"
          >
          <div v-else class="text-2xl font-bold text-gray-400 uppercase">
            {{ (item.name || '物').slice(0, 1) }}
          </div>
        </div>

        <div class="mb-1 w-full truncate px-2 text-center text-sm font-bold" :title="item.name">
          {{ item.name || `物品${item.id}` }}
        </div>

        <div class="mb-2 flex flex-col items-center gap-0.5 text-xs text-gray-400">
          <span v-if="item.uid">UID: {{ item.uid }}</span>
          <span>
            类型: {{ item.itemType || 0 }}
            <span v-if="item.level > 0"> · Lv{{ item.level }}</span>
            <span v-if="item.price > 0" :class="getPriceClass(item)"> · {{ item.price }}{{ item.priceUnit || '金' }}</span>
          </span>
        </div>

        <div class="mt-auto font-medium" :class="item.hoursText ? 'text-blue-500' : 'text-gray-600 dark:text-gray-300'">
          {{ item.hoursText || `x${item.count || 0}` }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.thumb-wrap.fallback img {
  display: none;
}

.thumb-wrap.fallback::after {
  content: attr(data-fallback);
  font-size: 1.5rem;
  font-weight: bold;
  color: #9ca3af;
  text-transform: uppercase;
}
</style>
