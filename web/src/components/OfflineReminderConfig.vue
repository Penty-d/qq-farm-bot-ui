<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'

interface OfflineConfig {
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

const props = defineProps<{
  modelValue: OfflineConfig
  useGlobal: boolean
  isAccountLevel?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: OfflineConfig]
  'update:useGlobal': [value: boolean]
}>()

const localConfig = ref<OfflineConfig>({ ...props.modelValue })
const localUseGlobal = ref(props.useGlobal)

watch(() => props.modelValue, (newVal) => {
  localConfig.value = { ...newVal }
}, { deep: true })

watch(() => props.useGlobal, (newVal) => {
  localUseGlobal.value = newVal
})

watch(localConfig, (newVal) => {
  emit('update:modelValue', newVal)
}, { deep: true })

watch(localUseGlobal, (newVal) => {
  emit('update:useGlobal', newVal)
})

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
  const key = String(localConfig.value.channel || '').trim().toLowerCase()
  return CHANNEL_DOCS[key] || ''
})

function openChannelDocs() {
  const url = currentChannelDocUrl.value
  if (!url)
    return
  window.open(url, '_blank', 'noopener,noreferrer')
}

const isDisabled = computed(() => props.isAccountLevel && localUseGlobal.value)
</script>

<template>
  <div class="space-y-3">
    <!-- 账号级别配置：显示使用全局配置开关 -->
    <div v-if="isAccountLevel" class="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
      <div class="flex items-center gap-2">
        <div class="i-carbon-information text-blue-600 dark:text-blue-400" />
        <span class="text-sm text-blue-700 dark:text-blue-300">使用全局下线提醒配置</span>
      </div>
      <BaseSwitch v-model="localUseGlobal" />
    </div>

    <div v-if="!isDisabled" class="space-y-3">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <BaseSelect
          v-model="localConfig.channel"
          label="推送渠道"
          :options="channelOptions"
        />
        <div class="flex items-end gap-2">
          <BaseSelect
            v-model="localConfig.reloginUrlMode"
            label="重登录模式"
            :options="reloginUrlModeOptions"
            class="flex-1"
          />
          <BaseButton
            v-if="currentChannelDocUrl"
            variant="outline"
            size="sm"
            class="mb-0.5"
            @click="openChannelDocs"
          >
            <div class="i-carbon-document" />
          </BaseButton>
        </div>
      </div>

      <BaseInput
        v-if="localConfig.channel === 'webhook' || localConfig.channel === 'custom_request'"
        v-model="localConfig.endpoint"
        label="接口地址"
        placeholder="https://your-webhook-url.com"
      />

      <BaseInput
        v-if="localConfig.channel !== 'custom_request'"
        v-model="localConfig.token"
        label="Token"
        placeholder="推送服务的 Token"
      />

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <BaseInput
          v-model="localConfig.title"
          label="标题"
          placeholder="账号下线提醒"
        />
        <BaseInput
          v-model="localConfig.msg"
          label="消息内容"
          placeholder="账号下线"
        />
      </div>

      <div v-if="localConfig.channel === 'custom_request'" class="space-y-3">
        <BaseTextarea
          v-model="localConfig.custom_headers"
          label="自定义请求头 (JSON)"
          placeholder='{"Content-Type": "application/json"}'
          :rows="3"
        />
        <BaseTextarea
          v-model="localConfig.custom_body"
          label="自定义请求体 (JSON)"
          placeholder='{"title": "{{title}}", "content": "{{content}}"}'
          :rows="4"
        />
      </div>

      <div class="flex items-center gap-3">
        <BaseSwitch v-model="localConfig.offlineDeleteEnabled" />
        <label class="text-sm text-gray-700 dark:text-gray-300">
          离线自动删除账号
        </label>
        <BaseInput
          v-if="localConfig.offlineDeleteEnabled"
          v-model.number="localConfig.offlineDeleteSec"
          type="number"
          placeholder="秒"
          class="w-24"
          :min="1"
        />
        <span v-if="localConfig.offlineDeleteEnabled" class="text-sm text-gray-500">秒后删除</span>
      </div>
    </div>

    <!-- 使用全局配置时的提示 -->
    <div v-else class="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400">
      当前使用全局下线提醒配置，如需自定义请关闭上方开关
    </div>
  </div>
</template>
