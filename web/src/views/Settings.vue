<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch, watchEffect } from 'vue'
import api from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import { useAccountStore } from '@/stores/account'
import { useFarmStore } from '@/stores/farm'
import { useSettingStore } from '@/stores/setting'

const settingStore = useSettingStore()
const accountStore = useAccountStore()
const farmStore = useFarmStore()

const { settings, loading } = storeToRefs(settingStore)
const { currentAccountId, accounts } = storeToRefs(accountStore)
const { seeds } = storeToRefs(farmStore)

const saving = ref(false)
const passwordSaving = ref(false)
const offlineSaving = ref(false)
const offlineTesting = ref(false)
const qrSaving = ref(false)

const modalVisible = ref(false)
const modalConfig = ref({
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  isAlert: true,
})

function showAlert(message: string, type: 'primary' | 'danger' = 'primary') {
  modalConfig.value = {
    title: type === 'danger' ? '错误' : '提示',
    message,
    type,
    isAlert: true,
  }
  modalVisible.value = true
}

const currentAccountName = computed(() => {
  const acc = accounts.value.find((a: any) => a.id === currentAccountId.value)
  return acc ? (acc.name || acc.nick || acc.id) : null
})
const allFertilizerLandTypes = ['gold', 'black', 'red', 'normal']

const fertilizerLandTypeOptions = [
  { label: '金土地', value: 'gold' },
  { label: '黑土地', value: 'black' },
  { label: '红土地', value: 'red' },
  { label: '普通土地', value: 'normal' },
]

function normalizeFertilizerLandTypes(input: unknown) {
  const source = Array.isArray(input) ? input : allFertilizerLandTypes
  const normalized: string[] = []
  for (const item of source) {
    const value = String(item || '').trim().toLowerCase()
    if (!allFertilizerLandTypes.includes(value))
      continue
    if (normalized.includes(value))
      continue
    normalized.push(value)
  }
  return normalized
}

function normalizeStealPlantBlacklist(input: unknown) {
  const source = Array.isArray(input) ? input : []
  const normalized: number[] = []
  for (const item of source) {
    const value = Number.parseInt(String(item), 10)
    if (!Number.isFinite(value) || value <= 0)
      continue
    if (normalized.includes(value))
      continue
    normalized.push(value)
  }
  return normalized
}

const localSettings = ref({
  plantingStrategy: 'preferred',
  preferredSeedId: 0,
  intervals: { farmMin: 2, farmMax: 2, friendMin: 10, friendMax: 10 },
  friendQuietHours: { enabled: false, start: '23:00', end: '07:00' },
  automation: {
    farm: false,
    farm_manage: false,
    farm_water: false,
    farm_weed: false,
    farm_bug: false,
    task: false,
    sell: false,
    friend: false,
    farm_push: false,
    land_upgrade: false,
    friend_steal: false,
    friend_steal_blacklist: [] as number[],
    friend_help: false,
    friend_bad: false,
    friend_help_exp_limit: false,
    email: false,
    fertilizer_gift: false,
    fertilizer_buy: false,
    free_gifts: false,
    share_reward: false,
    vip_gift: false,
    month_card: false,
    open_server_gift: false,
    fertilizer: 'none',
    fertilizer_multi_season: false,
    fertilizer_land_types: [...allFertilizerLandTypes],
  },
})

const friendDisabled = computed(() => !localSettings.value.automation.friend)
const farmDisabled = computed(() => !localSettings.value.automation.farm_manage)

interface StealCropOption {
  plantId: number
  seedId: number | null
  name: string
  level: number | null
  image: string
}

interface AnalyticsCropMeta {
  plantId: number
  seedId: number | null
  name: string
  level: number | null
  image: string
}

const analyticsCropMetas = ref<AnalyticsCropMeta[]>([])
const stealBlacklistCollapsed = ref(true)

function parsePositiveInt(input: unknown): number | null {
  const value = Number.parseInt(String(input ?? ''), 10)
  if (!Number.isFinite(value) || value <= 0)
    return null
  return value
}

function resolveStealCropLevel(seed: any): number | null {
  const candidates = [
    seed?.requiredLevel,
    seed?.landLevelNeed,
    seed?.land_level_need,
    seed?.unlockLevel,
    seed?.levelNeed,
  ]

  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value) && value > 0)
      return value
  }

  return null
}

function resolveStealCropImage(seed: any): string {
  const candidates = [
    seed?.image,
    seed?.seedImage,
    seed?.itemImage,
    seed?.icon,
    seed?.iconUrl,
  ]

  for (const candidate of candidates) {
    const value = String(candidate || '').trim()
    if (value)
      return value
  }

  return ''
}

function normalizeAnalyticsCropLevel(input: unknown): number | null {
  const value = Number(input)
  if (!Number.isFinite(value) || value <= 0)
    return null
  return value
}

