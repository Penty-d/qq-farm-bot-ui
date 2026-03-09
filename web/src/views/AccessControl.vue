<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useAuthStore } from '@/stores/auth'

interface InviteItem {
  code: string
  maxUses: number
  usedCount: number
  remainingUses: number
  createdAt: number
  createdByUsername?: string
}

interface UserItem {
  id: number
  username: string
  role: 'admin' | 'user'
  createdAt?: number
  lastLoginAt?: number
}

const router = useRouter()
const authStore = useAuthStore()

const passwordForm = ref({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})
const passwordLoading = ref(false)
const passwordMessage = ref('')
const passwordError = ref('')

const inviteMaxUses = ref(1)
const invites = ref<InviteItem[]>([])
const users = ref<UserItem[]>([])
const loadingInvites = ref(false)
const creatingInvite = ref(false)
const deletingUserId = ref<number | null>(null)
const copyingInviteCode = ref('')
const inviteError = ref('')
const userError = ref('')

const isAdmin = computed(() => authStore.user?.role === 'admin')
const currentUser = computed(() => authStore.user)

function formatDateTime(ts?: number) {
  if (!ts)
    return '-'
  const date = new Date(ts)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

async function loadAdminData() {
  if (!isAdmin.value)
    return

  loadingInvites.value = true
  inviteError.value = ''
  userError.value = ''
  try {
    const [inviteRes, userRes] = await Promise.all([
      api.get('/api/admin/invites'),
      api.get('/api/admin/users'),
    ])
    invites.value = inviteRes.data?.data?.invites || []
    users.value = userRes.data?.data?.users || []
  }
  catch (e: any) {
    const msg = e.response?.data?.error || e.message || '加载失败'
    inviteError.value = msg
    userError.value = msg
  }
  finally {
    loadingInvites.value = false
  }
}

async function handleChangePassword() {
  passwordMessage.value = ''
  passwordError.value = ''
  if (!passwordForm.value.oldPassword || !passwordForm.value.newPassword) {
    passwordError.value = '请填写完整密码信息'
    return
  }
  if (passwordForm.value.newPassword !== passwordForm.value.confirmPassword) {
    passwordError.value = '两次输入的新密码不一致'
    return
  }

  passwordLoading.value = true
  try {
    const res = await api.post('/api/admin/change-password', {
      oldPassword: passwordForm.value.oldPassword,
      newPassword: passwordForm.value.newPassword,
    })
    if (res.data?.ok) {
      passwordMessage.value = '密码修改成功'
      passwordForm.value = {
        oldPassword: '',
        newPassword: '',
        confirmPassword: '',
      }
    }
    else {
      passwordError.value = res.data?.error || '修改失败'
    }
  }
  catch (e: any) {
    passwordError.value = e.response?.data?.error || e.message || '修改失败'
  }
  finally {
    passwordLoading.value = false
  }
}

async function handleCreateInvite() {
  inviteError.value = ''
  creatingInvite.value = true
  try {
    const res = await api.post('/api/admin/invites', {
      maxUses: Math.max(1, Number(inviteMaxUses.value) || 1),
    })
    if (res.data?.ok) {
      inviteMaxUses.value = 1
      await loadAdminData()
    }
    else {
      inviteError.value = res.data?.error || '生成邀请码失败'
    }
  }
  catch (e: any) {
    inviteError.value = e.response?.data?.error || e.message || '生成邀请码失败'
  }
  finally {
    creatingInvite.value = false
  }
}

async function handleDeleteInvite(code: string) {
  inviteError.value = ''
  try {
    const res = await api.delete(`/api/admin/invites/${encodeURIComponent(code)}`)
    if (res.data?.ok) {
      await loadAdminData()
    }
    else {
      inviteError.value = res.data?.error || '删除邀请码失败'
    }
  }
  catch (e: any) {
    inviteError.value = e.response?.data?.error || e.message || '删除邀请码失败'
  }
}

async function handleCopyInvite(code: string) {
  try {
    copyingInviteCode.value = code

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code)
      return
    }

    const textarea = document.createElement('textarea')
    textarea.value = code
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()

    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)

    if (!copied)
      throw new Error('当前环境不支持复制到剪贴板')
  }
  catch (e: any) {
    inviteError.value = e?.message || '复制邀请码失败'
  }
  finally {
    if (copyingInviteCode.value === code)
      copyingInviteCode.value = ''
  }
}

