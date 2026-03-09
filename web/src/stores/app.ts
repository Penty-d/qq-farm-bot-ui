import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import api from '@/api'

const theme_key = useStorage('ui_theme', 'dark')
const tokenRef = useStorage('admin_token', '')
const accountIdRef = useStorage('current_account_id', '')

export const useAppStore = defineStore('app', () => {
  const sidebarOpen = ref(false)
  const isDark = ref(theme_key.value === 'dark')

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
    if (!String(tokenRef.value || '').trim() || !String(accountIdRef.value || '').trim())
      return

    try {
      const res = await api.get('/api/settings')
      if (res.data.ok && res.data.data.ui) {
        const theme = res.data.data.ui.theme
        isDark.value = theme === 'dark'
        theme_key.value = theme
      }
    }
    catch {
      // 初始化阶段无账号或接口暂不可用时静默失败，使用本地缓存值
    }
  }

  async function setTheme(theme: 'light' | 'dark') {
    try {
      await api.post('/api/settings/theme', { theme })
      isDark.value = theme === 'dark'
      theme_key.value = theme
    }
    catch (e) {
      console.error('设置主题失败:', e)
    }
  }

  function toggleDark() {
    const newTheme = isDark.value ? 'light' : 'dark'
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
