<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDateFormat, useIntervalFn, useNow } from '@vueuse/core'
import { useRoute } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import api from '@/api'
import { useAppStore } from '@/stores/app'
import { useAccountStore } from '@/stores/account'
import { useStatusStore } from '@/stores/status'
import { getPlatformClass, getPlatformLabel } from '@/stores/account'

const appStore = useAppStore()
const accountStore = useAccountStore()
const statusStore = useStatusStore()
const { sidebarOpen } = storeToRefs(appStore)
const { accounts, currentAccount } = storeToRefs(accountStore)
const { status, realtimeConnected } = storeToRefs(statusStore)
const route = useRoute()
const contentScrollRef = ref<HTMLElement | null>(null)
const showMobileMenu = ref(false)
const showAccountSelector = ref(false)
const menuButtonRef = ref<HTMLElement | null>(null)
const accountSelectorRef = ref<HTMLElement | null>(null)

// 状态相关
const systemConnected = ref(true)
const serverUptimeBase = ref(0)
const serverVersion = ref('')
const lastPingTime = ref(Date.now())
const now = useNow()
const formattedTime = useDateFormat(now, 'YYYY-MM-DD HH:mm:ss')
const version = __APP_VERSION__

async function checkConnection() {
  try {
    const res = await api.get('/api/ping')
    systemConnected.value = true
    if (res.data.ok && res.data.data) {
      if (res.data.data.uptime) {
        serverUptimeBase.value = res.data.data.uptime
        lastPingTime.value = Date.now()
      }
      if (res.data.data.version) {
        serverVersion.value = res.data.data.version
      }
    }
  }
  catch {
    systemConnected.value = false
  }
}

