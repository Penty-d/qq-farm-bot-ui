<script setup lang="ts">
import { useStorage } from '@vueuse/core'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'

const router = useRouter()
const password = ref('')
const error = ref('')
const loading = ref(false)
const token = useStorage('admin_token', '')

async function handleLogin() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.post('/api/login', { password: password.value })
    if (res.data.ok) {
      token.value = res.data.data.token
      router.push('/')
    }
    else {
      error.value = res.data.error || '登录失败'
    }
  }
  catch (e: any) {
    error.value = e.response?.data?.error || e.message || '登录异常'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="h-screen w-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
    <div class="max-w-md w-full rounded-xl bg-white p-8 shadow-lg space-y-6 dark:bg-gray-800">
      <div class="mb-8 py-4 text-center">
        <h1 class="text-3xl text-gray-900 font-bold tracking-tight dark:text-white">
          QQ农场智能助手
        </h1>
        <p class="mt-3 text-sm text-gray-500 tracking-widest uppercase dark:text-gray-400">
          管理面板
        </p>
      </div>
      <form class="space-y-4" @submit.prevent="handleLogin">
        <div>
          <BaseInput
            id="password"
            v-model="password"
            type="password"
            placeholder="请输入管理密码"
            required
          />
        </div>
        <div v-if="error" class="text-sm text-red-600">
          {{ error }}
        </div>
        <BaseButton
          type="submit"
          variant="primary"
          block
          :loading="loading"
        >
          登录
        </BaseButton>
      </form>
    </div>
  </div>
</template>