async function loadStealBlacklistAnalytics() {
  try {
    const res = await api.get('/api/analytics', {
      params: { sort: 'level' },
    })
    const data = res?.data?.ok ? (res.data.data || []) : []
    if (!Array.isArray(data)) {
      analyticsCropMetas.value = []
      return
    }

    const parsed: AnalyticsCropMeta[] = []
    for (const item of data) {
      const plantId = parsePositiveInt(item?.id ?? item?.plantId)
      if (plantId === null)
        continue
      parsed.push({
        plantId,
        seedId: parsePositiveInt(item?.seedId),
        name: String(item?.name || ''),
        level: normalizeAnalyticsCropLevel(item?.level),
        image: String(item?.image || '').trim(),
      })
    }
    analyticsCropMetas.value = parsed
  }
  catch {
    analyticsCropMetas.value = []
  }
}

const analyticsCropMetaByPlantId = computed(() => {
  const byPlantId = new Map<number, AnalyticsCropMeta>()
  for (const item of analyticsCropMetas.value) {
    const current = byPlantId.get(item.plantId)
    if (!current) {
      byPlantId.set(item.plantId, { ...item })
      continue
    }
    if (current.seedId === null && item.seedId !== null)
      current.seedId = item.seedId
    if (current.level === null && item.level !== null)
      current.level = item.level
    if (!current.image && item.image)
      current.image = item.image
    if (!current.name && item.name)
      current.name = item.name
  }
  return byPlantId
})

const stealCropOptions = computed<StealCropOption[]>(() => {
  const source = Array.isArray(seeds.value) ? seeds.value : []
  const byPlantId = new Map<number, StealCropOption>()
  const isPlaceholderName = (name: string, plantId: number) => {
    const normalized = String(name || '').trim()
    return !normalized || normalized === `作物#${plantId}` || normalized === `浣滅墿#${plantId}`
  }

  // 先用分析数据作为全量基准，避免登录后只显示商店返回的子集
  for (const meta of analyticsCropMetas.value) {
    const plantId = parsePositiveInt(meta?.plantId)
    if (plantId === null)
      continue

    byPlantId.set(plantId, {
      plantId,
      seedId: parsePositiveInt(meta?.seedId),
      name: String(meta?.name || `作物#${plantId}`),
      level: normalizeAnalyticsCropLevel(meta?.level),
      image: String(meta?.image || '').trim(),
    })
  }

  for (const seed of source) {
    const plantId = parsePositiveInt(seed?.plantId)
    if (plantId === null)
      continue

    const analyticsMeta = analyticsCropMetaByPlantId.value.get(plantId)
    const seedIdFromSeed = parsePositiveInt(seed?.seedId ?? seed?.seed_id ?? seed?.itemId)
    const next: StealCropOption = {
      plantId,
      seedId: seedIdFromSeed ?? analyticsMeta?.seedId ?? null,
      name: String(seed?.name || analyticsMeta?.name || `作物#${plantId}`),
      level: analyticsMeta?.level ?? resolveStealCropLevel(seed),
      image: resolveStealCropImage(seed) || String(analyticsMeta?.image || '').trim(),
    }

    const current = byPlantId.get(plantId)
    if (!current) {
      byPlantId.set(plantId, next)
      continue
    }

    if (current.seedId === null && next.seedId !== null)
      current.seedId = next.seedId
    if (!current.image && next.image)
      current.image = next.image
    if (current.level === null && next.level !== null)
      current.level = next.level
    if (isPlaceholderName(current.name, current.plantId) && next.name)
      current.name = next.name
  }

  return Array.from(byPlantId.values()).sort((a, b) => {
    const aLevel = a.level === null ? Number.POSITIVE_INFINITY : a.level
    const bLevel = b.level === null ? Number.POSITIVE_INFINITY : b.level
    if (aLevel !== bLevel)
      return aLevel - bLevel

    const aSeedId = a.seedId === null ? Number.POSITIVE_INFINITY : a.seedId
    const bSeedId = b.seedId === null ? Number.POSITIVE_INFINITY : b.seedId
    if (aSeedId !== bSeedId)
      return aSeedId - bSeedId

    return a.plantId - b.plantId
  })
})
const stealBlacklistCount = computed(() => normalizeStealPlantBlacklist(localSettings.value.automation.friend_steal_blacklist).length)
const localOffline = ref({
  channel: 'webhook',
  reloginUrlMode: 'none',
  endpoint: '',
  token: '',
  title: '',
  msg: '',
  offlineDeleteSec: 1,
  offlineDeleteEnabled: false,
  custom_headers: '',
  custom_body: '',
})

const localQrLogin = ref({
  apiDomain: 'q.qq.com',
})

const passwordForm = ref({
  old: '',
  new: '',
  confirm: '',
})

