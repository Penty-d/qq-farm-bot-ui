import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import api from '@/api'

const THEME_KEY = 'ui_theme'

export const useAppStore = defineStore('app', () => {
  const sidebarOpen = ref(false)
  const isDark = ref(localStorage.getItem(THEME_KEY) === 'dark')

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
        localStorage.setItem(THEME_KEY, theme)
      }
    }
    catch {
      // 未登录时静默失败，使用本地缓存值
    }
  }

  async function setTheme(theme: 'dark' | 'light') {
    try {
      await api.post('/api/settings/theme', { theme })
      isDark.value = theme === 'light'
      localStorage.setItem(THEME_KEY, theme)
    }
    catch (e) {
      console.error('Failed to set theme:', e)
    }
  }

  function toggleDark() {
    const newTheme = isDark.value ? 'dark' : 'light'
    setTheme(newTheme)
  }

  watch(isDark, (val) => {
    if (val)
      document.documentElement.classList.add('dark')
    else
      document.documentElement.classList.remove('dark')
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
