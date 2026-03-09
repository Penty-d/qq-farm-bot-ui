import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'

export type UserRole = 'admin' | 'user'

export interface AuthUser {
  id: number
  username: string
  role: UserRole
  createdAt?: number
  updatedAt?: number
  createdBy?: string
  lastLoginAt?: number
}

export const useAuthStore = defineStore('auth', () => {
  const token = useStorage('admin_token', '')
  const user = useStorage<AuthUser | null>('current_user', null)
  const loading = ref(false)

  const isLoggedIn = computed(() => !!String(token.value || '').trim())
  const isAdmin = computed(() => user.value?.role === 'admin')

  function setAuth(nextToken: string, nextUser: AuthUser | null) {
    token.value = String(nextToken || '').trim()
    user.value = nextUser || null
  }

  function clearAuth() {
    token.value = ''
    user.value = null
  }

  async function login(username: string, password: string) {
    loading.value = true
    try {
      const res = await api.post('/api/login', { username, password })
      if (res.data?.ok) {
        setAuth(res.data.data?.token || '', res.data.data?.user || null)
      }
      return res.data
    }
    finally {
      loading.value = false
    }
  }

  async function register(username: string, password: string, inviteCode: string) {
    loading.value = true
    try {
      const res = await api.post('/api/register', { username, password, inviteCode })
      return res.data
    }
    finally {
      loading.value = false
    }
  }

  async function fetchCurrentUser() {
    if (!token.value)
      return null
    const res = await api.get('/api/me')
    if (res.data?.ok) {
      user.value = res.data.data?.user || null
      return user.value
    }
    return null
  }

  async function validate() {
    if (!token.value)
      return false
    try {
      const res = await api.get('/api/auth/validate')
      if (res.data?.ok && res.data?.data?.valid) {
        user.value = res.data.data?.user || user.value
        return true
      }
    }
    catch {
      // ignore
    }
    clearAuth()
    return false
  }

  async function logout() {
    try {
      if (token.value)
        await api.post('/api/logout')
    }
    catch {
      // ignore
    }
    finally {
      clearAuth()
    }
  }

  return {
    token,
    user,
    loading,
    isLoggedIn,
    isAdmin,
    setAuth,
    clearAuth,
    login,
    register,
    fetchCurrentUser,
    validate,
    logout,
  }
})
