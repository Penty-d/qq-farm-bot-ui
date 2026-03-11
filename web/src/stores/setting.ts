import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export interface AutomationConfig {
  farm?: boolean
  farm_manage?: boolean
  farm_water?: boolean
  farm_weed?: boolean
  farm_bug?: boolean
  farm_push?: boolean
  land_upgrade?: boolean
  friend?: boolean
  task?: boolean
  sell?: boolean
  fertilizer?: string
  fertilizer_multi_season?: boolean
  fertilizer_land_types?: string[]
  friend_steal?: boolean
  friend_steal_blacklist?: number[]
  friend_help?: boolean
  friend_bad?: boolean
  open_server_gift?: boolean
}

export interface IntervalsConfig {
  farm?: number
  friend?: number
  farmMin?: number
  farmMax?: number
  friendMin?: number
  friendMax?: number
}

export interface FriendQuietHoursConfig {
  enabled?: boolean
  start?: string
  end?: string
}

export interface OfflineConfig {
  channel: string
  reloginUrlMode: string
  endpoint: string
  token: string
  title: string
  msg: string
  offlineDeleteSec: number
  offlineDeleteEnabled: boolean
  custom_headers?: string
  custom_body?: string
}

export interface UIConfig {
  theme?: string
}

export interface QrLoginConfig {
  apiDomain: string
}

export interface RuntimeClientDeviceInfo {
  sys_software: string
  network: string
  memory: string
  device_id: string
}

export interface RuntimeClientConfig {
  serverUrl: string
  clientVersion: string
  os: string
  device_info: RuntimeClientDeviceInfo
}

export interface BagSeed {
  seedId: number
  name: string
  count: number
  requiredLevel: number
  image: string
  plantSize: number
}
export interface SettingsState {
  plantingStrategy: string
  preferredSeedId: number
  bagSeedPriority: number[]
  intervals: IntervalsConfig
  friendQuietHours: FriendQuietHoursConfig
  automation: AutomationConfig
  ui: UIConfig
  offlineReminder: OfflineConfig
  qrLogin: QrLoginConfig
  runtimeClient: RuntimeClientConfig
}

export const useSettingStore = defineStore('setting', () => {
  const settings = ref<SettingsState>({
    plantingStrategy: 'preferred',
    preferredSeedId: 0,
    bagSeedPriority: [],
    intervals: {},
    friendQuietHours: { enabled: false, start: '23:00', end: '07:00' },
    automation: {},
    ui: {},
    offlineReminder: {
      channel: 'webhook',
      reloginUrlMode: 'none',
      endpoint: '',
      token: '',
      title: '账号下线提醒',
      msg: '账号下线',
      offlineDeleteSec: 1,
      offlineDeleteEnabled: false,
      custom_headers: '',
      custom_body: '',
    },
    qrLogin: {
      apiDomain: 'q.qq.com',
    },
    runtimeClient: {
      serverUrl: 'wss://gate-obt.nqf.qq.com/prod/ws',
      clientVersion: '1.6.2.18_20260227',
      os: 'iOS',
      device_info: {
        sys_software: 'iOS 26.2.1',
        network: 'wifi',
        memory: '7672',
        device_id: 'iPhone X<iPhone18,3>',
      },
    },
  })
  const loading = ref(false)

  async function fetchSettings(accountId: string) {
    if (!accountId)
      return
    loading.value = true
    try {
      const { data } = await api.get('/api/settings', {
        headers: { 'x-account-id': accountId },
      })
      if (data && data.ok && data.data) {
        const d = data.data
        settings.value.plantingStrategy = d.strategy || 'preferred'
        settings.value.preferredSeedId = d.preferredSeed || 0
        settings.value.bagSeedPriority = Array.isArray(d.bagSeedPriority) ? d.bagSeedPriority : []
        settings.value.intervals = d.intervals || {}
        settings.value.friendQuietHours = d.friendQuietHours || { enabled: false, start: '23:00', end: '07:00' }
        settings.value.automation = d.automation || {}
        settings.value.ui = d.ui || {}
        settings.value.offlineReminder = {
          channel: 'webhook',
          reloginUrlMode: 'none',
          endpoint: '',
          token: '',
          title: '账号下线提醒',
          msg: '账号下线',
          offlineDeleteSec: 1,
          offlineDeleteEnabled: false,
          custom_headers: '',
          custom_body: '',
          ...(d.offlineReminder || {}),
        }
        settings.value.qrLogin = d.qrLogin || {
          apiDomain: 'q.qq.com',
        }
        settings.value.runtimeClient = d.runtimeClient || {
          serverUrl: 'wss://gate-obt.nqf.qq.com/prod/ws',
          clientVersion: '1.6.2.18_20260227',
          os: 'iOS',
          device_info: {
            sys_software: 'iOS 26.2.1',
            network: 'wifi',
            memory: '7672',
            device_id: 'iPhone X<iPhone18,3>',
          },
        }
      }
    }
    finally {
      loading.value = false
    }
  }

  async function saveSettings(accountId: string, newSettings: any) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    loading.value = true
    try {
      // 1. Save general settings
      const settingsPayload = {
        plantingStrategy: newSettings.plantingStrategy,
        preferredSeedId: newSettings.preferredSeedId,
        bagSeedPriority: newSettings.bagSeedPriority,
        intervals: newSettings.intervals,
        friendQuietHours: newSettings.friendQuietHours,
      }

      await api.post('/api/settings/save', settingsPayload, {
        headers: { 'x-account-id': accountId },
      })

      // 2. Save automation settings
      if (newSettings.automation) {
        await api.post('/api/automation', newSettings.automation, {
          headers: { 'x-account-id': accountId },
        })
      }

      // Refresh settings
      await fetchSettings(accountId)
      return { ok: true }
    }
    finally {
      loading.value = false
    }
  }

  async function saveOfflineConfig(config: OfflineConfig) {
    loading.value = true
    try {
      const { data } = await api.post('/api/settings/offline-reminder', config)
      if (data && data.ok) {
        settings.value.offlineReminder = config
        return { ok: true }
      }
      return { ok: false, error: '保存失败' }
    }
    finally {
      loading.value = false
    }
  }

  async function saveQrLoginConfig(config: QrLoginConfig) {
    loading.value = true
    try {
      const { data } = await api.post('/api/settings/qr-login', config)
      if (data && data.ok) {
        settings.value.qrLogin = data.data || config
        return { ok: true }
      }
      return { ok: false, error: '保存失败' }
    }
    finally {
      loading.value = false
    }
  }
  async function saveRuntimeClientConfig(config: RuntimeClientConfig) {
    loading.value = true
    try {
      const { data } = await api.post('/api/settings/runtime-client', config)
      if (data && data.ok) {
        const saved = (data.data && data.data.runtimeClient) ? data.data.runtimeClient : config
        settings.value.runtimeClient = saved
        return { ok: true }
      }
      return { ok: false, error: '保存失败' }
    }
    finally {
      loading.value = false
    }
  }

  async function changeAdminPassword(oldPassword: string, newPassword: string) {
    loading.value = true
    try {
      const res = await api.post('/api/admin/change-password', { oldPassword, newPassword })
      return res.data
    }
    finally {
      loading.value = false
    }
  }

  return { settings, loading, fetchSettings, saveSettings, saveOfflineConfig, saveQrLoginConfig, saveRuntimeClientConfig, changeAdminPassword }
})