function syncLocalSettings() {
  if (settings.value) {
    localSettings.value = JSON.parse(JSON.stringify({
      plantingStrategy: settings.value.plantingStrategy,
      preferredSeedId: settings.value.preferredSeedId,
      intervals: settings.value.intervals,
      friendQuietHours: settings.value.friendQuietHours,
      automation: settings.value.automation,
    }))

    // Default automation values if missing
    if (!localSettings.value.automation) {
      localSettings.value.automation = {
        farm: false,
        farm_manage: false,
        farm_water: false,
        farm_weed: false,
        farm_bug: false,
        task: false,
        sell: false,
        friend: false,
        farm_push: false,
        land_upgrade: false,
        friend_steal: false,
        friend_steal_blacklist: [] as number[],
        friend_help: false,
        friend_bad: false,
        friend_help_exp_limit: false,
        email: false,
        fertilizer_gift: false,
        fertilizer_buy: false,
        free_gifts: false,
        share_reward: false,
        vip_gift: false,
        month_card: false,
        open_server_gift: false,
        fertilizer: 'none',
        fertilizer_multi_season: false,
        fertilizer_land_types: [...allFertilizerLandTypes],
      }
    }
    else {
      // Merge with defaults to ensure all keys exist
      const defaults = {
        farm: false,
        farm_manage: false,
        farm_water: false,
        farm_weed: false,
        farm_bug: false,
        task: false,
        sell: false,
        friend: false,
        farm_push: false,
        land_upgrade: false,
        friend_steal: false,
        friend_steal_blacklist: [] as number[],
        friend_help: false,
        friend_bad: false,
        friend_help_exp_limit: false,
        email: false,
        fertilizer_gift: false,
        fertilizer_buy: false,
        free_gifts: false,
        share_reward: false,
        vip_gift: false,
        month_card: false,
        open_server_gift: false,
        fertilizer: 'none',
        fertilizer_multi_season: false,
        fertilizer_land_types: [...allFertilizerLandTypes],
      }
      localSettings.value.automation = {
        ...defaults,
        ...localSettings.value.automation,
      }
    }

    localSettings.value.automation.fertilizer_land_types = normalizeFertilizerLandTypes(localSettings.value.automation.fertilizer_land_types)
    localSettings.value.automation.friend_steal_blacklist = normalizeStealPlantBlacklist(localSettings.value.automation.friend_steal_blacklist)

    // Sync offline settings (global)
    if (settings.value.offlineReminder) {
      localOffline.value = {
        ...localOffline.value,
        ...JSON.parse(JSON.stringify(settings.value.offlineReminder)),
      }
    }
    localOffline.value.offlineDeleteSec = Math.max(1, Number.parseInt(String(localOffline.value.offlineDeleteSec), 10) || 1)
    localOffline.value.offlineDeleteEnabled = !!localOffline.value.offlineDeleteEnabled
    if (settings.value.qrLogin) {
      localQrLogin.value = JSON.parse(JSON.stringify(settings.value.qrLogin))
    }
  }
}

async function loadData() {
  if (currentAccountId.value) {
    await settingStore.fetchSettings(currentAccountId.value)
    syncLocalSettings()
    // Always fetch seeds to ensure correct locked status for current account
    await Promise.all([
      farmStore.fetchSeeds(currentAccountId.value),
      loadStealBlacklistAnalytics(),
    ])
  }
}

onMounted(() => {
  loadData()
})

watch(currentAccountId, () => {
  loadData()
})

const fertilizerOptions = [
  { label: '普通 + 有机', value: 'both' },
  { label: '仅普通化肥', value: 'normal' },
  { label: '仅有机化肥', value: 'organic' },
  { label: '不施肥', value: 'none' },
]

const plantingStrategyOptions = [
  { label: '优先种植种子', value: 'preferred' },
  { label: '最高等级作物', value: 'level' },
  { label: '最大经验/时', value: 'max_exp' },
  { label: '最大普通肥经验/时', value: 'max_fert_exp' },
  { label: '最大净利润/时', value: 'max_profit' },
  { label: '最大普通肥净利润/时', value: 'max_fert_profit' },
]

const channelOptions = [
  { label: 'Webhook(自定义接口)', value: 'webhook' },
  { label: '自定义 JSON (Webhook)', value: 'custom_request' },
  { label: 'Qmsg 酱', value: 'qmsg' },
  { label: 'Server 酱', value: 'serverchan' },
  { label: 'Push Plus', value: 'pushplus' },
  { label: 'Push Plus Hxtrip', value: 'pushplushxtrip' },
  { label: '钉钉', value: 'dingtalk' },
  { label: '企业微信', value: 'wecom' },
  { label: 'Bark', value: 'bark' },
  { label: 'Go-cqhttp', value: 'gocqhttp' },
  { label: 'OneBot', value: 'onebot' },
  { label: 'Atri', value: 'atri' },
  { label: 'PushDeer', value: 'pushdeer' },
  { label: 'iGot', value: 'igot' },
  { label: 'Telegram', value: 'telegram' },
  { label: '飞书', value: 'feishu' },
  { label: 'IFTTT', value: 'ifttt' },
  { label: '企业微信群机器人', value: 'wecombot' },
  { label: 'Discord', value: 'discord' },
  { label: 'WxPusher', value: 'wxpusher' },
]

