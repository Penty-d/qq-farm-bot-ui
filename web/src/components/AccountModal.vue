<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { computed, reactive, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'

const props = defineProps<{
  show: boolean
  editData?: any
}>()

const emit = defineEmits(['close', 'saved'])

const activeTab = ref('qr') // qr, manual
const loading = ref(false)
const qrData = ref<{ image?: string, code: string, qrcode?: string, url?: string } | null>(null)
const qrStatus = ref('')
const errorMessage = ref('')

const form = reactive({
  name: '',
  code: '',
  platform: 'qq',
})

const { pause: stopQRCheck, resume: startQRCheck } = useIntervalFn(async () => {
  if (!qrData.value)
    return
  try {
    const res = await api.post('/api/qr/check', { code: qrData.value.code })
    if (res.data.ok) {
      const status = res.data.data.status
      if (status === 'OK') {
        // Login success
        stopQRCheck()
        qrStatus.value = '登录成功'
        // Auto fill form and submit
        const { uin, code: authCode, nickname } = res.data.data

        // Use name from form if provided, otherwise default
        let accName = form.name.trim()
        if (!accName) {
          // 优先使用 nickname，其次使用 uin
          accName = nickname || (uin ? String(uin) : '扫码账号')
        }

        // We need to add account with this data
        await addAccount({
          id: props.editData?.id,
          uin,
          code: authCode,
          loginType: 'qr',
          name: props.editData ? (props.editData.name || accName) : accName,
          platform: 'qq',
        })
      }
      else if (status === 'Used') {
        qrStatus.value = '二维码已失效' // Consistent text
        stopQRCheck()
      }
      else if (status === 'Wait') {
        qrStatus.value = '等待扫码'
      }
      else {
        qrStatus.value = `错误: ${res.data.data.error}`
      }
    }
  }
  catch (e) {
    console.error(e)
  }
}, 1000, { immediate: false })

// QR Code Logic
async function loadQRCode() {
  if (activeTab.value !== 'qr')
    return
  loading.value = true
  qrStatus.value = '正在获取二维码'
  errorMessage.value = ''
  try {
    const res = await api.post('/api/qr/create')
    if (res.data.ok) {
      qrData.value = res.data.data
      qrStatus.value = '请使用手机QQ扫码'
      startQRCheck()
    }
    else {
      qrStatus.value = `获取失败: ${res.data.error}`
    }
  }
  catch (e) {
    qrStatus.value = '获取失败'
    console.error(e)
  }
  finally {
    loading.value = false
  }
}

const isMobile = computed(() => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent))

function openQRCodeLoginUrl() {
  if (!qrData.value?.url)
    return

  const url = qrData.value.url
  if (!isMobile.value) {
    window.open(url, '_blank')
    return
  }

  // Mobile Deep Link logic
  try {
    const b64 = btoa(decodeURIComponent(encodeURIComponent(url)))
    const qqDeepLink = `mqqapi://forward/url?url_prefix=${encodeURIComponent(b64)}&version=1&src_type=web`
    window.location.href = qqDeepLink
  }
  catch (e) {
    console.error('打开二维码登录链接失败:', e)
    window.location.href = url
  }
}

async function addAccount(data: any) {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await api.post('/api/accounts', data)
    if (res.data.ok) {
      emit('saved')
      close()
    }
    else {
      errorMessage.value = `保存失败: ${res.data.error}`
    }
  }
  catch (e: any) {
    errorMessage.value = `保存失败: ${e.response?.data?.error || e.message}`
  }
  finally {
    loading.value = false
  }
}

async function submitManual() {
  errorMessage.value = ''
  if (!form.code) {
    errorMessage.value = '请输入Code 或 进行扫码'
    return
  }

  if (!form.name && props.editData) {
    errorMessage.value = '请输入名称'
    return
  }

  let code = form.code.trim()
  // Try to extract code from URL if present
  const match = code.match(/[?&]code=([^&]+)/i)
  if (match && match[1]) {
    code = decodeURIComponent(match[1])
    form.code = code // Update UI
  }

  const payload = {
    id: props.editData?.id, // If editing
    name: form.name,
    code,
    platform: form.platform,
    loginType: 'manual',
  }

  await addAccount(payload)
}

