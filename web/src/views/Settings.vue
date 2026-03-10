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
import { useToastStore } from '@/stores/toast'

const settingStore = useSettingStore()
const accountStore = useAccountStore()
const farmStore = useFarmStore()
const toast = useToastStore()

const { settings, loading } = storeToRefs(settingStore)
const { currentAccountId, accounts } = storeToRefs(accountStore)
const { seeds } = storeToRefs(farmStore)

const saving = ref(false)
const passwordSaving = ref(false)
const offlineSaving = ref(false)
const offlineTesting = ref(false)
const qrSaving = ref(false)

const token = computed(() => {
  return localStorage.getItem('admin_token') || '未登录'
})

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text).then(() => {
    toast.success('复制成功')
  }).catch(() => {
    toast.error('复制失败，请手动复制')
  })
}

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
  bagSeedPriority: [] as number[],
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
const stealBlacklistSearch = ref('')
const stealBlacklistCollapsed = ref(true)
const onlyShowUnselectedStealCrops = ref(false)

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
const stealBlacklistSet = computed(() => new Set(normalizeStealPlantBlacklist(localSettings.value.automation.friend_steal_blacklist)))

function isCropBlacklisted(plantId: number) {
  return stealBlacklistSet.value.has(plantId)
}

function toggleStealBlacklistCrop(plantId: number) {
  const current = normalizeStealPlantBlacklist(localSettings.value.automation.friend_steal_blacklist)
  if (current.includes(plantId)) {
    localSettings.value.automation.friend_steal_blacklist = current.filter(id => id !== plantId)
    return
  }
  localSettings.value.automation.friend_steal_blacklist = [...current, plantId]
}

const filteredStealCropOptions = computed(() => {
  const keyword = stealBlacklistSearch.value.trim().toLowerCase()

  return stealCropOptions.value.filter((crop) => {
    const byName = crop.name.toLowerCase().includes(keyword)
    const bySeedId = crop.seedId !== null && String(crop.seedId).includes(keyword)
    const keywordMatched = !keyword || byName || bySeedId
    const unselectedMatched = !onlyShowUnselectedStealCrops.value || !isCropBlacklisted(crop.plantId)
    return keywordMatched && unselectedMatched
  })
})

function filterUnselectedStealCrops() {
  onlyShowUnselectedStealCrops.value = !onlyShowUnselectedStealCrops.value
  if (onlyShowUnselectedStealCrops.value)
    stealBlacklistSearch.value = ''
}

function clearStealFilter() {
  onlyShowUnselectedStealCrops.value = false
  stealBlacklistSearch.value = ''
}
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
      bagSeedPriority: settings.value.bagSeedPriority || [],
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
  { label: '优先背包种子', value: 'bag_priority' },
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

interface BagSeedItem {
  seedId: number
  name: string
  count: number
  requiredLevel: number
  image: string
  plantSize: number
}

const bagSeeds = ref<BagSeedItem[]>([])
const bagSeedsLoading = ref(false)

async function fetchBagSeeds() {
  if (!currentAccountId.value) return
  bagSeedsLoading.value = true
  try {
    const { data } = await api.get('/api/bag/seeds', {
      headers: { 'x-account-id': currentAccountId.value },
    })
    if (data && data.ok && Array.isArray(data.data)) {
      bagSeeds.value = data.data
    }
  }
  catch {
    bagSeeds.value = []
  }
  finally {
    bagSeedsLoading.value = false
  }
}

const sortedBagSeeds = computed(() => {
  const priority = localSettings.value.bagSeedPriority || []
  const priorityMap = new Map<number, number>()
  priority.forEach((seedId, index) => {
    priorityMap.set(seedId, index)
  })

  return [...bagSeeds.value].sort((a, b) => {
    const pa = priorityMap.has(a.seedId) ? priorityMap.get(a.seedId)! : Number.MAX_SAFE_INTEGER
    const pb = priorityMap.has(b.seedId) ? priorityMap.get(b.seedId)! : Number.MAX_SAFE_INTEGER
    if (pa !== pb) return pa - pb
    return b.requiredLevel - a.requiredLevel
  })
})

