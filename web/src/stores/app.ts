import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import api from '@/api'

export const useAppStore = defineStore('app', () => {
  const sidebarOpen = ref(false)
  const isDark = ref(false)

  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value
  }

  function closeSidebar() {
    sidebarOpen.value = false
  }

  function openSidebar() {
    sidebarOpen.value = true
  }

  async function fetchTheme() {
    try {
      const res = await api.get('/api/settings')
      if (res.data.ok && res.data.data.ui) {
        const theme = res.data.data.ui.theme
        isDark.value = theme === 'dark'
      }
    }
    catch (e) {
      console.error('设置主题错误:', e)
    }
  }

  async function setTheme(theme: 'light' | 'dark') {
    try {
      await api.post('/api/settings/theme', { theme })
      isDark.value = theme === 'dark'
    }
    catch (e) {
      console.error('设置主题错误:', e)
    }
  }

  function toggleDark() {
    const newTheme = isDark.value ? 'light' : 'dark'
    setTheme(newTheme)
  }

  // Watch for changes in isDark and apply theme class
  watch(isDark, (val) => {
    if (val) {
      document.documentElement.classList.add('dark')
    }
    else {
      document.documentElement.classList.remove('dark')
    }
  }, { immediate: true })

  return {
    sidebarOpen,
    isDark,
    toggleDark,
    toggleSidebar,
    closeSidebar,
    openSidebar,
    fetchTheme,
    setTheme,
  }
})
