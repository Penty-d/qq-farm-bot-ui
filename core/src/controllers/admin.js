/**
 * 管理面板 HTTP 服务
 * 改写为接收 DataProvider 模式
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const process = require('node:process')
const express = require('express')
const { version } = require('../../package.json')
const { CONFIG } = require('../config/config')
const { getLevelExpProgress } = require('../config/gameConfig')
const { getResourcePath } = require('../config/runtime-paths')
const { addOrUpdateAccount, deleteAccount } = require('../models/store')
const store = require('../models/store') // 引入 store 模块
const { QRLoginSession, MiniProgramLoginSession } = require('../services/qrlogin')
const { CookieUtils } = require('../utils/qrutils')

const hashPassword = pwd => crypto.createHash('sha256').update(String(pwd || '')).digest('hex')

let app = null
let server = null
let provider = null // DataProvider

function startAdminServer(dataProvider) {
  if (app)
    return
  provider = dataProvider

  app = express()
  app.use(express.json())

  const tokens = new Set()

  const issueToken = () => crypto.randomBytes(24).toString('hex')
  const authRequired = (req, res, next) => {
    const token = req.headers['x-admin-token']
    if (!token || !tokens.has(token)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' })
    }
    req.adminToken = token
    next()
  }

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-account-id, x-admin-token')
    if (req.method === 'OPTIONS')
      return res.sendStatus(200)
    next()
  })

  const webDist = path.join(__dirname, '../../../web/dist')
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist))
  }
  else {
    console.warn('web build not found at:', webDist)
    app.get('/', (req, res) => res.send('web build not found. Please build the web project.'))
  }
  app.use('/game-config', express.static(getResourcePath('gameConfig')))

  // 登录与鉴权
  app.post('/api/login', (req, res) => {
    const { password } = req.body || {}
    const input = String(password || '')
    const storedHash = store.getAdminPasswordHash ? store.getAdminPasswordHash() : ''
    let ok = false
    if (storedHash) {
      ok = hashPassword(input) === storedHash
    }
    else {
      ok = input === String(CONFIG.adminPassword || '')
    }
    if (!ok) {
      return res.status(401).json({ ok: false, error: '密码错误' })
    }
    const token = issueToken()
    tokens.add(token)
    res.json({ ok: true, data: { token } })
  })

  app.use('/api', (req, res, next) => {
    if (req.path === '/login' || req.path === '/qr/create' || req.path === '/qr/check')
      return next()
    return authRequired(req, res, next)
  })

  app.post('/api/admin/change-password', (req, res) => {
    const body = req.body || {}
    const oldPassword = String(body.oldPassword || '')
    const newPassword = String(body.newPassword || '')
    if (newPassword.length < 4) {
      return res.status(400).json({ ok: false, error: '新密码长度至少为 4 位' })
    }
    const storedHash = store.getAdminPasswordHash ? store.getAdminPasswordHash() : ''
    const ok = storedHash
      ? hashPassword(oldPassword) === storedHash
      : oldPassword === String(CONFIG.adminPassword || '')
    if (!ok) {
      return res.status(400).json({ ok: false, error: '原密码错误' })
    }
    const nextHash = hashPassword(newPassword)
    if (store.setAdminPasswordHash) {
      store.setAdminPasswordHash(nextHash)
    }
    res.json({ ok: true })
  })

  app.get('/api/ping', (req, res) => {
    res.json({ ok: true, data: { ok: true, uptime: process.uptime(), version } })
  })

  app.post('/api/logout', (req, res) => {
    const token = req.adminToken
    if (token)
      tokens.delete(token)
    res.json({ ok: true })
  })

  // Helper to get account ID from header
  const getAccId = req => req.headers['x-account-id']

  // API: 完整状态
  app.get('/api/status', async (req, res) => {
    const id = getAccId(req)
    if (!id)
      return res.json({ ok: false, error: 'Missing x-account-id' })

    try {
      const data = provider.getStatus(id)
      if (data && data.status) {
        const { level, exp } = data.status
        const progress = getLevelExpProgress(level, exp)
        data.levelProgress = progress
      }
      res.json({ ok: true, data })
    }
    catch (e) {
      res.json({ ok: false, error: e.message })
    }
  })

  app.post('/api/automation', async (req, res) => {
    const id = getAccId(req)
    try {
      let lastData = null
      for (const [k, v] of Object.entries(req.body)) {
        lastData = await provider.setAutomation(id, k, v)
      }
      res.json({ ok: true, data: lastData || {} })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 农田详情
  app.get('/api/lands', async (req, res) => {
    const id = getAccId(req)
    if (!id)
      return res.status(400).json({ ok: false })
    try {
      const data = await provider.getLands(id)
      res.json({ ok: true, data })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 好友列表
  app.get('/api/friends', async (req, res) => {
    const id = getAccId(req)
    if (!id)
      return res.status(400).json({ ok: false })
    try {
      const data = await provider.getFriends(id)
      res.json({ ok: true, data })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 好友农田详情
  app.get('/api/friend/:gid/lands', async (req, res) => {
    const id = getAccId(req)
    if (!id)
      return res.status(400).json({ ok: false })
    try {
      const data = await provider.getFriendLands(id, req.params.gid)
      res.json({ ok: true, data })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 对指定好友执行单次操作（偷菜/浇水/除草/捣乱）
  app.post('/api/friend/:gid/op', async (req, res) => {
    const id = getAccId(req)
    if (!id)
      return res.status(400).json({ ok: false, error: 'Missing x-account-id' })
    try {
      const opType = String((req.body || {}).opType || '')
      const data = await provider.doFriendOp(id, req.params.gid, opType)
      res.json({ ok: true, data })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 种子列表
  app.get('/api/seeds', async (req, res) => {
    const id = getAccId(req)
    if (!id)
      return res.status(400).json({ ok: false })
    try {
      const data = await provider.getSeeds(id)
      res.json({ ok: true, data })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 背包物品
  app.get('/api/bag', async (req, res) => {
    const id = getAccId(req)
    if (!id)
      return res.status(400).json({ ok: false })
    try {
      const data = await provider.getBag(id)
      res.json({ ok: true, data })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 每日礼包状态总览
  app.get('/api/daily-gifts', async (req, res) => {
    const id = getAccId(req)
    if (!id)
      return res.status(400).json({ ok: false })
    try {
      const data = await provider.getDailyGifts(id)
      res.json({ ok: true, data })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 启动账号
  app.post('/api/accounts/:id/start', (req, res) => {
    try {
      provider.startAccount(req.params.id)
      res.json({ ok: true })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 停止账号
  app.post('/api/accounts/:id/stop', (req, res) => {
    try {
      provider.stopAccount(req.params.id)
      res.json({ ok: true })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 农场一键操作
  app.post('/api/farm/operate', async (req, res) => {
    const id = getAccId(req)
    if (!id)
      return res.status(400).json({ ok: false })
    try {
      const { opType } = req.body // 'harvest', 'clear', 'plant', 'all'
      await provider.doFarmOp(id, opType)
      res.json({ ok: true })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 数据分析
  app.get('/api/analytics', async (req, res) => {
    try {
      const sortBy = req.query.sort || 'exp'
      const { getPlantRankings } = require('../services/analytics')
      const data = getPlantRankings(sortBy)
      res.json({ ok: true, data })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 设置页统一保存（单次写入+单次广播）
  app.post('/api/settings/save', async (req, res) => {
    const id = getAccId(req)
    try {
      const data = await provider.saveSettings(id, req.body || {})
      res.json({ ok: true, data: data || {} })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 设置面板主题
  app.post('/api/settings/theme', async (req, res) => {
    try {
      const theme = String((req.body || {}).theme || '')
      const data = await provider.setUITheme(theme)
      res.json({ ok: true, data: data || {} })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 保存下线提醒配置
  app.post('/api/settings/offline-reminder', async (req, res) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {}
      const data = store.setOfflineReminder ? store.setOfflineReminder(body) : {}
      res.json({ ok: true, data: data || {} })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 获取配置
  app.get('/api/settings', async (req, res) => {
    try {
      const id = getAccId(req)
      // 直接从主进程的 store 读取，确保即使账号未运行也能获取配置
      const intervals = store.getIntervals(id)
      const strategy = store.getPlantingStrategy(id)
      const preferredSeed = store.getPreferredSeed(id)
      const friendQuietHours = store.getFriendQuietHours(id)
      const automation = store.getAutomation(id)
      const ui = store.getUI()
      const offlineReminder = store.getOfflineReminder
        ? store.getOfflineReminder()
        : { channel: 'webhook', reloginUrlMode: 'none', endpoint: '', token: '', title: '账号下线提醒', msg: '账号下线', offlineDeleteSec: 120 }
      res.json({ ok: true, data: { intervals, strategy, preferredSeed, friendQuietHours, automation, ui, offlineReminder } })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 账号管理
  app.get('/api/accounts', (req, res) => {
    try {
      const data = provider.getAccounts()
      res.json({ ok: true, data })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  app.post('/api/accounts', (req, res) => {
    try {
      const isUpdate = !!req.body.id
      let wasRunning = false
      if (isUpdate && provider.isAccountRunning) {
        wasRunning = provider.isAccountRunning(req.body.id)
      }

      const data = addOrUpdateAccount(req.body)
      if (provider.addAccountLog) {
        const accountId = isUpdate ? String(req.body.id) : String((data.accounts[data.accounts.length - 1] || {}).id || '')
        const accountName = req.body.name || ''
        provider.addAccountLog(
          isUpdate ? 'update' : 'add',
          isUpdate ? `更新账号: ${accountName || accountId}` : `添加账号: ${accountName || accountId}`,
          accountId,
          accountName,
        )
      }
      // 如果是新增，自动启动
      if (!isUpdate) {
        const newAcc = data.accounts[data.accounts.length - 1]
        if (newAcc)
          provider.startAccount(newAcc.id)
      }
      else if (wasRunning) {
        // 如果是更新，且之前在运行，则重启
        provider.restartAccount(req.body.id)
      }
      res.json({ ok: true, data })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  app.delete('/api/accounts/:id', (req, res) => {
    try {
      const before = provider.getAccounts()
      const target = (before.accounts || []).find(a => String(a.id) === String(req.params.id))
      provider.stopAccount(req.params.id)
      const data = deleteAccount(req.params.id)
      if (provider.addAccountLog) {
        provider.addAccountLog('delete', `删除账号: ${(target && target.name) || req.params.id}`, req.params.id, target ? target.name : '')
      }
      res.json({ ok: true, data })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 账号日志
  app.get('/api/account-logs', (req, res) => {
    try {
      const limit = Number.parseInt(req.query.limit) || 100
      const list = provider.getAccountLogs ? provider.getAccountLogs(limit) : []
      res.json({ ok: true, data: list })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  // API: 日志
  app.get('/api/logs', (req, res) => {
    const queryAccountIdRaw = (req.query.accountId || '').toString().trim()
    const id = queryAccountIdRaw ? (queryAccountIdRaw === 'all' ? '' : queryAccountIdRaw) : getAccId(req)
    const options = {
      limit: Number.parseInt(req.query.limit) || 100,
      tag: req.query.tag || '',
      module: req.query.module || '',
      event: req.query.event || '',
      keyword: req.query.keyword || '',
      isWarn: req.query.isWarn,
      timeFrom: req.query.timeFrom || '',
      timeTo: req.query.timeTo || '',
    }
    const list = provider.getLogs(id, options)
    res.json({ ok: true, data: list })
  })

  // ============ QR Code Login APIs (无需账号选择) ============
  // 这些接口不需要 authRequired 也能调用（用于登录流程）
  app.post('/api/qr/create', async (req, res) => {
    try {
      const result = await MiniProgramLoginSession.requestLoginCode()
      res.json({ ok: true, data: result })
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  app.post('/api/qr/check', async (req, res) => {
    const { code } = req.body || {}
    if (!code) {
      return res.status(400).json({ ok: false, error: 'Missing code' })
    }

    try {
      const result = await MiniProgramLoginSession.queryStatus(code)

      if (result.status === 'OK') {
        const ticket = result.ticket
        const uin = result.uin || ''
        const nickname = result.nickname || '' // 获取昵称
        const appid = '1112386029' // Farm appid

        const authCode = await MiniProgramLoginSession.getAuthCode(ticket, appid)

        let avatar = ''
        if (uin) {
          avatar = `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640`
        }

        res.json({ ok: true, data: { status: 'OK', code: authCode, uin, avatar, nickname } })
      }
      else if (result.status === 'Used') {
        res.json({ ok: true, data: { status: 'Used' } })
      }
      else if (result.status === 'Wait') {
        res.json({ ok: true, data: { status: 'Wait' } })
      }
      else {
        res.json({ ok: true, data: { status: 'Error', error: result.msg } })
      }
    }
    catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
  })

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/game-config')) {
      return res.status(404).json({ ok: false, error: 'Not Found' })
    }
    if (fs.existsSync(webDist)) {
      res.sendFile(path.join(webDist, 'index.html'))
    }
    else {
      res.status(404).send('web build not found. Please build the web project.')
    }
  })

  const port = CONFIG.adminPort || 3000
  server = app.listen(port, '0.0.0.0', () => {
    console.log(`[管理面板] http://localhost:${port}`)
  })
}

function stopAdminServer() {
  if (server) {
    server.close()
    server = null
    app = null
  }
}

module.exports = {
  startAdminServer,
  stopAdminServer,
}
