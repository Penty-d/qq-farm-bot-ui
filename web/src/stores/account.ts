import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'

export interface Account {
  id: string
  name: string
  nick?: string
  avatar?: string
  qq?: string | number
  uin?: number
  platform?: string
  running?: boolean
  // Add other fields as discovered
}

export function isGenericAccountName(name?: string, account?: Partial<Account>) {
  const text = String(name || '').trim()
  if (!text)
    return true
  if (/^账号\d+$/.test(text))
    return true
  const accountId = String(account?.id || '').trim()
  if (accountId && text === accountId)
    return true
  const uin = String(account?.uin || account?.qq || '').trim()
  if (uin && text === uin)
    return true
  return false
}

export function getAccountAvatar(account?: Partial<Account>) {
  const direct = String(account?.avatar || '').trim()
  if (direct)
    return direct
  const uin = String(account?.uin || account?.qq || '').trim()
  if (uin)
    return `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100`
  return ''
}

export function getAccountDisplayName(account?: Partial<Account>, liveName?: string) {
  const live = String(liveName || '').trim()
  const name = String(account?.name || '').trim()
  const nick = String(account?.nick || '').trim()
  const fallback = String(account?.uin || account?.id || '').trim()

  if (live && live !== '未登录') {
    if (name && !isGenericAccountName(name, account) && name !== live)
      return `${live} (${name})`
    return live
  }

  if (name && !isGenericAccountName(name, account)) {
    if (nick && nick !== name)
      return `${nick} (${name})`
    return name
  }

  if (nick)
    return nick

  return fallback || '未命名账号'
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

  const currentAccount = computed(() =>
    accounts.value.find(a => String(a.id) === currentAccountId.value),
  )

  async function fetchAccounts() {
    loading.value = true
    try {
      // api interceptor adds x-admin-token
      const res = await api.get('/api/accounts')
      if (res.data.ok && res.data.data && res.data.data.accounts) {
        accounts.value = res.data.data.accounts

        // Auto-select first account if none selected or selected not found
        if (accounts.value.length > 0) {
          const found = accounts.value.find(a => String(a.id) === currentAccountId.value)
          if (!found && accounts.value[0]) {
            currentAccountId.value = String(accounts.value[0].id)
          }
        }
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
      // core uses POST /api/accounts for both add and update (if id is present)
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