function moveSeedUp(index: number) {
  if (index <= 0) return
  const seeds = sortedBagSeeds.value
  const newPriority: number[] = seeds.map(s => s.seedId)
  const a = newPriority[index]!
  const b = newPriority[index - 1]!
  newPriority[index] = b
  newPriority[index - 1] = a
  localSettings.value.bagSeedPriority = newPriority
}

function moveSeedDown(index: number) {
  const seeds = sortedBagSeeds.value
  if (index >= seeds.length - 1) return
  const newPriority: number[] = seeds.map(s => s.seedId)
  const a = newPriority[index]!
  const b = newPriority[index + 1]!
  newPriority[index] = b
  newPriority[index + 1] = a
  localSettings.value.bagSeedPriority = newPriority
}

function resetBagSeedPriority() {
  localSettings.value.bagSeedPriority = []
}

const dragIndex = ref<number | null>(null)

function onDragStart(e: DragEvent, index: number) {
  dragIndex.value = index
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
}

function onDrop(targetIndex: number) {
  if (dragIndex.value === null || dragIndex.value === targetIndex) {
    dragIndex.value = null
    return
  }

  const seeds = sortedBagSeeds.value
  const newPriority: number[] = seeds.map(s => s.seedId)
  const draggedId = newPriority[dragIndex.value]!

  newPriority.splice(dragIndex.value, 1)
  newPriority.splice(targetIndex, 0, draggedId)

  localSettings.value.bagSeedPriority = newPriority
  dragIndex.value = null
}

function onDragEnd() {
  dragIndex.value = null
}

watch(() => localSettings.value.plantingStrategy, (newVal) => {
  if (newVal === 'bag_priority') {
    fetchBagSeeds()
  }
}, { immediate: true })

const analyticsSortByMap: Record<string, string> = {
  max_exp: 'exp',
  max_fert_exp: 'fert',
  max_profit: 'profit',
  max_fert_profit: 'fert_profit',
}

const strategyPreviewLabel = ref<string | null>(null)

