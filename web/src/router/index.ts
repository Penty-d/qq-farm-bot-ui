import { useStorage } from '@vueuse/core'
import axios from 'axios'
import NProgress from 'nprogress'
import { createRouter, createWebHistory } from 'vue-router'
import { menuRoutes } from './menu'
import 'nprogress/nprogress.css'

NProgress.configure({ showSpinner: false })

const adminToken = useStorage('admin_token', '')

async function ensureTokenValid() {
  const token = String(adminToken.value || '').trim()
  
  // 首先检查是否禁用了密码认证
  try {
    const authCheckResponse = await axios.get('/api/auth/validate', {
      headers: token ? { 'x-admin-token': token } : {},
      timeout: 6000,
    })
    
    if (authCheckResponse.data && authCheckResponse.data.ok) {
      const { valid, passwordDisabled } = authCheckResponse.data.data
      
      // 如果禁用了密码认证，直接返回true
      if (passwordDisabled) {
        return true
      }
      
      // 如果启用了密码认证，检查token有效性
      if (valid && token) {
        return true
      }
    }
    
    return false
  } catch (error) {
    return false
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('@/layouts/DefaultLayout.vue'),
      children: menuRoutes.map(route => ({
        path: route.path,
        name: route.name,
        component: route.component,
      })),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/Login.vue'),
    },
  ],
})

router.beforeEach(async (to, _from) => {
  NProgress.start()

  // 首先检查是否禁用了密码认证
  const authValid = await ensureTokenValid()
  
  if (to.name === 'login') {
    // 如果已经通过认证（包括禁用密码认证的情况），跳转到首页
    if (authValid) {
      return { name: 'dashboard' }
    }
    // 否则显示登录页
    return true
  }

  // 对于其他页面，检查认证状态
  if (!authValid) {
    // 如果认证失败，清除token并跳转到登录页
    adminToken.value = ''
    return { name: 'login' }
  }

  return true
})

router.afterEach(() => {
  NProgress.done()
})

export default router
