import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'

export interface Account {
  id: string
  name: string
  nick?: string
  uin?: number
  platform?: string
  running?: boolean
  ownerUserId?: number
  ownerUsername?: string
  belongsToCurrentUser?: boolean
  visibleStatus?: 'running' | 'error' | 'stopped'
  hasError?: boolean
}

export interface AccountStats {
  total: number
  running: number
  error: number
}

export interface AccountLog {
  time: string
  action: string
  msg: string
  reason?: string
}

export function getPlatformLabel(p?: string) {
  if (p === 'qq')
    return 'QQ'
  if (p === 'wx')
    return '微信'
  return ''
}

export function getPlatformClass(p?: string) {
  if (p === 'qq')
    return 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
  if (p === 'wx')
    return 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
  return ''
}

export const useAccountStore = defineStore('account', () => {
  const accounts = ref<Account[]>([])
  const currentAccountId = useStorage('current_account_id', '')
  const loading = ref(false)
  const logs = ref<AccountLog[]>([])
  const stats = ref<AccountStats>({
    total: 0,
    running: 0,
    error: 0,
  })

  const currentAccount = computed(() =>
    accounts.value.find((a: Account) => String(a.id) === currentAccountId.value),
  )

  const runningAccounts = computed(() =>
    accounts.value.filter((account: Account) => account.visibleStatus === 'running'),
  )

  const errorAccounts = computed(() =>
    accounts.value.filter((account: Account) => account.visibleStatus === 'error'),
  )

  async function fetchAccounts() {
    loading.value = true
    try {
      const res = await api.get('/api/accounts')
      if (res.data.ok && res.data.data && res.data.data.accounts) {
        accounts.value = Array.isArray(res.data.data.accounts) ? res.data.data.accounts : []
        stats.value = {
          total: Number(res.data.data?.stats?.total) || accounts.value.length,
          running: Number(res.data.data?.stats?.running) || 0,
          error: Number(res.data.data?.stats?.error) || 0,
        }

        if (accounts.value.length > 0) {
          const found = accounts.value.find((a: Account) => String(a.id) === currentAccountId.value)
          if (!found && accounts.value[0]) {
            currentAccountId.value = String(accounts.value[0].id)
          }
        }
        else {
          currentAccountId.value = ''
        }
      }
      else {
        accounts.value = []
        stats.value = { total: 0, running: 0, error: 0 }
      }
    }
    catch (e) {
      console.error('获取账号失败', e)
    }
    finally {
      loading.value = false
    }
  }

  function selectAccount(id: string) {
    currentAccountId.value = id
  }

  function setCurrentAccount(acc: Account) {
    selectAccount(acc.id)
  }

  async function startAccount(id: string) {
    await api.post(`/api/accounts/${id}/start`)
    await fetchAccounts()
  }

  async function stopAccount(id: string) {
    await api.post(`/api/accounts/${id}/stop`)
    await fetchAccounts()
  }

  async function deleteAccount(id: string) {
    await api.delete(`/api/accounts/${id}`)
    if (currentAccountId.value === id) {
      currentAccountId.value = ''
    }
    await fetchAccounts()
  }

  async function fetchLogs() {
    try {
      const res = await api.get('/api/account-logs?limit=100')
      if (Array.isArray(res.data)) {
        logs.value = res.data
      }
    }
    catch (e) {
      console.error('获取账号日志失败', e)
    }
  }

  async function addAccount(payload: any) {
    try {
      await api.post('/api/accounts', payload)
      await fetchAccounts()
    }
    catch (e) {
      console.error('添加账号失败', e)
      throw e
    }
  }

  async function updateAccount(id: string, payload: any) {
    try {
      await api.post('/api/accounts', { ...payload, id })
      await fetchAccounts()
    }
    catch (e) {
      console.error('更新账号失败', e)
      throw e
    }
  }

  return {
    accounts,
    currentAccountId,
    currentAccount,
    loading,
    logs,
    stats,
    runningAccounts,
    errorAccounts,
    fetchAccounts,
    selectAccount,
    startAccount,
    stopAccount,
    deleteAccount,
    fetchLogs,
    addAccount,
    updateAccount,
    setCurrentAccount,
  }
})