const CHANNEL_DOCS: Record<string, string> = {
  webhook: '',
  custom_request: '',
  qmsg: 'https://qmsg.zendee.cn/',
  serverchan: 'https://sct.ftqq.com/',
  pushplus: 'https://www.pushplus.plus/',
  pushplushxtrip: 'https://pushplus.hxtrip.com/',
  dingtalk: 'https://open.dingtalk.com/document/group/custom-robot-access',
  wecom: 'https://guole.fun/posts/626/',
  wecombot: 'https://developer.work.weixin.qq.com/document/path/91770',
  bark: 'https://github.com/Finb/Bark',
  gocqhttp: 'https://docs.go-cqhttp.org/api/',
  onebot: 'https://docs.go-cqhttp.org/api/',
  atri: 'https://blog.tianli0.top/',
  pushdeer: 'https://www.pushdeer.com/',
  igot: 'https://push.hellyw.com/',
  telegram: 'https://core.telegram.org/bots',
  feishu: 'https://www.feishu.cn/hc/zh-CN/articles/360024984973',
  ifttt: 'https://ifttt.com/maker_webhooks',
  discord: 'https://discord.com/developers/docs/resources/webhook#execute-webhook',
  wxpusher: 'https://wxpusher.zjiecode.com/docs/#/',
}

const reloginUrlModeOptions = [
  { label: '不需要', value: 'none' },
  { label: '链接', value: 'qq_link' },
  { label: '二维码', value: 'qr_code' },
  { label: '二维码 + 链接', value: 'all' },
]

const currentChannelDocUrl = computed(() => {
  const key = String(localOffline.value.channel || '').trim().toLowerCase()
  return CHANNEL_DOCS[key] || ''
})

function openChannelDocs() {
  const url = currentChannelDocUrl.value
  if (!url)
    return
  window.open(url, '_blank', 'noopener,noreferrer')
}

const preferredSeedOptions = computed(() => {
  const options = [{ label: '自动选择', value: 0 }]
  if (seeds.value) {
    options.push(...seeds.value.map(seed => ({
      label: `${seed.requiredLevel}级 ${seed.name} (${seed.price}金)`,
      value: seed.seedId,
      disabled: seed.locked || seed.soldOut,
    })))
  }
  return options
})

const analyticsSortByMap: Record<string, string> = {
  max_exp: 'exp',
  max_fert_exp: 'fert',
  max_profit: 'profit',
  max_fert_profit: 'fert_profit',
}

const strategyPreviewLabel = ref<string | null>(null)

watchEffect(async () => {
  const strategy = localSettings.value.plantingStrategy
  if (strategy === 'preferred') {
    strategyPreviewLabel.value = null
    return
  }
  if (!seeds.value || seeds.value.length === 0) {
    strategyPreviewLabel.value = null
    return
  }
  const available = seeds.value.filter(s => !s.locked && !s.soldOut)
  if (available.length === 0) {
    strategyPreviewLabel.value = '暂无可用种子'
    return
  }
  if (strategy === 'level') {
    const best = [...available].sort((a, b) => b.requiredLevel - a.requiredLevel)[0]
    strategyPreviewLabel.value = best ? `${best.requiredLevel}级 ${best.name}` : null
    return
  }
  const sortBy = analyticsSortByMap[strategy]
  if (sortBy) {
    try {
      const res = await api.get(`/api/analytics?sort=${sortBy}`)
      const rankings: any[] = res.data.ok ? (res.data.data || []) : []
      const availableIds = new Set(available.map(s => s.seedId))
      const match = rankings.find(r => availableIds.has(Number(r.seedId)))
      if (match) {
        const seed = available.find(s => s.seedId === Number(match.seedId))
        strategyPreviewLabel.value = seed ? `${seed.requiredLevel}级 ${seed.name}` : null
      }
      else {
        strategyPreviewLabel.value = '暂无匹配种子'
      }
    }
    catch {
      strategyPreviewLabel.value = null
    }
  }
})