function close() {
  stopQRCheck()
  emit('close')
}

watch(() => props.show, (newVal) => {
  if (newVal) {
    errorMessage.value = ''
    if (props.editData) {
      // Edit mode: Default to QR refresh, load code
      activeTab.value = 'qr'
      form.name = props.editData.name
      form.code = props.editData.code || ''
      form.platform = props.editData.platform || 'qq'
      loadQRCode()
    }
    else {
      // Add mode: Default to QR
      activeTab.value = 'qr'
      form.name = ''
      form.code = ''
      form.platform = 'qq'
      loadQRCode()
    }
  }
  else {
    // Reset when closed
    stopQRCheck()
    qrData.value = null
    qrStatus.value = ''
  }
})
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div class="max-w-md w-full overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800">
      <div class="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
        <h3 class="text-lg font-semibold">
          {{ editData ? '编辑账号' : '添加账号' }}
        </h3>
        <BaseButton variant="ghost" class="!p-1" @click="close">
          <div class="i-carbon-close text-xl" />
        </BaseButton>
      </div>

      <div class="p-4">
        <div v-if="errorMessage" class="mb-4 rounded bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {{ errorMessage }}
        </div>
        <!-- Tabs -->
        <div class="mb-4 flex border-b border-gray-200 dark:border-gray-700">
          <button
            class="flex-1 py-2 text-center font-medium"
            :class="activeTab === 'qr' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'"
            @click="activeTab = 'qr'; loadQRCode()"
          >
            {{ editData ? '扫码更新' : '扫码登录' }}
          </button>
          <button
            class="flex-1 py-2 text-center font-medium"
            :class="activeTab === 'manual' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'"
            @click="activeTab = 'manual'; stopQRCheck()"
          >
            手动填码
          </button>
        </div>

        <!-- QR Tab -->
        <div v-if="activeTab === 'qr'" class="flex flex-col items-center justify-center py-4 space-y-4">
          <div class="w-full text-center">
            <p class="text-sm text-gray-500 dark:text-gray-400">
              扫码默认使用QQ昵称
            </p>
          </div>

          <div v-if="qrData && (qrData.image || qrData.qrcode)" class="border rounded bg-white p-2">
            <img :src="qrData.image ? (qrData.image.startsWith('data:') ? qrData.image : `data:image/png;base64,${qrData.image}`) : qrData.qrcode" class="h-48 w-48">
          </div>
          <div v-else class="h-48 w-48 flex items-center justify-center rounded bg-gray-100 text-gray-400 dark:bg-gray-700">
            <div v-if="loading" i-svg-spinners-90-ring-with-bg class="text-3xl" />
            <span v-else>二维码已过期</span>
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ qrStatus }}
          </p>
          <div class="flex gap-2">
            <BaseButton variant="text" size="sm" @click="loadQRCode">
              刷新二维码
            </BaseButton>
            <BaseButton
              v-if="qrData?.url"
              variant="text"
              size="sm"
              class="text-blue-600 md:hidden"
              @click="openQRCodeLoginUrl"
            >
              跳转QQ登录
            </BaseButton>
          </div>
        </div>

        <!-- Manual Tab -->
        <div v-if="activeTab === 'manual'" class="space-y-4">
          <BaseInput
            v-model="form.name"
            label="备注名称"
            placeholder="留空默认账号X"
          />

          <BaseTextarea
            v-model="form.code"
            label="Code"
            placeholder="请输入登录 Code"
            :rows="3"
          />

          <BaseSelect
            v-if="!editData"
            v-model="form.platform"
            label="平台"
            :options="[
              { label: 'QQ小程序', value: 'qq' },
              { label: '微信小程序', value: 'wx' },
            ]"
          />

          <div class="flex justify-end gap-2 pt-4">
            <BaseButton
              variant="outline"
              @click="close"
            >
              取消
            </BaseButton>
            <BaseButton
              variant="primary"
              :loading="loading"
              @click="submitManual"
            >
              {{ editData ? '保存' : '添加' }}
            </BaseButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