const uptime = computed(() => {
  const diff = Math.floor(serverUptimeBase.value + (now.value.getTime() - lastPingTime.value) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  return `${h}h ${m}m ${s}s`
})

const connectionStatus = computed(() => {
  if (!systemConnected.value) {
    return {
      text: '系统离线',
      color: 'bg-red-500',
      pulse: false,
    }
  }

  if (!currentAccount.value?.id) {
    return {
      text: '请添加账号',
      color: 'bg-gray-400',
      pulse: false,
    }
  }

  const isConnected = status.value?.connection?.connected
  if (isConnected) {
    return {
      text: '运行中',
      color: 'bg-green-500',
      pulse: true,
    }
  }

  return {
    text: '未连接',
    color: 'bg-gray-400',
    pulse: false,
  }
})

onMounted(() => {
  checkConnection()
  useIntervalFn(checkConnection, 30000)
})

watch(
  () => route.fullPath,
  () => {
    nextTick(() => {
      if (contentScrollRef.value)
        contentScrollRef.value.scrollTop = 0
    })
    showMobileMenu.value = false
    showAccountSelector.value = false
  },
)

function handleClickOutside(event: MouseEvent) {
  if (menuButtonRef.value && !menuButtonRef.value.contains(event.target as Node)) {
    showMobileMenu.value = false
  }
  if (accountSelectorRef.value && !accountSelectorRef.value.contains(event.target as Node)) {
    const selectorPanel = document.querySelector('[class*="bottom-0 left-0 right-0"]')
    if (selectorPanel && !selectorPanel.contains(event.target as Node)) {
      showAccountSelector.value = false
    }
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  accountStore.fetchAccounts()
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})

function selectAccount(acc: any) {
  accountStore.setCurrentAccount(acc)
  showAccountSelector.value = false
}

function getAccountAvatar(account: any) {
  const avatar = String(account?.avatar || account?.avatarUrl || '').trim()
  if (avatar)
    return avatar

  const uin = String(account?.uin || account?.qq || '').trim()
  if (uin)
    return `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100`

  return ''
}

function getAccountMeta(account: any) {
  const uin = String(account?.uin || account?.qq || '').trim()
  if (uin)
    return uin

  const gid = String(account?.gid || '').trim()
  if (gid)
    return `GID:${gid}`

  return String(account?.id || '未选择')
}


</script>

<template>
  <div class="w-screen flex overflow-hidden bg-gray-50 dark:bg-gray-900" style="height: 100dvh;">
    <!-- Mobile Sidebar Overlay -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-sm transition-opacity lg:hidden"
      @click="appStore.closeSidebar"
    />

    <Sidebar />

    <main class="relative h-full min-w-0 flex flex-1 flex-col overflow-hidden">
      <!-- Mobile Top Bar (Brand) -->
      <header class="h-12 flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-4 lg:hidden dark:border-gray-700/50 dark:bg-gray-800">
        <div class="flex items-center gap-2">
          <div class="i-carbon-sprout text-xl text-green-500" />
          <span class="text-sm font-bold from-green-600 to-emerald-500 bg-gradient-to-r bg-clip-text text-transparent">
            QQ农场智能助手
          </span>
        </div>
        <ThemeToggle />
      </header>

      <!-- Main Content Area -->
      <div class="flex flex-1 flex-col overflow-hidden pb-16 lg:pb-0">
        <div ref="contentScrollRef" class="custom-scrollbar flex flex-1 flex-col overflow-y-auto p-2 md:p-6 sm:p-4">
          <RouterView v-slot="{ Component, route: currentRoute }">
            <Transition name="slide-fade" mode="out-in">
              <component :is="Component" :key="currentRoute.path" />
            </Transition>
          </RouterView>
        </div>
      </div>

      <!-- Bottom Navigation Bar (Mobile Only) -->
      <div class="fixed bottom-0 left-0 right-0 z-50 lg:hidden">
        <!-- Navigation Bar -->
        <div class="flex items-center justify-around border-t border-gray-100 bg-white px-2 pb-safe pt-2 dark:border-gray-700/50 dark:bg-gray-800">
          <router-link
            to="/"
            class="flex flex-1 flex-col items-center gap-1 rounded-lg px-2 py-2 transition-all duration-200"
            :class="$route.path === '/' ? 'text-green-600 dark:text-green-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'"
          >
            <div class="text-xl" :class="$route.path === '/' ? 'i-carbon-chart-pie' : 'i-carbon-chart-pie'" />
            <span class="text-xs font-medium">概览</span>
          </router-link>
          <router-link
            to="/personal"
            class="flex flex-1 flex-col items-center gap-1 rounded-lg px-2 py-2 transition-all duration-200"
            :class="$route.path === '/personal' ? 'text-green-600 dark:text-green-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'"
          >
            <div class="text-xl" :class="$route.path === '/personal' ? 'i-carbon-user' : 'i-carbon-user'" />
            <span class="text-xs font-medium">个人</span>
          </router-link>
          <button
            ref="accountSelectorRef"
            class="flex flex-1 flex-col items-center gap-1 rounded-lg px-2 py-2 transition-all duration-200"
            :class="$route.path === '/accounts' ? 'text-green-600 dark:text-green-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'"
            @click="showAccountSelector = !showAccountSelector"
          >
            <div class="relative h-5 w-5 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 ring-1 ring-white dark:bg-gray-600 dark:ring-gray-700">
              <img
                v-if="getAccountAvatar(currentAccount)"
                :src="getAccountAvatar(currentAccount)"
                class="h-full w-full object-cover"
                @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
              >
              <div v-else class="i-carbon-user text-gray-400 text-sm" />
            </div>
            <span class="text-xs font-medium">账号</span>
          </button>

          <!-- More Menu Button -->
          <div class="relative flex flex-1 flex-col items-center">
            <button
              ref="menuButtonRef"
              class="flex flex-1 flex-col items-center gap-1 rounded-lg px-2 py-2 transition-all duration-200"
              :class="showMobileMenu ? 'text-green-600 dark:text-green-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'"
              @click="showMobileMenu = !showMobileMenu"
            >
              <div class="text-xl i-carbon-overflow-menu-horizontal" />
              <span class="text-xs font-medium">更多</span>
            </button>

            <!-- Dropdown Menu -->
            <div
              v-if="showMobileMenu"
              class="absolute bottom-full right-0 z-50 mb-2 w-96 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="flex">
                <!-- 左侧：状态信息 (70%) -->
                <div class="w-[70%] border-r border-gray-100 p-4 dark:border-gray-700">
                  <!-- 第一行：状态 + 运行时长 -->
                  <div class="mb-3 flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <div
                        class="h-2.5 w-2.5 rounded-full"
                        :class="[connectionStatus.color, { 'animate-pulse': connectionStatus.pulse }]"
                      />
                      <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ connectionStatus.text }}</span>
                    </div>
                    <span class="text-sm text-gray-500 dark:text-gray-400">{{ uptime }}</span>
                  </div>

                  <!-- 第二行：启动时间 -->
                  <div class="mb-3 text-xs text-gray-400">
                    {{ formattedTime }}
                  </div>

                  <!-- 第三行：版本号（同一行） -->
                  <div class="flex items-center justify-between text-xs text-gray-400 font-mono opacity-60">
                    <span>Web v{{ version }}</span>
                    <span v-if="serverVersion">Core v{{ serverVersion }}</span>
                  </div>
                </div>

                <!-- 右侧：功能菜单 (30%) -->
                <div class="flex w-[30%] flex-col items-center justify-center p-2">
                  <router-link
                    to="/friends"
                    class="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700/50"
                    @click="showMobileMenu = false"
                  >
                    <div class="i-carbon-user-multiple" />
                    <span>好友</span>
                  </router-link>
                  <router-link
                    to="/analytics"
                    class="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700/50"
                    @click="showMobileMenu = false"
                  >
                    <div class="i-carbon-analytics" />
                    <span>分析</span>
                  </router-link>
                  <router-link
                    to="/settings"
                    class="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700/50"
                    @click="showMobileMenu = false"
                  >
                    <div class="i-carbon-settings" />
                    <span>设置</span>
                  </router-link>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Account Selector Panel (Bottom Sheet) -->
        <div v-if="showAccountSelector" class="absolute bottom-0 left-0 right-0">
          <div class="rounded-t-2xl border-t border-gray-100 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-800">
            <div class="mb-3 flex items-center justify-between">
              <h3 class="text-base font-semibold text-gray-800 dark:text-gray-200">
                选择账号
              </h3>
              <button
                class="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                @click="showAccountSelector = false"
              >
                <div class="i-carbon-close text-xl" />
              </button>
            </div>
            <div class="max-h-64 overflow-y-auto custom-scrollbar">
              <template v-if="accounts.length > 0">
                <button
                  v-for="acc in accounts"
                  :key="acc.id || acc.uin"
                  class="w-full flex items-center gap-3 rounded-lg px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  :class="{ 'bg-green-50 dark:bg-green-900/10': currentAccount?.id === acc.id }"
                  @click="selectAccount(acc)"
                >
                  <div class="h-8 w-8 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 ring-2 ring-white dark:bg-gray-600 dark:ring-gray-700">
                    <img
                      v-if="getAccountAvatar(acc)"
                      :src="getAccountAvatar(acc)"
                      class="h-full w-full object-cover"
                      @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
                    >
                    <div v-else class="i-carbon-user text-gray-400" />
                  </div>
                  <div class="min-w-0 flex flex-1 flex-col items-start">
                    <span class="w-full truncate text-left text-sm font-medium text-gray-800 dark:text-gray-200">
                      {{ acc.nick && acc.name ? `${acc.nick} (${acc.name})` : acc.name || acc.nick || acc.uin }}
                    </span>
                    <div class="flex items-center gap-1.5">
                      <span
                        v-if="acc.platform"
                        class="rounded px-1 py-0.2 text-[10px] font-medium leading-tight"
                        :class="getPlatformClass(acc.platform)"
                      >
                        {{ getPlatformLabel(acc.platform) }}
                      </span>
                      <span class="text-xs text-gray-400">{{ getAccountMeta(acc) }}</span>
                    </div>
                  </div>
                  <div v-if="currentAccount?.id === acc.id" class="i-carbon-checkmark text-green-500 text-xl" />
                </button>
              </template>
              <div v-else class="px-4 py-6 text-center text-sm text-gray-400">
                暂无账号
              </div>
            </div>
            <div class="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
              <router-link
                to="/accounts"
                class="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-green-600 transition-colors hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20"
                @click="showAccountSelector = false"
              >
                <div class="i-carbon-add" />
                <span>管理账号</span>
              </router-link>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* Slide Fade Transition */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease-out;
}

.slide-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.3);
  border-radius: 3px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
}
</style>
