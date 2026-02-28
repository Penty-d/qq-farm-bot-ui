import type { Socket } from 'socket.io-client'
import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { io } from 'socket.io-client'
import { ref } from 'vue'
import api from '@/api'

// Define interfaces for better type checking
interface DailyGift {
  key: string
  label: string
  enabled?: boolean
  doneToday: boolean
  lastAt?: number
  completedCount?: number
  totalCount?: number
  tasks?: any[]
}

interface DailyGiftsResponse {
  date: string
  growth: DailyGift
  gifts: DailyGift[]
}

export const useStatusStore = defineStore('status', () => {
  const status = ref<any>(null)
  const logs = ref<any[]>([])
  const accountLogs = ref<any[]>([])
  const dailyGifts = ref<DailyGiftsResponse | null>(null)
  const loading = ref(false)
  const error = ref('')
  const realtimeConnected = ref(false)
  const realtimeLogsEnabled = ref(true)
  const currentRealtimeAccountId = ref('')
  const tokenRef = useStorage('admin_token', '')

  let socket: Socket | null = null

  function normalizeStatusPayload(input: any) {
    return (input && typeof input === 'object') ? { ...input } : {}
  }

  function normalizeLogEntry(input: any) {
    const entry = (input && typeof input === 'object') ? { ...input } : {}
    const ts = Number(entry.ts) || Date.parse(String(entry.time || '')) || Date.now()
    return {
      ...entry,
      ts,
      time: entry.time || new Date(ts).toISOString().replace('T', ' ').slice(0, 19),
    }
  }

  function pushRealtimeLog(entry: any) {
    const next = normalizeLogEntry(entry)
    logs.value.push(next)
    if (logs.value.length > 1000)
      logs.value = logs.value.slice(-1000)
  }

  function pushRealtimeAccountLog(entry: any) {
    const next = (entry && typeof entry === 'object') ? entry : {}
    accountLogs.value.push(next)
    if (accountLogs.value.length > 300)
      accountLogs.value = accountLogs.value.slice(-300)
  }

  function handleRealtimeStatus(payload: any) {
    const body = (payload && typeof payload === 'object') ? payload : {}
    const accountId = String(body.accountId || '')
    if (currentRealtimeAccountId.value && accountId !== currentRealtimeAccountId.value)
      return
    if (body.status && typeof body.status === 'object') {
      status.value = normalizeStatusPayload(body.status)
      error.value = ''
    }
  }

  function handleRealtimeLog(payload: any) {
    if (!realtimeLogsEnabled.value)
      return
    pushRealtimeLog(payload)
  }

  function handleRealtimeAccountLog(payload: any) {
    pushRealtimeAccountLog(payload)
  }

  function handleRealtimeLogsSnapshot(payload: any) {
    const body = (payload && typeof payload === 'object') ? payload : {}
    const list = Array.isArray(body.logs) ? body.logs : []
    logs.value = list.map((item: any) => normalizeLogEntry(item))
  }

  function handleRealtimeAccountLogsSnapshot(payload: any) {
    const body = (payload && typeof payload === 'object') ? payload : {}
    const list = Array.isArray(body.logs) ? body.logs : []
    accountLogs.value = list
  }

  function ensureRealtimeSocket() {
    if (socket)
      return socket

    socket = io('/', {
      path: '/socket.io',
      autoConnect: false,
      transports: ['websocket'],
      auth: {
        token: tokenRef.value,
      },
    })

    socket.on('connect', () => {
      realtimeConnected.value = true
      if (currentRealtimeAccountId.value) {
        socket?.emit('subscribe', { accountId: currentRealtimeAccountId.value })
      }
      else {
        socket?.emit('subscribe', { accountId: 'all' })
      }
    })

    socket.on('disconnect', () => {
      realtimeConnected.value = false
    })

    socket.on('connect_error', (err) => {
      realtimeConnected.value = false
      console.error('[realtime] 连接失败:', err.message)
    })

    socket.on('status:update', handleRealtimeStatus)
    socket.on('log:new', handleRealtimeLog)
    socket.on('account-log:new', handleRealtimeAccountLog)
    socket.on('logs:snapshot', handleRealtimeLogsSnapshot)
    socket.on('account-logs:snapshot', handleRealtimeAccountLogsSnapshot)
    return socket
  }

  function connectRealtime(accountId: string) {
    currentRealtimeAccountId.value = String(accountId || '').trim()
    if (!tokenRef.value)
      return

    const client = ensureRealtimeSocket()
    client.auth = {
      token: tokenRef.value,
      accountId: currentRealtimeAccountId.value || 'all',
    }

    if (client.connected) {
      client.emit('subscribe', { accountId: currentRealtimeAccountId.value || 'all' })
      return
    }
    client.connect()
  }

  function disconnectRealtime() {
    if (!socket)
      return
    socket.off('connect')
    socket.off('disconnect')
    socket.off('connect_error')
    socket.off('status:update', handleRealtimeStatus)
    socket.off('log:new', handleRealtimeLog)
    socket.off('account-log:new', handleRealtimeAccountLog)
    socket.off('logs:snapshot', handleRealtimeLogsSnapshot)
    socket.off('account-logs:snapshot', handleRealtimeAccountLogsSnapshot)
    socket.disconnect()
    socket = null
    realtimeConnected.value = false
  }

  async function fetchStatus(accountId: string) {
    if (!accountId)
      return
    loading.value = true
    try {
      const { data } = await api.get('/api/status', {
        headers: { 'x-account-id': accountId },
      })
      if (data.ok) {
        status.value = normalizeStatusPayload(data.data)
        error.value = ''
      }
      else {
        error.value = data.error
      }
    }
    catch (e: any) {
      error.value = e.message
    }
    finally {
      loading.value = false
    }
  }

  async function fetchLogs(accountId: string, options: any = {}) {
    if (!accountId && options.accountId !== 'all')
      return
    const params: any = { limit: 100, ...options }
    const headers: any = {}
    if (accountId && accountId !== 'all') {
      headers['x-account-id'] = accountId
    }
    else {
      params.accountId = 'all'
    }

    try {
      const { data } = await api.get('/api/logs', { headers, params })
      if (data.ok) {
        logs.value = data.data
        error.value = ''
      }
    }
    catch (e: any) {
      console.error(e)
    }
  }

  async function fetchDailyGifts(accountId: string) {
    if (!accountId)
      return
    try {
      const { data } = await api.get('/api/daily-gifts', {
        headers: { 'x-account-id': accountId },
      })
      if (data.ok) {
        dailyGifts.value = data.data
      }
    }
    catch (e) {
      console.error('获取每日奖励失败', e)
    }
  }

  async function fetchAccountLogs(limit = 100) {
    try {
      const res = await api.get(`/api/account-logs?limit=${Math.max(1, Number(limit) || 100)}`)
      if (Array.isArray(res.data)) {
        accountLogs.value = res.data
      }
    }
    catch (e) {
      console.error(e)
    }
  }

  function setRealtimeLogsEnabled(enabled: boolean) {
    realtimeLogsEnabled.value = !!enabled
  }

  return {
    status,
    logs,
    accountLogs,
    dailyGifts,
    loading,
    error,
    realtimeConnected,
    realtimeLogsEnabled,
    fetchStatus,
    fetchLogs,
    fetchAccountLogs,
    fetchDailyGifts,
    setRealtimeLogsEnabled,
    connectRealtime,
    disconnectRealtime,
  }
})
