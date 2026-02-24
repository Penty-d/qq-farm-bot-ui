/**
 * 主程序 - 进程管理器
 * 负责启动 Web 面板，并管理多个 Bot 子进程
 */

const { fork } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const process = require('node:process')
const { startAdminServer } = require('./src/controllers/admin')
const store = require('./src/models/store')
const { sendPushooMessage } = require('./src/services/push')
const { MiniProgramLoginSession } = require('./src/services/qrlogin')

const { getAccounts, addOrUpdateAccount, deleteAccount } = store

// ============ 状态管理 ============
// workers: { [accountId]: { process, status, logs: [], requestQueue: Map } }
const workers = {}
const GLOBAL_LOGS = [] // 全局系统日志
const ACCOUNT_LOGS = [] // 账号操作日志
let configRevision = Date.now()
const OPERATION_KEYS = ['harvest', 'water', 'weed', 'bug', 'fertilize', 'plant', 'steal', 'helpWater', 'helpWeed', 'helpBug', 'taskClaim', 'sell', 'upgrade']
const reloginWatchers = new Map() // key: accountId:loginCode

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatLocalDateTime24(date = new Date()) {
  const d = date instanceof Date ? date : new Date()
  const y = d.getFullYear()
  const m = pad2(d.getMonth() + 1)
  const day = pad2(d.getDate())
  const hh = pad2(d.getHours())
  const mm = pad2(d.getMinutes())
  const ss = pad2(d.getSeconds())
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`
}

// 打包后 worker 由当前可执行文件以 --worker 模式启动
const isWorkerProcess = process.env.FARM_WORKER === '1'
if (isWorkerProcess) {
  require('./src/core/worker')
}

function nextConfigRevision() {
  configRevision += 1
  return configRevision
}

function buildConfigSnapshot() {
  return buildConfigSnapshotForAccount('')
}

function buildConfigSnapshotForAccount(accountId) {
  return {
    automation: store.getAutomation(accountId),
    plantingStrategy: store.getPlantingStrategy(accountId),
    preferredSeedId: store.getPreferredSeed(accountId),
    intervals: store.getIntervals(accountId),
    friendQuietHours: store.getFriendQuietHours(accountId),
    __revision: configRevision,
  }
}

function broadcastConfigToWorkers(targetAccountId = '') {
  const targetId = String(targetAccountId || '').trim()
  for (const [accId, worker] of Object.entries(workers)) {
    if (targetId && String(accId) !== targetId)
      continue
    const snapshot = buildConfigSnapshotForAccount(accId)
    try {
      worker.process.send({ type: 'config_sync', config: snapshot })
    }
    catch (e) {
      // ignore
    }
  }
}

function log(tag, msg, extra = {}) {
  const time = formatLocalDateTime24(new Date())
  console.log(`[${tag}] ${msg}`)
  const moduleName = (tag === '系统' || tag === '错误') ? 'system' : ''
  const entry = {
    time,
    tag,
    msg,
    meta: moduleName ? { module: moduleName } : {},
    ts: Date.now(),
    ...extra,
  }
  entry._searchText = `${entry.msg || ''} ${entry.tag || ''} ${JSON.stringify(entry.meta || {})}`.toLowerCase()
  GLOBAL_LOGS.push(entry)
  if (GLOBAL_LOGS.length > 1000)
    GLOBAL_LOGS.shift()
}

function addAccountLog(action, msg, accountId = '', accountName = '', extra = {}) {
  const entry = {
    time: formatLocalDateTime24(new Date()),
    action,
    msg,
    accountId: accountId ? String(accountId) : '',
    accountName: accountName || '',
    ...extra,
  }
  ACCOUNT_LOGS.push(entry)
  if (ACCOUNT_LOGS.length > 300)
    ACCOUNT_LOGS.shift()
}

async function triggerOfflineReminder(payload = {}) {
  try {
    const cfg = store.getOfflineReminder ? store.getOfflineReminder() : null
    if (!cfg)
      return

    const channelName = String(cfg.channel || '').trim().toLowerCase()
    const reloginUrlMode = String(cfg.reloginUrlMode || 'none').trim().toLowerCase()
    const endpoint = String(cfg.endpoint || '').trim()
    const channel = channelName
    const token = String(cfg.token || '').trim()
    const baseTitle = String(cfg.title || '').trim()
    const accountName = String(payload.accountName || payload.accountId || '').trim()
    const title = accountName ? `${baseTitle} ${accountName}` : baseTitle
    let content = String(cfg.msg || '').trim()
    if (!channel || !token || !title || !content)
      return
    if (channel === 'webhook' && !endpoint)
      return
    if (reloginUrlMode === 'qq_link' || reloginUrlMode === 'qr_link') {
      try {
        const qr = await MiniProgramLoginSession.requestLoginCode()
        const loginCode = String((qr && qr.code) || '').trim()
        const qqUrl = String((qr && (qr.url || qr.loginUrl)) || '').trim()
        const qrCodeUrl = String((qr && qr.qrcode) || '').trim()
        if (qqUrl) {
          if (reloginUrlMode === 'qq_link') {
            content = `${content}\n\n重登录链接: ${qqUrl}`
          }
          else {
            const qrcodeText = qrCodeUrl || qqUrl
            content = `${content}\n\n重登录二维码链接: ${qrcodeText}`
          }
        }
        if (loginCode) {
          startReloginWatcher({
            loginCode,
            accountId: String(payload.accountId || '').trim(),
            accountName: String(payload.accountName || '').trim(),
          })
        }
      }
      catch (e) {
        log('错误', `获取重登录链接失败: ${e.message}`)
      }
    }

    const ret = await sendPushooMessage({
      channel,
      endpoint,
      token,
      title,
      content,
    })

    if (ret && ret.ok) {
      const accountName = String(payload.accountName || payload.accountId || '')
      log('系统', `下线提醒发送成功: ${accountName}`)
    }
    else {
      log('错误', `下线提醒发送失败: ${ret && ret.msg ? ret.msg : 'unknown'}`)
    }
  }
  catch (e) {
    log('错误', `下线提醒发送异常: ${e.message}`)
  }
}

function startReloginWatcher({ loginCode, accountId = '', accountName = '' }) {
  const code = String(loginCode || '').trim()
  if (!code)
    return
  const key = `${accountId || 'unknown'}:${code}`
  if (reloginWatchers.has(key))
    return
  reloginWatchers.set(key, { startedAt: Date.now() })
  log('系统', `已启动重登录监听: ${accountName || accountId || '未知账号'}`, { accountId: String(accountId || ''), accountName: accountName || '' })

  let stopped = false
  const stop = () => {
    if (stopped)
      return
    stopped = true
    reloginWatchers.delete(key)
  };

  (async () => {
    const maxRounds = 120 // ~2分钟
    for (let i = 0; i < maxRounds; i += 1) {
      try {
        const status = await MiniProgramLoginSession.queryStatus(code)
        if (!status || status.status === 'Wait') {
          await sleep(1000)
          continue
        }
        if (status.status === 'Used') {
          log('系统', `重登录二维码已失效: ${accountName || accountId || '未知账号'}`, { accountId: String(accountId || ''), accountName: accountName || '' })
          stop()
          return
        }
        if (status.status === 'OK') {
          const ticket = String(status.ticket || '').trim()
          const uin = String(status.uin || '').trim()
          if (!ticket) {
            log('错误', `重登录监听失败: ticket 为空`)
            stop()
            return
          }
          const authCode = await MiniProgramLoginSession.getAuthCode(ticket, '1112386029')
          if (!authCode) {
            log('错误', `重登录监听失败: 未获取到新 code`)
            stop()
            return
          }
          applyReloginCode({ accountId, accountName, authCode, uin })
          stop()
          return
        }
        await sleep(1000)
      }
      catch (e) {
        await sleep(1000)
      }
    }
    log('系统', `重登录监听超时: ${accountName || accountId || '未知账号'}`, { accountId: String(accountId || ''), accountName: accountName || '' })
    stop()
  })()
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms | 0)))
}

function applyReloginCode({ accountId = '', accountName = '', authCode = '', uin = '' }) {
  const code = String(authCode || '').trim()
  if (!code)
    return
  const data = getAccounts()
  const list = Array.isArray(data.accounts) ? data.accounts : []
  const found = list.find(a => String(a.id) === String(accountId))
  const avatar = uin ? `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640` : ''

  if (found) {
    addOrUpdateAccount({
      id: found.id,
      name: found.name,
      code,
      platform: found.platform || 'qq',
      qq: uin || found.qq || found.uin || '',
      uin: uin || found.uin || found.qq || '',
      avatar: avatar || found.avatar || '',
    })
    restartWorker({
      ...found,
      code,
      qq: uin || found.qq || found.uin || '',
      uin: uin || found.uin || found.qq || '',
      avatar: avatar || found.avatar || '',
    })
    addAccountLog('update', `重登录成功，已更新账号: ${found.name}`, found.id, found.name, { reason: 'relogin' })
    log('系统', `重登录成功，账号已更新并重启: ${found.name}`)
    return
  }

  const created = addOrUpdateAccount({
    name: accountName || (uin ? String(uin) : '重登录账号'),
    code,
    platform: 'qq',
    qq: uin || '',
    uin: uin || '',
    avatar,
  })
  const newAcc = (created.accounts || [])[created.accounts.length - 1]
  if (newAcc) {
    startWorker(newAcc)
    addAccountLog('add', `重登录成功，已新增账号: ${newAcc.name}`, newAcc.id, newAcc.name, { reason: 'relogin' })
    log('系统', `重登录成功，已新增账号并启动: ${newAcc.name}`, { accountId: String(newAcc.id), accountName: newAcc.name })
  }
}

function getOfflineAutoDeleteMs() {
  const cfg = store.getOfflineReminder ? store.getOfflineReminder() : null
  const sec = Math.max(1, Number.parseInt(cfg && cfg.offlineDeleteSec, 10) || 120)
  return sec * 1000
}

function normalizeStatusForPanel(data, accountId, accountName) {
  const src = (data && typeof data === 'object') ? data : {}
  const ops = (src.operations && typeof src.operations === 'object') ? { ...src.operations } : {}
  for (const k of OPERATION_KEYS) {
    if (ops[k] === undefined || ops[k] === null || Number.isNaN(Number(ops[k]))) {
      ops[k] = 0
    }
    else {
      ops[k] = Number(ops[k])
    }
  }
  return {
    ...src,
    accountId,
    accountName,
    operations: ops,
  }
}

function buildDefaultOperations() {
  const ops = {}
  for (const k of OPERATION_KEYS) ops[k] = 0
  return ops
}

function buildDefaultStatus(accountId) {
  return {
    connection: { connected: false },
    status: { name: '', level: 0, gold: 0, exp: 0, platform: 'qq' },
    uptime: 0,
    operations: buildDefaultOperations(),
    sessionExpGained: 0,
    sessionGoldGained: 0,
    sessionCouponGained: 0,
    lastExpGain: 0,
    lastGoldGain: 0,
    limits: {},
    wsError: null,
    automation: store.getAutomation(accountId),
    preferredSeed: store.getPreferredSeed(accountId),
    expProgress: { current: 0, needed: 0, level: 0 },
    configRevision,
    accountId: String(accountId || ''),
  }
}

function filterLogs(list, filters = {}) {
  const f = filters || {}
  const keyword = String(f.keyword || '').trim().toLowerCase()
  const keywordTerms = keyword ? keyword.split(/\s+/).filter(Boolean) : []
  const tag = String(f.tag || '').trim()
  const moduleName = String(f.module || '').trim()
  const eventName = String(f.event || '').trim()
  const isWarn = f.isWarn
  const timeFromMs = f.timeFrom ? Date.parse(String(f.timeFrom)) : Number.NaN
  const timeToMs = f.timeTo ? Date.parse(String(f.timeTo)) : Number.NaN
  return (list || []).filter((l) => {
    const logMs = Number(l && l.ts) || Date.parse(String((l && l.time) || ''))
    if (Number.isFinite(timeFromMs) && Number.isFinite(logMs) && logMs < timeFromMs)
      return false
    if (Number.isFinite(timeToMs) && Number.isFinite(logMs) && logMs > timeToMs)
      return false
    if (tag && String(l.tag || '') !== tag)
      return false
    if (moduleName) {
      const logModule = String((l.meta || {}).module || '')
      // 兼容历史主进程日志：仅有 tag=系统/错误，没有 meta.module
      if (moduleName === 'system') {
        const isSystemTag = String(l.tag || '') === '系统' || String(l.tag || '') === '错误'
        if (logModule !== 'system' && !isSystemTag)
          return false
      }
      else if (logModule !== moduleName) {
        return false
      }
    }
    if (eventName && String((l.meta || {}).event || '') !== eventName)
      return false
    if (isWarn !== undefined && isWarn !== null && String(isWarn) !== '') {
      const expected = String(isWarn) === '1' || String(isWarn).toLowerCase() === 'true'
      if (!!l.isWarn !== expected)
        return false
    }
    if (keywordTerms.length > 0) {
      const text = String(l._searchText || `${l.msg || ''} ${l.tag || ''}`).toLowerCase()
      for (const term of keywordTerms) {
        if (!text.includes(term))
          return false
      }
    }
    return true
  })
}

// ============ Bot 进程管理 ============

function startWorker(account) {
  if (workers[account.id])
    return // 已运行

  log('系统', `正在启动账号: ${account.name}`, { accountId: String(account.id), accountName: account.name })

  let child = null
  if (process.pkg) {
    // 打包后也走 fork + execPath，确保 IPC 通道可用
    child = fork(__filename, [], {
      execPath: process.execPath,
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, FARM_WORKER: '1', FARM_ACCOUNT_ID: String(account.id || '') },
    })
  }
  else {
    const workerPath = path.join(__dirname, 'src', 'core', 'worker.js')
    child = fork(workerPath, [], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, FARM_ACCOUNT_ID: String(account.id || '') },
    })
  }

  workers[account.id] = {
    process: child,
    status: null, // 最新状态快照
    logs: [],
    requests: new Map(), // pending API requests
    reqId: 1,
    name: account.name,
    stopping: false,
    disconnectedSince: 0,
    autoDeleteTriggered: false,
    wsError: null,
  }

  // 发送启动指令
  child.send({
    type: 'start',
    config: {
      code: account.code,
      platform: account.platform,
    },
  })
  child.send({ type: 'config_sync', config: buildConfigSnapshotForAccount(account.id) })

  // 监听消息
  child.on('message', (msg) => {
    handleWorkerMessage(account.id, msg)
  })

  child.on('error', (err) => {
    log('系统', `账号 ${account.name} 子进程启动失败: ${err && err.message ? err.message : err}`, { accountId: String(account.id), accountName: account.name })
  })

  child.on('exit', (code, signal) => {
    const current = workers[account.id]
    const displayName = (current && current.name) || account.name
    log('系统', `账号 ${displayName} 进程退出 (code=${code}, signal=${signal || 'none'})`, { accountId: String(account.id), accountName: displayName })

    if (current && current.process === child) {
      delete workers[account.id]
    }
  })
}

function stopWorker(accountId) {
  const worker = workers[accountId]
  if (worker) {
    const proc = worker.process
    worker.stopping = true
    worker.process.send({ type: 'stop' })
    // process.kill will happen in 'exit' handler or we can force it
    setTimeout(() => {
      const current = workers[accountId]
      if (current && current.process === proc) {
        current.process.kill()
        delete workers[accountId]
      }
    }, 1000)
  }
}

function restartWorker(account) {
  if (!account)
    return
  const accountId = account.id
  const worker = workers[accountId]
  if (!worker)
    return startWorker(account)
  const proc = worker.process
  let started = false
  const startOnce = () => {
    if (started)
      return
    started = true
    const current = workers[accountId]
    if (!current)
      return startWorker(account)
    if (current.process !== proc)
      return
    delete workers[accountId]
    startWorker(account)
  }
  const killIfStale = () => {
    const current = workers[accountId]
    if (!current || current.process !== proc)
      return false
    try {
      current.process.kill()
    }
    catch (e) {}
    delete workers[accountId]
    return true
  }
  if (proc.exitCode !== null || proc.signalCode) {
    return startOnce()
  }
  proc.once('exit', startOnce)
  stopWorker(accountId)
  setTimeout(() => {
    if (started)
      return
    killIfStale()
    startOnce()
  }, 1500)
}

function handleWorkerMessage(accountId, msg) {
  const worker = workers[accountId]
  if (!worker)
    return

  if (msg.type === 'status_sync') {
    // 合并状态
    worker.status = normalizeStatusForPanel(msg.data, accountId, worker.name)

    // 尝试更新昵称到 store
    if (msg.data && msg.data.status && msg.data.status.name) {
      const newNick = String(msg.data.status.name).trim()
      // 忽略无效昵称
      if (newNick && newNick !== '未知' && newNick !== '未登录') {
        // 避免频繁写入，只在内存中无昵称或不一致时更新
        if (worker.name !== newNick) {
          const oldName = worker.name
          worker.name = newNick
          addOrUpdateAccount({
            id: accountId,
            name: newNick,
          })
          // 仅在首次同步或名称变更时记录日志
          if (oldName !== newNick) {
            log('系统', `已同步账号昵称: ${oldName} -> ${newNick}`, { accountId, accountName: newNick })
          }
        }
      }
    }

    const connected = !!(msg.data && msg.data.connection && msg.data.connection.connected)
    if (connected) {
      worker.disconnectedSince = 0
      worker.autoDeleteTriggered = false
      worker.wsError = null
    }
    else if (!worker.stopping) {
      const now = Date.now()
      if (!worker.disconnectedSince)
        worker.disconnectedSince = now
      const offlineMs = now - worker.disconnectedSince
      const autoDeleteMs = getOfflineAutoDeleteMs()
      if (!worker.autoDeleteTriggered && offlineMs >= autoDeleteMs) {
        worker.autoDeleteTriggered = true
        const offlineMin = Math.floor(offlineMs / 60000)
        log('系统', `账号 ${worker.name} 持续离线 ${offlineMin} 分钟，自动删除账号信息`)
        triggerOfflineReminder({
          accountId,
          accountName: worker.name,
          reason: 'offline_timeout',
          offlineMs,
        })
        addAccountLog(
          'offline_delete',
          `账号 ${worker.name} 持续离线 ${offlineMin} 分钟，已自动删除`,
          accountId,
          worker.name,
          { reason: 'offline_timeout', offlineMs },
        )
        stopWorker(accountId)
        try {
          deleteAccount(accountId)
        }
        catch (e) {
          log('错误', `删除离线账号失败: ${e.message}`)
        }
      }
    }
  }
  else if (msg.type === 'log') {
    // 保存日志
    const logEntry = {
      ...msg.data,
      accountId,
      accountName: worker.name,
      ts: Date.now(),
      meta: msg.data && msg.data.meta ? msg.data.meta : {},
    }
    logEntry._searchText = `${logEntry.msg || ''} ${logEntry.tag || ''} ${JSON.stringify(logEntry.meta || {})}`.toLowerCase()
    worker.logs.push(logEntry)
    if (worker.logs.length > 1000)
      worker.logs.shift()
    GLOBAL_LOGS.push(logEntry)
    if (GLOBAL_LOGS.length > 1000)
      GLOBAL_LOGS.shift()
  }
  else if (msg.type === 'error') {
    log('错误', `账号[${accountId}]进程报错: ${msg.error}`, { accountId: String(accountId), accountName: worker.name })
  }
  else if (msg.type === 'ws_error') {
    const code = Number(msg.code) || 0
    const message = msg.message || ''
    worker.wsError = { code, message, at: Date.now() }
    if (code === 400) {
      addAccountLog(
        'ws_400',
        `账号 ${worker.name} 登录失效，请更新 Code`,
        accountId,
        worker.name,
      )
    }
  }
  else if (msg.type === 'account_kicked') {
    const reason = msg.reason || '未知'
    log('系统', `账号 ${worker.name} 被踢下线，已自动停止账号`, { accountId: String(accountId), accountName: worker.name })
    triggerOfflineReminder({
      accountId,
      accountName: worker.name,
      reason: `kickout:${reason}`,
      offlineMs: 0,
    })
    addAccountLog('kickout_stop', `账号 ${worker.name} 被踢下线，已自动停止`, accountId, worker.name, { reason })
    stopWorker(accountId)
  }
  else if (msg.type === 'api_response') {
    const { id, result, error } = msg
    const req = worker.requests.get(id)
    if (req) {
      if (error)
        req.reject(new Error(error))
      else req.resolve(result)
      worker.requests.delete(id)
    }
  }
}

// 代理 API 调用到子进程
function callWorkerApi(accountId, method, ...args) {
  const worker = workers[accountId]
  if (!worker)
    return Promise.reject(new Error('账号未运行'))

  return new Promise((resolve, reject) => {
    const id = worker.reqId++
    worker.requests.set(id, { resolve, reject })

    // 超时处理
    setTimeout(() => {
      if (worker.requests.has(id)) {
        worker.requests.delete(id)
        reject(new Error('API Timeout'))
      }
    }, 10000)

    worker.process.send({ type: 'api_call', id, method, args })
  })
}

// ============ Data Provider for Admin Server ============
// 这是一个适配器，让 admin.js 可以通过统一接口获取数据
const dataProvider = {
  // 获取指定账号的状态 (如果 accountId 为空，返回概览?)
  getStatus: (accountId) => {
    if (!accountId)
      return buildDefaultStatus('')
    const w = workers[accountId]
    if (!w || !w.status)
      return buildDefaultStatus(accountId)
    return {
      ...buildDefaultStatus(accountId),
      ...normalizeStatusForPanel(w.status, accountId, w.name),
      wsError: w.wsError || null,
    }
  },

  getLogs: (accountId, optionsOrLimit) => {
    const opts = (typeof optionsOrLimit === 'object' && optionsOrLimit) ? optionsOrLimit : { limit: optionsOrLimit }
    const max = Math.max(1, Number(opts.limit) || 100)
    if (!accountId) {
      return filterLogs(GLOBAL_LOGS, opts).slice(-max)
    }
    const accId = String(accountId)
    return filterLogs(GLOBAL_LOGS.filter(l => String(l.accountId || '') === accId), opts).slice(-max)
  },
  getAccountLogs: limit => ACCOUNT_LOGS.slice(-limit).reverse(),
  addAccountLog: (action, msg, accountId, accountName, extra) => addAccountLog(action, msg, accountId, accountName, extra),

  // 透传方法
  getLands: accountId => callWorkerApi(accountId, 'getLands'),
  getFriends: accountId => callWorkerApi(accountId, 'getFriends'),
  getFriendLands: (accountId, gid) => callWorkerApi(accountId, 'getFriendLands', gid),
  doFriendOp: (accountId, gid, opType) => callWorkerApi(accountId, 'doFriendOp', gid, opType),
  getBag: accountId => callWorkerApi(accountId, 'getBag'),
  getDailyGifts: accountId => callWorkerApi(accountId, 'getDailyGiftOverview'),
  getSeeds: accountId => callWorkerApi(accountId, 'getSeeds'),

  setAutomation: async (accountId, key, value) => {
    store.setAutomation(key, value, accountId)
    const rev = nextConfigRevision()
    broadcastConfigToWorkers(accountId)
    return { automation: store.getAutomation(accountId), configRevision: rev }
  },

  doFarmOp: (accountId, opType) => callWorkerApi(accountId, 'doFarmOp', opType),
  doAnalytics: (accountId, sortBy) => callWorkerApi(accountId, 'getAnalytics', sortBy),
  saveSettings: async (accountId, payload) => {
    const body = (payload && typeof payload === 'object') ? payload : {}
    const snapshot = {
      plantingStrategy: body.strategy,
      preferredSeedId: body.seedId,
      intervals: body.intervals,
      friendQuietHours: body.friendQuietHours,
    }
    store.applyConfigSnapshot(snapshot, { accountId })
    const rev = nextConfigRevision()
    broadcastConfigToWorkers(accountId)
    return {
      strategy: store.getPlantingStrategy(accountId),
      preferredSeed: store.getPreferredSeed(accountId),
      intervals: store.getIntervals(accountId),
      friendQuietHours: store.getFriendQuietHours(accountId),
      configRevision: rev,
    }
  },
  setUITheme: async (theme) => {
    const snapshot = store.setUITheme(theme)
    return { ui: snapshot.ui || store.getUI() }
  },
  // 账号管理直接操作 store
  getAccounts: () => {
    const data = getAccounts()
    // 注入运行状态
    data.accounts.forEach((a) => {
      const worker = workers[a.id]
      a.running = !!worker
      if (worker && worker.status && worker.status.status && worker.status.status.name) {
        a.nick = worker.status.status.name
      }
    })
    return data
  },

  startAccount: (id) => {
    const data = getAccounts()
    const acc = data.accounts.find(a => a.id === id)
    if (acc)
      startWorker(acc)
  },

  stopAccount: id => stopWorker(id),
  restartAccount: (id) => {
    const data = getAccounts()
    const acc = data.accounts.find(a => a.id === id)
    if (acc)
      restartWorker(acc)
  },
  isAccountRunning: accountId => !!workers[accountId],
}

// ============ 主入口 ============
async function main() {
  console.log('正在启动 QQ农场多账号管理服务...')

  // 1. 启动 Admin Server
  startAdminServer(dataProvider)

  // 2. 自动启动所有账号 (可选，目前默认不自动启动，或者读取配置)
  const accounts = getAccounts().accounts || []
  if (accounts.length > 0) {
    log('系统', `发现 ${accounts.length} 个账号，正在启动...`)
    accounts.forEach(acc => startWorker(acc))
  }
  else {
    log('系统', '未发现账号，请访问管理面板添加账号')
  }
}

if (!isWorkerProcess) {
  main().catch(err => console.error(err))
}
