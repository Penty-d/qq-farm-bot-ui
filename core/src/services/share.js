/**
 * 分享奖励
 */

const { sendMsgAsync } = require('../utils/network')
const { types } = require('../utils/proto')
const { log, toNum } = require('../utils/utils')

const DAILY_KEY = 'daily_share'
const CHECK_COOLDOWN_MS = 10 * 60 * 1000

let doneDateKey = ''
let lastCheckAt = 0
let lastClaimAt = 0

function getDateKey() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function markDoneToday() {
  doneDateKey = getDateKey()
}

function isDoneToday() {
  return doneDateKey === getDateKey()
}

function getRewardSummary(items) {
  const list = Array.isArray(items) ? items : []
  const summary = []
  for (const it of list) {
    const id = toNum(it.id)
    const count = toNum(it.count)
    if (count <= 0)
      continue
    if (id === 1 || id === 1001)
      summary.push(`金币${count}`)
    else if (id === 2 || id === 1101)
      summary.push(`经验${count}`)
    else if (id === 1002)
      summary.push(`点券${count}`)
    else summary.push(`物品#${id}x${count}`)
  }
  return summary.join('/')
}

function isAlreadyClaimedError(err) {
  const msg = String((err && err.message) || '')
  return msg.includes('code=1009001') || msg.includes('已经领取')
}

async function checkCanShare() {
  const body = types.CheckCanShareRequest.encode(types.CheckCanShareRequest.create({})).finish()
  const { body: replyBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'CheckCanShare', body)
  return types.CheckCanShareReply.decode(replyBody)
}

async function reportShare() {
  const body = types.ReportShareRequest.encode(types.ReportShareRequest.create({ shared: true })).finish()
  const { body: replyBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'ReportShare', body)
  return types.ReportShareReply.decode(replyBody)
}

async function claimShareReward() {
  const body = types.ClaimShareRewardRequest.encode(types.ClaimShareRewardRequest.create({ claimed: true })).finish()
  const { body: replyBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'ClaimShareReward', body)
  return types.ClaimShareRewardReply.decode(replyBody)
}

async function performDailyShare(force = false) {
  const now = Date.now()
  if (!force && isDoneToday())
    return false
  if (!force && now - lastCheckAt < CHECK_COOLDOWN_MS)
    return false
  lastCheckAt = now
  try {
    const can = await checkCanShare()
    if (!can || !can.can_share) {
      markDoneToday()
      log('分享', '今日暂无可领取分享礼包', {
        module: 'task',
        event: DAILY_KEY,
        result: 'none',
      })
      return false
    }
    const report = await reportShare()
    if (!report || !report.success) {
      log('分享', '上报分享状态失败', {
        module: 'task',
        event: DAILY_KEY,
        result: 'error',
      })
      return false
    }
    let rep = null
    try {
      rep = await claimShareReward()
    }
    catch (e) {
      if (isAlreadyClaimedError(e)) {
        markDoneToday()
        log('分享', '今日分享奖励已领取', {
          module: 'task',
          event: DAILY_KEY,
          result: 'none',
        })
        return false
      }
      throw e
    }
    if (!rep || !rep.success) {
      log('分享', '领取分享礼包失败', {
        module: 'task',
        event: DAILY_KEY,
        result: 'error',
      })
      return false
    }
    const items = Array.isArray(rep.items) ? rep.items : []
    const reward = getRewardSummary(items)
    log('分享', reward ? `领取成功 → ${reward}` : '领取成功', {
      module: 'task',
      event: DAILY_KEY,
      result: 'ok',
      count: items.length,
    })
    lastClaimAt = Date.now()
    markDoneToday()
    return true
  }
  catch (e) {
    log('分享', `领取失败: ${e.message}`, {
      module: 'task',
      event: DAILY_KEY,
      result: 'error',
    })
    return false
  }
}

module.exports = {
  performDailyShare,
  getShareDailyState: () => ({
    key: DAILY_KEY,
    doneToday: isDoneToday(),
    lastCheckAt,
    lastClaimAt,
  }),
}