async function saveAccountSettings() {
  if (!currentAccountId.value)
    return

  localSettings.value.automation.fertilizer_land_types = normalizeFertilizerLandTypes(localSettings.value.automation.fertilizer_land_types)
  localSettings.value.automation.friend_steal_blacklist = normalizeStealPlantBlacklist(localSettings.value.automation.friend_steal_blacklist)

  saving.value = true
  try {
    const res = await settingStore.saveSettings(currentAccountId.value, localSettings.value)
    if (res.ok) {
      showAlert('账号设置已保存')
    }
    else {
      showAlert(`保存失败: ${res.error}`, 'danger')
    }
  }
  finally {
    saving.value = false
  }
}

async function handleChangePassword() {
  if (!passwordForm.value.old || !passwordForm.value.new) {
    showAlert('请填写完整', 'danger')
    return
  }
  if (passwordForm.value.new !== passwordForm.value.confirm) {
    showAlert('两次密码输入不一致', 'danger')
    return
  }
  if (passwordForm.value.new.length < 4) {
    showAlert('密码长度至少4位', 'danger')
    return
  }

  passwordSaving.value = true
  try {
    const res = await settingStore.changeAdminPassword(passwordForm.value.old, passwordForm.value.new)

    if (res.ok) {
      showAlert('密码修改成功')
      passwordForm.value = { old: '', new: '', confirm: '' }
    }
    else {
      showAlert(`修改失败: ${res.error || '未知错误'}`, 'danger')
    }
  }
  finally {
    passwordSaving.value = false
  }
}

async function handleSaveQrLogin() {
  qrSaving.value = true
  try {
    const res = await settingStore.saveQrLoginConfig(localQrLogin.value)
    if (res.ok) {
      showAlert('二维码接口设置已保存')
    }
    else {
      showAlert(`保存失败: ${res.error || '未知错误'}`, 'danger')
    }
  }
  finally {
    qrSaving.value = false
  }
}
async function handleSaveOffline() {
  localOffline.value.offlineDeleteSec = Math.max(1, Number.parseInt(String(localOffline.value.offlineDeleteSec), 10) || 1)
  localOffline.value.offlineDeleteEnabled = !!localOffline.value.offlineDeleteEnabled

  offlineSaving.value = true
  try {
    const res = await settingStore.saveOfflineConfig(localOffline.value)

    if (res.ok) {
      showAlert('下线提醒设置已保存')
    }
    else {
      showAlert(`保存失败: ${res.error || '未知错误'}`, 'danger')
    }
  }
  finally {
    offlineSaving.value = false
  }
}

async function handleTestOffline() {
  offlineTesting.value = true
  try {
    const { data } = await api.post('/api/settings/offline-reminder/test', localOffline.value)
    if (data?.ok) {
      showAlert('测试消息发送成功')
    }
    else {
      showAlert(`测试失败: ${data?.error || '未知错误'}`, 'danger')
    }
  }
  catch (e: any) {
    const msg = e?.response?.data?.error || e?.message || '请求失败'
    showAlert(`测试失败: ${msg}`, 'danger')
  }
  finally {
    offlineTesting.value = false
  }
}
</script>

