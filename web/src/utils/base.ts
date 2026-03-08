function normalizeBasePath(rawBase: string) {
  let base = String(rawBase || '/').trim()
  if (!base)
    base = '/'
  if (!base.startsWith('/'))
    base = `/${base}`
  if (!base.endsWith('/'))
    base = `${base}/`
  return base.replace(/\/{2,}/g, '/')
}

export const appBasePath = normalizeBasePath(import.meta.env.BASE_URL || '/')

export function withAppBase(path: string) {
  const normalizedPath = String(path || '').replace(/^\/+/, '')
  return `${appBasePath}${normalizedPath}`
}
