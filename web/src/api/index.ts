import { useStorage } from '@vueuse/core'
import axios from 'axios'
import { useToastStore } from '@/stores/toast'
import { appBasePath, withAppBase } from '@/utils/base'

const tokenRef = useStorage('admin_token', '')
const accountIdRef = useStorage('current_account_id', '')

const api = axios.create({
  baseURL: appBasePath,
  timeout: 10000,
})

api.interceptors.request.use((config) => {
  const token = tokenRef.value
  if (token) {
    config.headers['x-admin-token'] = token
  }
  const accountId = accountIdRef.value
  if (accountId) {
    config.headers['x-account-id'] = accountId
  }
  return config
}, (error) => {
  return Promise.reject(error)
})

api.interceptors.response.use((response) => {
  return response
}, (error) => {
  const toast = useToastStore()

  if (error.response) {
    if (error.response.status === 401) {
      // Avoid redirect loop or multiple redirects
      if (!window.location.pathname.includes('/login')) {
        tokenRef.value = ''
        window.location.href = withAppBase('login')
        toast.warning('登录已过期，请重新登录')
      }
    }
    else if (error.response.status >= 500) {
      const backendError = String(error.response.data?.error || error.response.data?.message || '')
      // 后端运行态可预期错误：不弹全局500，交给页面状态处理
      if (backendError === '账号未运行' || backendError === 'API Timeout') {
        return Promise.reject(error)
      }
      toast.error(`服务器错误: ${error.response.status} ${error.response.statusText}`)
    }
    else {
      const msg = error.response.data?.message || error.message
      // Don't show toast for 404 if it's expected in some logic?
      // Generally for API calls, 404 is an error.
      toast.error(`请求失败: ${msg}`)
    }
  }
  else if (error.request) {
    toast.error('网络错误，无法连接到服务器')
  }
  else {
    toast.error(`错误: ${error.message}`)
  }

  return Promise.reject(error)
})

export default api
