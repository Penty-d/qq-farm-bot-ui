<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import LandCard from '@/components/LandCard.vue'
import { useAccountStore } from '@/stores/account'
import { useFriendStore } from '@/stores/friend'
import { useStatusStore } from '@/stores/status'

const accountStore = useAccountStore()
const friendStore = useFriendStore()
const statusStore = useStatusStore()
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { friends, loading, friendLands, friendLandsLoading, blacklist } = storeToRefs(friendStore)
const { status, loading: statusLoading, realtimeConnected } = storeToRefs(statusStore)

// Confirm Modal state
const showConfirm = ref(false)
const confirmMessage = ref('')
const confirmLoading = ref(false)
const pendingAction = ref<(() => Promise<void>) | null>(null)
const avatarErrorKeys = ref<Set<string>>(new Set())
const searchKeyword = ref('')

function confirmAction(msg: string, action: () => Promise<void>) {
  confirmMessage.value = msg
  pendingAction.value = action
  showConfirm.value = true
}

async function onConfirm() {
  if (pendingAction.value) {
    try {
      confirmLoading.value = true
      await pendingAction.value()
      pendingAction.value = null
      showConfirm.value = false
    }
    finally {
      confirmLoading.value = false
    }
  }
  else {
    showConfirm.value = false
  }
}

// Track expanded friends
const expandedFriends = ref<Set<string>>(new Set())
const filteredFriends = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  if (!keyword)
    return friends.value

  return friends.value.filter((friend: any) => {
    const name = String(friend?.name || '').toLowerCase()
    const gid = String(friend?.gid || '')
    const uin = String(friend?.uin || '')
    return name.includes(keyword) || gid.includes(keyword) || uin.includes(keyword)
  })
})

async function loadFriends() {
  if (currentAccountId.value) {
    const acc = currentAccount.value
    if (!acc)
      return

    if (!realtimeConnected.value) {
      await statusStore.fetchStatus(currentAccountId.value)
    }

    if (acc.running && status.value?.connection?.connected) {
      avatarErrorKeys.value.clear()
      friendStore.fetchFriends(currentAccountId.value)
      friendStore.fetchBlacklist(currentAccountId.value)
    }
  }
}

useIntervalFn(() => {
  for (const gid in friendLands.value) {
    if (friendLands.value[gid]) {
      friendLands.value[gid] = friendLands.value[gid].map((l: any) =>
        l.matureInSec > 0 ? { ...l, matureInSec: l.matureInSec - 1 } : l,
      )
    }
  }
}, 1000)

onMounted(() => {
  loadFriends()
})

watch(currentAccountId, () => {
  expandedFriends.value.clear()
  loadFriends()
})

function toggleFriend(friendId: string) {
  if (expandedFriends.value.has(friendId)) {
    expandedFriends.value.delete(friendId)
  }
  else {
    // Collapse others? The original code does:
    // document.querySelectorAll('.friend-lands').forEach(e => e.style.display = 'none');
    // So it behaves like an accordion.
    expandedFriends.value.clear()
    expandedFriends.value.add(friendId)
    if (currentAccountId.value && currentAccount.value?.running && status.value?.connection?.connected) {
      friendStore.fetchFriendLands(currentAccountId.value, friendId)
    }
  }
}

async function handleOp(friendId: string, type: string, e: Event) {
  e.stopPropagation()
  if (!currentAccountId.value)
    return

  confirmAction('确定执行此操作吗?', async () => {
    await friendStore.operate(currentAccountId.value!, friendId, type)
  })
}

async function handleToggleBlacklist(friend: any, e: Event) {
  e.stopPropagation()
  if (!currentAccountId.value)
    return
  await friendStore.toggleBlacklist(currentAccountId.value, Number(friend.gid))
}

function getFriendStatusText(friend: any) {
  const p = friend.plant || {}
  const info = []
  if (p.stealNum)
    info.push(`偷${p.stealNum}`)
  if (p.dryNum)
    info.push(`水${p.dryNum}`)
  if (p.weedNum)
    info.push(`草${p.weedNum}`)
  if (p.insectNum)
    info.push(`虫${p.insectNum}`)
  return info.length ? info.join(' ') : '无操作'
}

function getFriendAvatar(friend: any) {
  const direct = String(friend?.avatarUrl || friend?.avatar_url || '').trim()
  if (direct)
    return direct
  const uin = String(friend?.uin || '').trim()
  if (uin)
    return `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100`
  return ''
}

function getFriendAvatarKey(friend: any) {
  const key = String(friend?.gid || friend?.uin || '').trim()
  return key || String(friend?.name || '').trim()
}

function canShowFriendAvatar(friend: any) {
  const key = getFriendAvatarKey(friend)
  if (!key)
    return false
  return !!getFriendAvatar(friend) && !avatarErrorKeys.value.has(key)
}

function handleFriendAvatarError(friend: any) {
  const key = getFriendAvatarKey(friend)
  if (!key)
    return
  avatarErrorKeys.value.add(key)
}
</script>

