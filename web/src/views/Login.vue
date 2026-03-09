<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const inviteCode = ref('')
const error = ref('')
const success = ref('')

async function handleSubmit() {
  error.value = ''
  success.value = ''

  if (!username.value.trim()) {
    error.value = '请输入用户名'
    return
  }

  if (!password.value) {
    error.value = '请输入密码'
    return
  }

  if (mode.value === 'register') {
    if (!inviteCode.value.trim()) {
      error.value = '请输入邀请码'
      return
    }
    if (password.value !== confirmPassword.value) {
      error.value = '两次密码输入不一致'
      return
    }

    try {
      const res = await authStore.register(username.value, password.value, inviteCode.value)
      if (res?.ok) {
        success.value = '注册成功，请使用新账号登录'
        mode.value = 'login'
        confirmPassword.value = ''
        inviteCode.value = ''
      }
      else {
        error.value = res?.error || '注册失败'
      }
    }
    catch (e: any) {
      error.value = e.response?.data?.error || e.message || '注册异常'
    }
    return
  }

  try {
    const res = await authStore.login(username.value, password.value)
    if (res?.ok) {
      router.push('/')
    }
    else {
      error.value = res?.error || '登录失败'
    }
  }
  catch (e: any) {
    error.value = e.response?.data?.error || e.message || '登录异常'
  }
}

function switchMode(nextMode: 'login' | 'register') {
  mode.value = nextMode
  error.value = ''
  success.value = ''
}
</script>

<template>
  <div class="min-h-dvh w-full flex items-start justify-center bg-gray-100 px-4 pt-[10vh] sm:items-center dark:bg-gray-900 sm:pt-0">
    <div class="max-w-md w-full rounded-xl bg-white p-8 shadow-lg space-y-6 dark:bg-gray-800">
      <div class="mb-6 py-2 text-center">
        <h1 class="text-3xl text-gray-900 font-bold tracking-tight dark:text-white">
          QQ农场智能助手
        </h1>
        <p class="mt-3 text-sm text-gray-500 tracking-widest uppercase dark:text-gray-400">
          用户权限管理面板
        </p>
      </div>

      <div class="rounded-lg bg-gray-100 p-1 dark:bg-gray-700">
        <div class="grid grid-cols-2 gap-1">
          <button
            class="rounded-md px-3 py-2 text-sm font-medium transition"
            :class="mode === 'login' ? 'bg-white text-green-600 shadow dark:bg-gray-800' : 'text-gray-500 dark:text-gray-300'"
            @click="switchMode('login')"
          >
            登录
          </button>
          <button
            class="rounded-md px-3 py-2 text-sm font-medium transition"
            :class="mode === 'register' ? 'bg-white text-green-600 shadow dark:bg-gray-800' : 'text-gray-500 dark:text-gray-300'"
            @click="switchMode('register')"
          >
            注册
          </button>
        </div>
      </div>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <BaseInput
          id="username"
          v-model="username"
          placeholder="请输入用户名"
          required
        />

        <BaseInput
          id="password"
          v-model="password"
          type="password"
          :placeholder="mode === 'login' ? '请输入密码' : '请设置密码'"
          required
        />

        <BaseInput
          v-if="mode === 'register'"
          id="confirm-password"
          v-model="confirmPassword"
          type="password"
          placeholder="请再次输入密码"
          required
        />

        <BaseInput
          v-if="mode === 'register'"
          id="invite-code"
          v-model="inviteCode"
          placeholder="请输入管理员发放的邀请码"
          required
        />

        <div v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300">
          {{ error }}
        </div>

        <div v-if="success" class="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-600 dark:bg-green-900/20 dark:text-green-300">
          {{ success }}
        </div>

        <BaseButton
          type="submit"
          variant="primary"
          block
          :loading="authStore.loading"
        >
          {{ mode === 'login' ? '登录系统' : '注册账号' }}
        </BaseButton>
      </form>

      <div class="text-xs text-gray-400 leading-6 dark:text-gray-500">
        <template v-if="mode === 'login'">
          管理员默认账号通常为 <span class="font-mono text-gray-600 dark:text-gray-300">admin</span>。
        </template>
        <template v-else>
          普通用户必须使用管理员生成的邀请码完成注册，邀请码达到使用次数后会自动失效。
        </template>
      </div>
    </div>
  </div>
</template>