watchEffect(async () => {
  const strategy = localSettings.value.plantingStrategy
  if (strategy === 'preferred' || strategy === 'bag_priority') {
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
            <div v-else-if="localSettings.plantingStrategy !== 'bag_priority'" class="flex flex-col gap-1.5">
              <label class="text-sm text-gray-700 font-medium dark:text-gray-300">策略选种预览</label>
              <div
                class="w-full flex items-center justify-between border border-gray-200 rounded-lg bg-gray-50 px-3 py-2 text-gray-500 dark:border-gray-600 dark:bg-gray-800/50 dark:text-gray-400"
              >
                <span class="truncate">{{ strategyPreviewLabel ?? '加载中...' }}</span>
                <div class="i-carbon-chevron-down shrink-0 text-lg text-gray-400" />
              </div>
            </div>
          </div>

          <!-- 背包种子优先级列表 -->
          <div v-if="localSettings.plantingStrategy === 'bag_priority'" class="mt-3">
            <div class="flex items-center justify-between mb-2">
              <label class="text-sm text-gray-700 font-medium dark:text-gray-300">背包种子优先级</label>
              <div class="flex items-center gap-2">
                <button
                  class="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400"
                  @click="fetchBagSeeds"
                >
                  刷新
                </button>
                <button
                  class="text-xs text-gray-500 hover:text-gray-600 dark:text-gray-400"
                  @click="resetBagSeedPriority"
                >
                  重置排序
                </button>
              </div>
            </div>

            <div v-if="bagSeedsLoading" class="text-center py-4 text-gray-500">
              加载中...
            </div>
            <div v-else-if="sortedBagSeeds.length === 0" class="text-center py-4 text-gray-500 dark:text-gray-400">
              背包中暂无种子
            </div>
            <div v-else class="space-y-1 max-h-64 overflow-y-auto">
              <div
                v-for="(seed, index) in sortedBagSeeds"
                :key="seed.seedId"
                draggable="true"
                class="flex items-center gap-3 p-2 border rounded-lg cursor-grab select-none border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-800/50"
                @dragstart="onDragStart($event, index)"
                @dragover="onDragOver"
                @drop="onDrop(index)"
                @dragend="onDragEnd"
              >
                <div class="flex items-center gap-1 text-gray-400 dark:text-gray-500">
                  <div class="i-carbon-draggable text-lg" />
                  <span class="w-5 text-center text-sm font-medium">{{ index + 1 }}</span>
                </div>
                <img
                  v-if="seed.image"
                  :src="seed.image"
                  :alt="seed.name"
                  class="w-8 h-8 object-contain pointer-events-none"
                >
                <div v-else class="w-8 h-8 bg-gray-200 rounded dark:bg-gray-700 pointer-events-none" />
                <div class="flex-1 min-w-0 pointer-events-none">
                  <div class="flex items-center gap-2">
                    <span
                      v-if="seed.requiredLevel >= 200"
                      class="px-1.5 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded dark:bg-yellow-900/50 dark:text-yellow-400"
                    >活动</span>
                    <span class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{{ seed.name }}</span>
                  </div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">
                    数量: {{ seed.count }} | {{ seed.requiredLevel >= 200 ? '活动种子' : `${seed.requiredLevel}级` }}
                    <span v-if="seed.plantSize > 1"> | {{ seed.plantSize }}x{{ seed.plantSize }}</span>
                  </div>
                </div>
                <div class="flex flex-col gap-1">
                  <button
                    class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30"
                    :disabled="index === 0"
                    @click.stop="moveSeedUp(index)"
                  >
                    <div class="i-carbon-chevron-up" />
                  </button>
                  <button
                    class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30"
                    :disabled="index === sortedBagSeeds.length - 1"
                    @click.stop="moveSeedDown(index)"
                  >
                    <div class="i-carbon-chevron-down" />
                  </button>
                </div>
              </div>
            </div>
            <div class="mt-2 text-xs text-gray-500 dark:text-gray-400 space-y-1">
              <p>* 拖拽或点击箭头调整种植优先级</p>
              <p>* 仅支持 1x1 种子，2x2 及以上种子会被跳过</p>
              <p>* 1x1 种子用完后将自动切换为"最高等级"策略</p>
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
            <div class="border border-blue-200 rounded-lg bg-blue-50/70 p-3 text-gray-800 shadow-sm dark:border-blue-500/50 dark:bg-[#17243a] dark:text-white">
              <div class="mb-1 flex items-center justify-between gap-3">
                <div class="min-w-0 flex items-center gap-2">
                  <div class="h-9 w-9 flex items-center justify-center rounded-lg border border-blue-300/70 bg-white/90 dark:border-blue-500/40 dark:bg-blue-500/20">
                    <div class="i-carbon-filter text-xl text-blue-700 dark:text-blue-200" />
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <div class="truncate text-base font-semibold">
                        排除作物
                      </div>
                      <div class="rounded-full border border-blue-300 bg-white/95 px-2 py-0.5 text-xs text-blue-700 shadow-sm dark:border-blue-300/60 dark:bg-blue-500/15 dark:text-blue-100">
                        <span class="font-semibold">{{ stealBlacklistCount }} / {{ stealCropOptions.length }}</span>
                      </div>
                    </div>
                    <p class="text-xs text-blue-700/90 dark:text-blue-200/85">
                      勾选后，自动偷菜会跳过这些作物；
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  class="h-9 w-9 flex items-center justify-center rounded-lg border border-blue-300/70 bg-white/90 text-blue-700 transition hover:bg-blue-100 dark:border-blue-500/40 dark:bg-blue-500/20 dark:text-blue-100 dark:hover:bg-blue-500/30"
                  :aria-expanded="!stealBlacklistCollapsed"
                  @click="stealBlacklistCollapsed = !stealBlacklistCollapsed"
                >
                  <div
                    class="i-carbon-chevron-down text-lg transition-transform"
                    :class="stealBlacklistCollapsed ? '' : 'rotate-180'"
                  />
                </button>
              </div>

              <div v-if="!stealBlacklistCollapsed">
                <div class="my-2 border-t border-blue-200/80 dark:border-blue-400/30" />

                <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div class="text-xs text-blue-700/90 dark:text-blue-200/90">
                    支持按作物名或 seedid 搜索
                  </div>
                  <div class="flex items-center justify-end gap-2">
                    <BaseButton
                      variant="outline"
                      size="sm"
                      class="!border-blue-300 !text-blue-700 hover:!bg-blue-100 dark:!border-blue-400/70 dark:!text-blue-100 dark:hover:!bg-blue-500/20"
                      :disabled="stealBlacklistCount >= stealCropOptions.length"
                      @click="filterUnselectedStealCrops"
                    >
                      排除筛选
                    </BaseButton>
                    <BaseButton
                      variant="ghost"
                      size="sm"
                      class="!text-blue-700 hover:!bg-blue-100 dark:!text-blue-100 dark:hover:!bg-blue-500/20"
                      :disabled="!stealBlacklistSearch && !onlyShowUnselectedStealCrops"
                      @click="clearStealFilter"
                    >
                      清空
                    </BaseButton>
                  </div>
                </div>

                <div class="relative mb-2">
                  <div class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-blue-500/70 dark:text-blue-200/70">
                    <div class="i-carbon-search" />
                  </div>
                  <input
                    v-model="stealBlacklistSearch"
                    type="text"
                    placeholder="搜索作物名或 Seed ID"
                    class="w-full border border-blue-200 rounded-lg bg-white py-2 pl-9 pr-3 text-sm text-gray-700 outline-none placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-300/20 dark:border-blue-400/40 dark:bg-[#1c2b45] dark:text-blue-50 dark:placeholder:text-blue-200/50 dark:focus:border-blue-300/70"
                  >
                </div>

              <div v-if="stealCropOptions.length > 0">
                <div
                  v-if="filteredStealCropOptions.length > 0"
                  class="max-h-56 grid grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3"
                >
                  <button
                    v-for="crop in filteredStealCropOptions"
                    :key="crop.plantId"
                    type="button"
                    class="flex w-full cursor-pointer items-center gap-2 rounded border bg-white px-2 py-1.5 text-left text-xs text-gray-700 transition dark:bg-gray-800 dark:text-gray-300"
                    :class="isCropBlacklisted(crop.plantId)
                      ? 'border-blue-500 ring-1 ring-blue-300/70 dark:border-blue-400 dark:ring-blue-700/50'
                      : 'border-gray-200 hover:border-blue-300 dark:border-gray-700 dark:hover:border-blue-700'"
                    :aria-pressed="isCropBlacklisted(crop.plantId)"
                    @click="toggleStealBlacklistCrop(crop.plantId)"
                  >
                    <img
                      v-if="crop.image"
                      :src="crop.image"
                      :alt="crop.name"
                      class="h-[1.8rem] w-[1.8rem] rounded object-cover"
                    >
                    <div v-else class="h-[1.8rem] w-[1.8rem] flex items-center justify-center rounded bg-gray-100 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                      <div class="i-carbon-image" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-xs font-medium">{{ crop.name }}</div>
                      <div class="text-[11px] text-gray-500 dark:text-gray-400">
                        Seed ID: {{ crop.seedId === null ? '?' : crop.seedId }}   Lv.{{ crop.level === null ? '?' : crop.level }}
                      </div>
                    </div>
                  </button>
                </div>
                <div v-else class="rounded bg-white px-2 py-2 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  未找到匹配作物，请调整关键词后重试。
                </div>
              </div>
              <div v-else class="rounded bg-white px-2 py-2 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                暂无可选作物，请先等待种子列表加载完成。
              </div>
            </div>
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
        <div class="border-b bg-gray-50/50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50">
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

          <!-- Save Offline Button -->
          <div class="flex justify-end gap-2 pt-3">
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

        <!-- Token Info Header -->
        <div class="border-t bg-gray-50/50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50">
          <h3 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
            <div class="i-carbon-code" />
            请求参数信息
          </h3>
        </div>

        <!-- Token Info Content -->
        <div class="p-4 space-y-3">
          <div class="flex items-center gap-2">
            <input
              type="text"
              :value="token"
              readonly
              class="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            <BaseButton
              v-if="token !== '未登录'"
              variant="secondary"
              size="sm"
              @click="copyToClipboard(token)"
            >
              <div class="i-carbon-copy mr-1"></div>
              复制
            </BaseButton>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            x-admin-token 用于API请求认证，复制后可用于第三方工具调用接口。
          </p>
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
/* 种子列表拖拽排序动画 */
</style>