<template>
  <div class="p-4">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="flex items-center gap-2 text-2xl font-bold">
        <div class="i-carbon-user-multiple" />
        好友
      </h2>
      <div v-if="friends.length" class="text-sm text-gray-500">
        <span v-if="searchKeyword.trim()">筛选 {{ filteredFriends.length }} / {{ friends.length }} 名好友</span>
        <span v-else>共 {{ friends.length }} 名好友</span>
      </div>
    </div>

    <div v-if="status?.connection?.connected && friends.length" class="mb-4">
      <div class="relative">
        <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
          <div class="i-carbon-search" />
        </div>
        <input
          v-model="searchKeyword"
          type="text"
          class="w-full border border-gray-200 rounded-lg bg-white py-2 pl-10 pr-3 text-sm outline-none transition dark:border-gray-700 focus:border-blue-400 dark:bg-gray-800"
          placeholder="搜索好友昵称 / GID / UIN"
        >
      </div>
    </div>

    <div v-if="loading || statusLoading" class="flex justify-center py-12">
      <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
    </div>

    <div v-else-if="!currentAccountId" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      请选择账号后查看好友
    </div>

    <div v-else-if="!status?.connection?.connected" class="flex flex-col items-center justify-center gap-4 rounded-lg bg-white p-12 text-center text-gray-500 shadow dark:bg-gray-800">
      <div class="i-carbon-connection-signal-off text-4xl text-gray-400" />
      <div>
        <div class="text-lg text-gray-700 font-medium dark:text-gray-300">
          账号未登录
        </div>
        <div class="mt-1 text-sm text-gray-400">
          请先运行账号或检查网络连接
        </div>
      </div>
    </div>

    <div v-else-if="friends.length === 0" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      暂无好友或数据加载失败
    </div>

    <div v-else-if="filteredFriends.length === 0" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      未找到匹配的好友
    </div>

    <div v-else class="space-y-4">
      <div
        v-for="friend in filteredFriends"
        :key="friend.gid"
        class="overflow-hidden rounded-lg bg-white shadow dark:bg-gray-800"
      >
        <div
          class="flex flex-col cursor-pointer justify-between gap-4 p-4 transition sm:flex-row sm:items-center hover:bg-gray-50 dark:hover:bg-gray-700/50"
          :class="blacklist.includes(Number(friend.gid)) ? 'opacity-50' : ''"
          @click="toggleFriend(friend.gid)"
        >
          <div class="flex items-center gap-3">
            <div class="h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 ring-1 ring-gray-100 dark:bg-gray-600 dark:ring-gray-700">
              <img
                v-if="canShowFriendAvatar(friend)"
                :src="getFriendAvatar(friend)"
                class="h-full w-full object-cover"
                loading="lazy"
                @error="handleFriendAvatarError(friend)"
              >
              <div v-else class="i-carbon-user text-gray-400" />
            </div>
            <div>
              <div class="flex items-center gap-2 font-bold">
                {{ friend.name }}
                <span v-if="blacklist.includes(Number(friend.gid))" class="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400">已屏蔽</span>
              </div>
              <div class="text-sm" :class="getFriendStatusText(friend) !== '无操作' ? 'text-green-500 font-medium' : 'text-gray-400'">
                {{ getFriendStatusText(friend) }}
              </div>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              class="rounded bg-blue-100 px-3 py-2 text-sm text-blue-700 transition hover:bg-blue-200"
              @click="handleOp(friend.gid, 'steal', $event)"
            >
              偷取
            </button>
            <button
              class="rounded bg-cyan-100 px-3 py-2 text-sm text-cyan-700 transition hover:bg-cyan-200"
              @click="handleOp(friend.gid, 'water', $event)"
            >
              浇水
            </button>
            <button
              class="rounded bg-green-100 px-3 py-2 text-sm text-green-700 transition hover:bg-green-200"
              @click="handleOp(friend.gid, 'weed', $event)"
            >
              除草
            </button>
            <button
              class="rounded bg-orange-100 px-3 py-2 text-sm text-orange-700 transition hover:bg-orange-200"
              @click="handleOp(friend.gid, 'bug', $event)"
            >
              除虫
            </button>
            <button
              class="rounded bg-red-100 px-3 py-2 text-sm text-red-700 transition hover:bg-red-200"
              @click="handleOp(friend.gid, 'bad', $event)"
            >
              捣乱
            </button>
            <button
              class="rounded px-3 py-2 text-sm transition"
              :class="blacklist.includes(Number(friend.gid))
                ? 'bg-gray-200 text-gray-600 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700/50 dark:text-gray-400 dark:hover:bg-gray-700'"
              @click="handleToggleBlacklist(friend, $event)"
            >
              {{ blacklist.includes(Number(friend.gid)) ? '移出黑名单' : '加入黑名单' }}
            </button>
          </div>
        </div>

        <div v-if="expandedFriends.has(friend.gid)" class="border-t bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
          <div v-if="friendLandsLoading[friend.gid]" class="flex justify-center py-4">
            <div class="i-svg-spinners-90-ring-with-bg text-2xl text-blue-500" />
          </div>
          <div v-else-if="!friendLands[friend.gid] || friendLands[friend.gid]?.length === 0" class="py-4 text-center text-gray-500">
            无土地数据
          </div>
          <div v-else class="grid grid-cols-2 gap-2 lg:grid-cols-8 md:grid-cols-5 sm:grid-cols-4">
            <LandCard
              v-for="land in friendLands[friend.gid]"
              :key="land.id"
              :land="land"
            />
          </div>
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="showConfirm"
      :loading="confirmLoading"
      title="确认操作"
      :message="confirmMessage"
      @confirm="onConfirm"
      @cancel="!confirmLoading && (showConfirm = false)"
    />
  </div>
</template>