<template>
  <div class="settings-page">
    <div v-if="loading" class="py-4 text-center text-gray-500">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl" />
      <p>加载中...</p>
    </div>

    <div v-else class="grid grid-cols-1 mt-12 gap-4 text-sm lg:grid-cols-2">
      <!-- Card 1: Strategy & Automation -->
      <div v-if="currentAccountId" class="card h-full flex flex-col rounded-lg bg-white shadow dark:bg-gray-800">
        <!-- Strategy Header -->
        <div class="border-b bg-gray-50/50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50">
          <h3 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
            <div class="i-fas-cogs" />
            策略设置
            <span v-if="currentAccountName" class="ml-2 text-sm text-gray-500 font-normal dark:text-gray-400">
              ({{ currentAccountName }})
            </span>
          </h3>
        </div>

        <!-- Strategy Content -->
        <div class="p-4 space-y-3">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <BaseSelect
              v-model="localSettings.plantingStrategy"
              label="种植策略"
              :options="plantingStrategyOptions"
            />
            <BaseSelect
              v-if="localSettings.plantingStrategy === 'preferred'"
              v-model="localSettings.preferredSeedId"
              label="优先种植种子"
              :options="preferredSeedOptions"
            />
            <!-- 预览区域：与 BaseSelect 同结构同样式，避免切换策略时布局跳动 -->
            <div v-else class="flex flex-col gap-1.5">
              <label class="text-sm text-gray-700 font-medium dark:text-gray-300">策略选种预览</label>
              <div
                class="w-full flex items-center justify-between border border-gray-200 rounded-lg bg-gray-50 px-3 py-2 text-gray-500 dark:border-gray-600 dark:bg-gray-800/50 dark:text-gray-400"
              >
                <span class="truncate">{{ strategyPreviewLabel ?? '加载中...' }}</span>
                <div class="i-carbon-chevron-down shrink-0 text-lg text-gray-400" />
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
            <BaseInput
              v-model.number="localSettings.intervals.farmMin"
              label="农场巡查最小 (秒)"
              type="number"
              min="1"
              max="86400"
            />
            <BaseInput
              v-model.number="localSettings.intervals.farmMax"
              label="农场巡查最大 (秒)"
              type="number"
              min="1"
              max="86400"
            />
            <BaseInput
              v-model.number="localSettings.intervals.friendMin"
              label="好友巡查最小 (秒)"
              type="number"
              min="1"
              max="86400"
            />
            <BaseInput
              v-model.number="localSettings.intervals.friendMax"
              label="好友巡查最大 (秒)"
              type="number"
              min="1"
              max="86400"
            />
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-4 border-t pt-3 dark:border-gray-700">
            <BaseSwitch
              v-model="localSettings.friendQuietHours.enabled"
              label="启用静默时段"
            />
            <div class="flex items-center gap-2">
              <BaseInput
                v-model="localSettings.friendQuietHours.start"
                type="time"
                class="w-24"
                :disabled="!localSettings.friendQuietHours.enabled"
              />
              <span class="text-gray-500">-</span>
              <BaseInput
                v-model="localSettings.friendQuietHours.end"
                type="time"
                class="w-24"
                :disabled="!localSettings.friendQuietHours.enabled"
              />
            </div>
          </div>
        </div>

        <!-- Auto Control Header -->
        <div class="border-b border-t bg-gray-50/50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50">
          <h3 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
            <div class="i-fas-toggle-on" />
            自动控制
          </h3>
        </div>

        <!-- Auto Control Content -->
        <div class="flex-1 p-4 space-y-4">
          <!-- Switches Grid -->
          <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
            <BaseSwitch v-model="localSettings.automation.farm" label="自动种植收获" />
            <BaseSwitch v-model="localSettings.automation.farm_manage" label="自动打理农场" />
            <BaseSwitch v-model="localSettings.automation.task" label="自动做任务" />
            <BaseSwitch v-model="localSettings.automation.sell" label="自动卖果实" />
            <BaseSwitch v-model="localSettings.automation.friend" label="自动好友互动" />
            <BaseSwitch v-model="localSettings.automation.farm_push" label="推送触发巡田" />
            <BaseSwitch v-model="localSettings.automation.land_upgrade" label="自动升级土地" />
            <BaseSwitch v-model="localSettings.automation.email" label="自动领取邮件" />
            <BaseSwitch v-model="localSettings.automation.free_gifts" label="自动商城礼包" />
            <BaseSwitch v-model="localSettings.automation.share_reward" label="自动分享奖励" />
            <BaseSwitch v-model="localSettings.automation.vip_gift" label="自动VIP礼包" />
            <BaseSwitch v-model="localSettings.automation.month_card" label="自动月卡奖励" />
            <BaseSwitch v-model="localSettings.automation.open_server_gift" label="自动开服红包" />
            <BaseSwitch v-model="localSettings.automation.fertilizer_gift" label="自动填充化肥" />
            <BaseSwitch v-model="localSettings.automation.fertilizer_buy" label="自动购买化肥" />
          </div>

          <!-- Sub-controls -->
          <div class="flex flex-wrap gap-4 rounded bg-emerald-50 p-2 text-sm dark:bg-emerald-900/20" :class="{ 'opacity-50 pointer-events-none': farmDisabled }">
            <BaseSwitch v-model="localSettings.automation.farm_water" label="自动浇水" :disabled="farmDisabled" />
            <BaseSwitch v-model="localSettings.automation.farm_bug" label="自动除虫" :disabled="farmDisabled" />
            <BaseSwitch v-model="localSettings.automation.farm_weed" label="自动除草" :disabled="farmDisabled" />
          </div>

          <div class="flex flex-wrap gap-4 rounded bg-blue-50 p-2 text-sm dark:bg-blue-900/20" :class="{ 'opacity-50 pointer-events-none': friendDisabled }">
            <BaseSwitch v-model="localSettings.automation.friend_steal" label="自动偷菜" :disabled="friendDisabled" />
            <BaseSwitch v-model="localSettings.automation.friend_help" label="自动帮忙" :disabled="friendDisabled" />
            <BaseSwitch v-model="localSettings.automation.friend_bad" label="自动捣乱" :disabled="friendDisabled" />
            <BaseSwitch v-model="localSettings.automation.friend_help_exp_limit" label="经验上限停止帮忙" :disabled="friendDisabled" />
          </div>
          <!-- Steal Crop Blacklist + Fertilizer -->
          <div class="space-y-3">

            <div class="border border-blue-200 rounded bg-blue-50/60 p-3 dark:border-blue-800/60 dark:bg-blue-900/10">
              <button
                class="mb-2 w-full flex items-center justify-between gap-2 text-left"
                type="button"
                @click="stealBlacklistCollapsed = !stealBlacklistCollapsed"
              >
                <div class="flex items-center gap-2">
                  <div
                    class="i-carbon-chevron-right text-sm text-blue-700 transition-transform duration-200 dark:text-blue-300"
                    :class="{ 'rotate-90': !stealBlacklistCollapsed }"
                  />
                  <div class="text-sm text-blue-800 font-medium dark:text-blue-300">
                    偷菜黑名单
                  </div>
                </div>
                <div class="text-xs text-blue-700/80 dark:text-blue-300/80">
                  已选 {{ stealBlacklistCount }} 项
                </div>
              </button>

              <template v-if="!stealBlacklistCollapsed">
                <div v-if="stealCropOptions.length > 0" class="grid grid-cols-1 max-h-56 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                  <label
                    v-for="crop in stealCropOptions"
                    :key="crop.plantId"
                    class="flex cursor-pointer items-center gap-2 rounded bg-white px-2 py-1.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  >
                    <input
                      v-model="localSettings.automation.friend_steal_blacklist"
                      :value="crop.plantId"
                      type="checkbox"
                      class="h-3.5 w-3.5"
                    >

                    <img
                      v-if="crop.image"
                      :src="crop.image"
                      :alt="crop.name"

                      class="h-5 w-5 rounded object-cover"
                    >
                    <div v-else class="h-5 w-5 flex items-center justify-center rounded bg-gray-100 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                      <div class="i-carbon-image" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-xs">{{ crop.name }}</div>
                      <div class="text-[11px] text-gray-500 dark:text-gray-400">
                        {{ crop.level === null ? 'Lv.?' : (`Lv.${crop.level}`) }} (#{{ crop.plantId }})
                      </div>
                    </div>
                  </label>
                </div>
                <div v-else class="rounded bg-white px-2 py-2 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  暂无可选作物，请先等待种子列表加载完成。
                </div>

                <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  好友巡查自动偷菜时，命中黑名单作物将自动跳过。
                </p>
              </template>

            </div>
            <div class="border border-amber-200 rounded bg-amber-50/60 p-3 dark:border-amber-800/60 dark:bg-amber-900/10">
              <div class="mb-2 text-sm text-amber-800 font-medium dark:text-amber-300">
                施肥范围
              </div>
              <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
                <label
                  v-for="option in fertilizerLandTypeOptions"
                  :key="option.value"
                  class="flex cursor-pointer items-center gap-1.5 rounded bg-white px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                >
                  <input
                    v-model="localSettings.automation.fertilizer_land_types"
                    :value="option.value"
                    type="checkbox"
                    class="h-3.5 w-3.5"
                  >
                  <span>{{ option.label }}</span>
                </label>
              </div>
              <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                施肥前会优先按土地类型过滤，仅对命中范围的地块执行施肥策略。
              </p>
            </div>
            <div class="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <BaseSelect
                v-model="localSettings.automation.fertilizer"
                label="施肥策略"
                class="w-full"
                :options="fertilizerOptions"
              />
              <BaseSwitch
                v-model="localSettings.automation.fertilizer_multi_season"
                label="多季补肥"
                class="md:mb-2"
              />
            </div>
          </div>
        </div>

        <!-- Save Button -->
        <div class="mt-auto flex justify-end border-t bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/50">
          <BaseButton
            variant="primary"
            size="sm"
            :loading="saving"
            @click="saveAccountSettings"
          >
            保存策略与自动控制
          </BaseButton>
        </div>
      </div>

      <div v-else class="card flex flex-col items-center justify-center gap-4 rounded-lg bg-white p-12 text-center shadow dark:bg-gray-800">
        <div class="rounded-full bg-gray-50 p-4 dark:bg-gray-700/50">
          <div class="i-carbon-settings-adjust text-4xl text-gray-400 dark:text-gray-500" />
        </div>
        <div class="max-w-xs">
          <h3 class="text-lg text-gray-900 font-medium dark:text-gray-100">
            需要登录账号
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            请先登录账号以配置策略和自动化选项。
          </p>
        </div>
      </div>

      <!-- Card 2: System Settings (Password & Offline) -->
      <div class="card h-full flex flex-col rounded-lg bg-white shadow dark:bg-gray-800">
        <!-- Password Header -->
        <div class="border-b bg-gray-50/50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50">
          <h3 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
            <div class="i-carbon-password" />
            管理密码
          </h3>
        </div>

        <!-- Password Content -->
        <div class="p-4 space-y-3">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
            <BaseInput
              v-model="passwordForm.old"
              label="当前密码"
              type="password"
              placeholder="当前管理密码"
            />
            <BaseInput
              v-model="passwordForm.new"
              label="新密码"
              type="password"
              placeholder="至少 4 位"
            />
            <BaseInput
              v-model="passwordForm.confirm"
              label="确认新密码"
              type="password"
              placeholder="再次输入新密码"
            />
          </div>

          <div class="flex items-center justify-between pt-1">
            <p class="text-xs text-gray-500">
              建议修改默认密码 (admin)
            </p>
            <BaseButton
              variant="primary"
              size="sm"
              :loading="passwordSaving"
              @click="handleChangePassword"
            >
              修改管理密码
            </BaseButton>
          </div>
        </div>

        <!-- QR Login Header -->
        <div class="border-b border-t bg-gray-50/50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50">
          <h3 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
            <div class="i-carbon-qr-code" />
            二维码登录接口
          </h3>
        </div>

        <!-- QR Login Content -->
        <div class="p-4 space-y-3">
          <BaseInput
            v-model="localQrLogin.apiDomain"
            label="二维码接口域名"
            type="text"
            placeholder="q.qq.com"
          />
          <p class="text-xs text-gray-500 dark:text-gray-400">
            仅影响后端调用二维码相关接口的域名，前端仍使用 /api/qr/create 与 /api/qr/check。
          </p>
          <div class="flex justify-end">
            <BaseButton
              variant="primary"
              size="sm"
              :loading="qrSaving"
              @click="handleSaveQrLogin"
            >
              保存二维码接口设置
            </BaseButton>
          </div>
        </div>
        <!-- Offline Header -->
        <div class="border-b border-t bg-gray-50/50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50">
          <h3 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
            <div class="i-carbon-notification" />
            下线提醒
          </h3>
        </div>

        <!-- Offline Content -->
        <div class="flex-1 p-4 space-y-3">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between">
                <span class="text-sm text-gray-700 font-medium dark:text-gray-300">推送渠道</span>
                <BaseButton
                  variant="text"
                  size="sm"
                  :disabled="!currentChannelDocUrl"
                  @click="openChannelDocs"
                >
                  官网
                </BaseButton>
              </div>
              <BaseSelect
                v-model="localOffline.channel"
                :options="channelOptions"
              />
            </div>
            <BaseSelect
              v-model="localOffline.reloginUrlMode"
              label="重登录链接"
              :options="reloginUrlModeOptions"
            />
          </div>

          <BaseInput
            v-model="localOffline.endpoint"
            label="接口地址"
            type="text"
            :disabled="localOffline.channel !== 'webhook' && localOffline.channel !== 'custom_request'"
          />

          <BaseInput
            v-model="localOffline.token"
            label="Token"
            type="text"
            placeholder="接收端 token"
          />

          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <BaseInput
              v-model="localOffline.title"
              label="标题"
              type="text"
              placeholder="提醒标题"
            />
            <div class="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <BaseInput
                v-model.number="localOffline.offlineDeleteSec"
                label="离线删除账号 (秒)"
                type="number"
                min="1"
                placeholder="默认 1"
              />
              <BaseSwitch
                v-model="localOffline.offlineDeleteEnabled"
                label="启用离线删号"
                class="md:mb-2"
              />
            </div>
          </div>

          <BaseInput
            v-model="localOffline.msg"
            label="内容"
            type="text"
            placeholder="提醒内容"
          />

          <template v-if="localOffline.channel === 'custom_request'">
            <BaseTextarea
              v-model="localOffline.custom_headers"
              label="Headers (严格 JSON)"
              placeholder="例如: {&quot;Content-Type&quot;: &quot;application/json&quot;, &quot;Authorization&quot;: &quot;Bearer TOKEN&quot;}"
            />
            <BaseTextarea
              v-model="localOffline.custom_body"
              label="Body (严格 JSON, 占位符支持 {{title}}（标题） {{content}}（内容）)"
              placeholder="例如: { &quot;title&quot;: &quot;{{title}}&quot;, &quot;message&quot;: &quot;{{content}}&quot; }"
            />
          </template>
        </div>

        <!-- Save Offline Button -->
        <div class="mt-auto flex justify-end gap-2 border-t bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/50">
          <BaseButton
            variant="secondary"
            size="sm"
            :loading="offlineTesting"
            :disabled="offlineSaving"
            @click="handleTestOffline"
          >
            测试通知
          </BaseButton>
          <BaseButton
            variant="primary"
            size="sm"
            :loading="offlineSaving"
            :disabled="offlineTesting"
            @click="handleSaveOffline"
          >
            保存下线提醒设置
          </BaseButton>
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="modalVisible"
      :title="modalConfig.title"
      :message="modalConfig.message"
      :type="modalConfig.type"
      :is-alert="modalConfig.isAlert"
      confirm-text="知道了"
      @confirm="modalVisible = false"
      @cancel="modalVisible = false"
    />
  </div>
</template>

<style scoped lang="postcss">
/* Custom styles if needed */
</style>
