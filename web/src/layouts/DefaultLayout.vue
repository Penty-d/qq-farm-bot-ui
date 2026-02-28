<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const { sidebarOpen } = storeToRefs(appStore)
const route = useRoute()
const contentScrollRef = ref<HTMLElement | null>(null)

watch(
  () => route.fullPath,
  () => {
    nextTick(() => {
      if (contentScrollRef.value)
        contentScrollRef.value.scrollTop = 0
    })
  },
)
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
      <!-- Top Bar (Mobile/Tablet only or for additional actions) -->
      <header class="h-16 flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-6 lg:hidden dark:border-gray-700/50 dark:bg-gray-800">
        <div class="flex items-center gap-2 text-lg font-bold">
          <div class="i-carbon-sprout text-green-500" />
          <span>QQ农场智能助手</span>
        </div>
        <button
          class="flex items-center justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
          @click="appStore.toggleSidebar"
        >
          <div class="i-carbon-menu text-xl" />
        </button>
      </header>

      <!-- Main Content Area -->
      <div class="flex flex-1 flex-col overflow-hidden">
        <div ref="contentScrollRef" class="custom-scrollbar flex flex-1 flex-col overflow-y-auto p-2 md:p-6 sm:p-4">
          <RouterView v-slot="{ Component, route: currentRoute }">
            <Transition name="slide-fade" mode="out-in">
              <component :is="Component" :key="currentRoute.path" />
            </Transition>
          </RouterView>
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
