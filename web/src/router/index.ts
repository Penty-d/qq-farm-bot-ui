import axios from 'axios'
import NProgress from 'nprogress'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { menuRoutes } from './menu'
import 'nprogress/nprogress.css'

NProgress.configure({ showSpinner: false })

const pinia = createPinia()
let validatedToken = ''
let validatingPromise: Promise<boolean> | null = null

async function ensureTokenValid() {
  const authStore = useAuthStore(pinia)
  const token = String(authStore.token || '').trim()
  if (!token)
    return false

  if (validatedToken && validatedToken === token)
    return true

  if (validatingPromise)
    return validatingPromise

  validatingPromise = axios.get('/api/auth/validate', {
    headers: { 'x-admin-token': token },
    timeout: 6000,
  }).then((res) => {
    const valid = !!(res.data && res.data.ok && res.data.data && res.data.data.valid)
    if (valid) {
      validatedToken = token
      authStore.setAuth(token, res.data.data?.user || authStore.user || null)
    }
    return valid
  }).catch(() => false).finally(() => {
    validatingPromise = null
  })

  return validatingPromise
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

  const authStore = useAuthStore(pinia)

  if (to.name === 'login') {
    if (!authStore.token) {
      validatedToken = ''
      authStore.clearAuth()
      return true
    }
    const valid = await ensureTokenValid()
    if (valid)
      return { name: 'dashboard' }
    authStore.clearAuth()
    validatedToken = ''
    return true
  }

  if (!authStore.token) {
    validatedToken = ''
    authStore.clearAuth()
    return { name: 'login' }
  }

  const valid = await ensureTokenValid()
  if (!valid) {
    authStore.clearAuth()
    validatedToken = ''
    return { name: 'login' }
  }

  return true
})

router.afterEach(() => {
  NProgress.done()
})

export default router