async function handleDeleteUser(userId: number) {
  userError.value = ''

  if (!window.confirm('确认删除该用户吗？删除后不可恢复。'))
    return

  deletingUserId.value = userId
  try {
    const res = await api.delete(`/api/admin/users/${userId}`)
    if (res.data?.ok) {
      await loadAdminData()
    }
    else {
      userError.value = res.data?.error || '删除用户失败'
    }
  }
  catch (e: any) {
    userError.value = e.response?.data?.error || e.message || '删除用户失败'
  }
  finally {
    deletingUserId.value = null
  }
}

async function handleLogout() {
  await authStore.logout()
  router.push('/login')
}

onMounted(() => {
  loadAdminData()
})
</script>

<template>
  <div class="mx-auto max-w-6xl w-full p-4 space-y-6">
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div class="rounded-xl bg-white p-5 shadow dark:bg-gray-800 lg:col-span-1">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-bold">
            当前用户
          </h2>
          <span
            class="rounded-full px-2 py-1 text-xs"
            :class="isAdmin ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'"
          >
            {{ isAdmin ? '管理员' : '普通用户' }}
          </span>
        </div>

        <div class="space-y-2 text-sm">
          <div class="flex items-center justify-between">
            <span class="text-gray-500">用户名</span>
            <span class="font-medium">{{ currentUser?.username || '-' }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-gray-500">用户 ID</span>
            <span class="font-medium">{{ currentUser?.id || '-' }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-gray-500">创建时间</span>
            <span class="font-medium">{{ formatDateTime(currentUser?.createdAt) }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-gray-500">最近登录</span>
            <span class="font-medium">{{ formatDateTime(currentUser?.lastLoginAt) }}</span>
          </div>
        </div>

        <BaseButton class="mt-5" variant="outline" block @click="handleLogout">
          退出登录
        </BaseButton>
      </div>

      <div class="rounded-xl bg-white p-5 shadow dark:bg-gray-800 lg:col-span-2">
        <h2 class="mb-4 text-lg font-bold">
          修改密码
        </h2>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
          <BaseInput v-model="passwordForm.oldPassword" type="password" label="当前密码" placeholder="请输入当前密码" />
          <BaseInput v-model="passwordForm.newPassword" type="password" label="新密码" placeholder="请输入新密码" />
          <BaseInput v-model="passwordForm.confirmPassword" type="password" label="确认新密码" placeholder="请再次输入新密码" />
        </div>

        <div v-if="passwordError" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300">
          {{ passwordError }}
        </div>
        <div v-if="passwordMessage" class="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-600 dark:bg-green-900/20 dark:text-green-300">
          {{ passwordMessage }}
        </div>

        <div class="mt-4 flex justify-end">
          <BaseButton variant="primary" :loading="passwordLoading" @click="handleChangePassword">
            保存新密码
          </BaseButton>
        </div>
      </div>
    </div>

    <template v-if="isAdmin">
      <div class="rounded-xl bg-white p-5 shadow dark:bg-gray-800">
        <div class="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 class="text-lg font-bold">
              邀请码管理
            </h2>
            <p class="mt-1 text-sm text-gray-500">
              普通用户注册必须使用邀请码，邀请码次数用完后自动失效。
            </p>
          </div>

          <div class="flex gap-3">
            <BaseInput
              v-model="inviteMaxUses"
              type="number"
              min="1"
              label="可使用次数"
              class="w-36"
            />
            <BaseButton variant="primary" :loading="creatingInvite" @click="handleCreateInvite">
              生成邀请码
            </BaseButton>
          </div>
        </div>

        <div v-if="inviteError" class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300">
          {{ inviteError }}
        </div>

        <div v-if="loadingInvites" class="py-8 text-center text-gray-400">
          加载中...
        </div>

        <div v-else-if="invites.length === 0" class="rounded-lg bg-gray-50 px-4 py-8 text-center text-sm text-gray-500 dark:bg-gray-700/30">
          暂无邀请码
        </div>

        <div v-else class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead>
              <tr class="border-b text-left text-gray-500 dark:border-gray-700">
                <th class="px-3 py-2">邀请码</th>
                <th class="px-3 py-2">总次数</th>
                <th class="px-3 py-2">已使用</th>
                <th class="px-3 py-2">剩余</th>
                <th class="px-3 py-2">创建者</th>
                <th class="px-3 py-2">创建时间</th>
                <th class="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in invites" :key="item.code" class="border-b dark:border-gray-700/60">
                <td class="px-3 py-3">
                  <div class="flex items-center gap-2">
                    <span class="font-mono font-semibold">{{ item.code }}</span>
                    <BaseButton
                      variant="ghost"
                      class="text-blue-500"
                      :disabled="copyingInviteCode === item.code"
                      @click="handleCopyInvite(item.code)"
                    >
                      {{ copyingInviteCode === item.code ? '复制中...' : '复制' }}
                    </BaseButton>
                  </div>
                </td>
                <td class="px-3 py-3">{{ item.maxUses }}</td>
                <td class="px-3 py-3">{{ item.usedCount }}</td>
                <td class="px-3 py-3">
                  <span class="rounded bg-green-50 px-2 py-1 text-green-600 dark:bg-green-900/20 dark:text-green-300">
                    {{ item.remainingUses }}
                  </span>
                </td>
                <td class="px-3 py-3">{{ item.createdByUsername || '-' }}</td>
                <td class="px-3 py-3">{{ formatDateTime(item.createdAt) }}</td>
                <td class="px-3 py-3 text-right">
                  <BaseButton variant="ghost" class="text-red-500" @click="handleDeleteInvite(item.code)">
                    删除
                  </BaseButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="rounded-xl bg-white p-5 shadow dark:bg-gray-800">
        <div class="mb-4">
          <h2 class="text-lg font-bold">
            用户列表
          </h2>
          <p class="mt-1 text-sm text-gray-500">
            管理员可查看全部用户；普通用户仅能访问自己的账号数据。
          </p>
        </div>

        <div v-if="userError" class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300">
          {{ userError }}
        </div>

        <div class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead>
              <tr class="border-b text-left text-gray-500 dark:border-gray-700">
                <th class="px-3 py-2">ID</th>
                <th class="px-3 py-2">用户名</th>
                <th class="px-3 py-2">角色</th>
                <th class="px-3 py-2">创建时间</th>
                <th class="px-3 py-2">最近登录</th>
                <th class="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in users" :key="item.id" class="border-b dark:border-gray-700/60">
                <td class="px-3 py-3">{{ item.id }}</td>
                <td class="px-3 py-3">{{ item.username }}</td>
                <td class="px-3 py-3">
                  <span
                    class="rounded px-2 py-1 text-xs"
                    :class="item.role === 'admin' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'"
                  >
                    {{ item.role === 'admin' ? '管理员' : '普通用户' }}
                  </span>
                </td>
                <td class="px-3 py-3">{{ formatDateTime(item.createdAt) }}</td>
                <td class="px-3 py-3">{{ formatDateTime(item.lastLoginAt) }}</td>
                <td class="px-3 py-3 text-right">
                  <BaseButton
                    variant="ghost"
                    class="text-red-500"
                    :disabled="deletingUserId === item.id || item.id === currentUser?.id"
                    @click="handleDeleteUser(item.id)"
                  >
                    {{ item.id === currentUser?.id ? '当前用户' : (deletingUserId === item.id ? '删除中...' : '删除') }}
                  </BaseButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
