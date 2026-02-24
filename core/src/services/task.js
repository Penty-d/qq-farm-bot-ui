/**
 * 任务系统 - 自动领取任务奖励
 */

const { isAutomationOn } = require('../models/store')
const { sendMsgAsync, networkEvents } = require('../utils/network')
const { types } = require('../utils/proto')
const { toLong, toNum, log, logWarn, sleep } = require('../utils/utils')
const { recordOperation } = require('./stats')

let initTimer = null
let claimTimer = null
let checking = false
let taskClaimDoneDateKey = ''
let taskClaimLastAt = 0

function getDateKey() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ============ 任务 API ============

async function getTaskInfo() {
  const body = types.TaskInfoRequest.encode(types.TaskInfoRequest.create({})).finish()
  const { body: replyBody } = await sendMsgAsync('gamepb.taskpb.TaskService', 'TaskInfo', body)
  return types.TaskInfoReply.decode(replyBody)
}

async function claimTaskReward(taskId, doShared = false) {
  const body = types.ClaimTaskRewardRequest.encode(types.ClaimTaskRewardRequest.create({
    id: toLong(taskId),
    do_shared: doShared,
  })).finish()
  const { body: replyBody } = await sendMsgAsync('gamepb.taskpb.TaskService', 'ClaimTaskReward', body)
  return types.ClaimTaskRewardReply.decode(replyBody)
}

async function claimDailyReward(type, pointIds) {
  if (!types.ClaimDailyRewardRequest || !types.ClaimDailyRewardReply) {
    return { items: [] }
  }
  const body = types.ClaimDailyRewardRequest.encode(types.ClaimDailyRewardRequest.create({
    type: Number(type) || 0,
    point_ids: (pointIds || []).map(id => toLong(id)),
  })).finish()
  const { body: replyBody } = await sendMsgAsync('gamepb.taskpb.TaskService', 'ClaimDailyReward', body)
  return types.ClaimDailyRewardReply.decode(replyBody)
}

async function claimAllIllustratedRewards() {
  if (!types.ClaimAllRewardsV2Request || !types.ClaimAllRewardsV2Reply) {
    return { items: [], bonus_items: [] }
  }
  const body = types.ClaimAllRewardsV2Request.encode(types.ClaimAllRewardsV2Request.create({
    only_claimable: true,
  })).finish()
  const { body: replyBody } = await sendMsgAsync('gamepb.illustratedpb.IllustratedService', 'ClaimAllRewardsV2', body)
  return types.ClaimAllRewardsV2Reply.decode(replyBody)
}

async function getTicketBalanceFromBag() {
  try {
    const { getBag, getBagItems } = require('./warehouse')
    const rep = await getBag()
    const items = getBagItems(rep)
    for (const it of (items || [])) {
      if (toNum(it && it.id) === 1002)
        return Math.max(0, toNum(it && it.count))
    }
    return 0
  }
  catch (e) {
    return 0
  }
}

// ============ 任务分析 ============

function formatTask(t, category = 'main') {
  return {
    id: toNum(t.id),
    desc: t.desc || `任务#${toNum(t.id)}`,
    category,
    progress: toNum(t.progress),
    totalProgress: toNum(t.total_progress),
    isClaimed: t.is_claimed,
    isUnlocked: t.is_unlocked,
    shareMultiple: toNum(t.share_multiple),
    rewards: (t.rewards || []).map(r => ({ id: toNum(r.id), count: toNum(r.count) })),
    canClaim: t.is_unlocked && !t.is_claimed && toNum(t.progress) >= toNum(t.total_progress) && toNum(t.total_progress) > 0,
  }
}

/**
 * 获取所有任务列表（供前端展示）
 */
async function getAllTasks() {
  try {
    const reply = await getTaskInfo()
    if (!reply.task_info)
      return {}

    const ti = reply.task_info
    return {
      daily: (ti.daily_tasks || []).map(formatTask),
      growth: (ti.growth_tasks || []).map(formatTask),
      main: (ti.tasks || []).map(formatTask),
    }
  }
  catch (e) {
    logWarn('任务', `获取列表失败: ${e.message}`, {
      module: 'task',
      event: 'task_list',
      result: 'error',
    })
    return {}
  }
}

/**
 * 分析任务列表，找出可领取的任务
 */
function analyzeTaskList(tasks, category = 'main') {
  const claimable = []
  for (const task of tasks) {
    const t = formatTask(task, category)
    if (t.canClaim) {
      claimable.push(t)
    }
  }
  return claimable
}

/**
 * 计算奖励摘要
 */
function getRewardSummary(items) {
  const summary = []
  for (const item of items) {
    const id = toNum(item.id)
    const count = toNum(item.count)
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

function buildDailyTasksForDebug(taskInfo) {
  const ti = taskInfo && typeof taskInfo === 'object' ? taskInfo : {}
  const dailyList = Array.isArray(ti.daily_tasks) ? ti.daily_tasks : []
  if (dailyList.length > 0)
    return dailyList
  const merged = [
    ...(Array.isArray(ti.tasks) ? ti.tasks : []),
    ...(Array.isArray(ti.growth_tasks) ? ti.growth_tasks : []),
  ]
  return merged.filter(t => toNum(t && t.task_type) === 2)
}

async function checkAndClaimActives(actives) {
  const list = Array.isArray(actives) ? actives : []
  let scanned = 0
  let claimed = 0
  let errors = 0
  for (const active of list) {
    const activeType = toNum(active.type)
    const rewards = active.rewards || []
    const claimable = rewards.filter(r => toNum(r.status) === 2)
    if (!claimable.length)
      continue
    scanned += claimable.length
    const pointIds = claimable.map(r => toNum(r.point_id)).filter(n => n > 0)
    if (!pointIds.length)
      continue
    const typeName = activeType === 1 ? '日活跃' : (activeType === 2 ? '周活跃' : `活跃${activeType}`)
    try {
      log('活跃', `${typeName} 发现 ${pointIds.length} 个可领取奖励`, {
        module: 'task',
        event: 'active_scan',
        result: 'ok',
        activeType,
        count: pointIds.length,
      })
      const reply = await claimDailyReward(activeType, pointIds)
      const items = reply.items || []
      if (items.length > 0) {
        log('活跃', `${typeName} 领取: ${getRewardSummary(items)}`, {
          module: 'task',
          event: 'active_claim',
          result: 'ok',
          activeType,
          count: items.length,
        })
      }
      claimed += pointIds.length
      await sleep(300)
    }
    catch (e) {
      errors += 1
      log('活跃', `${typeName} 领取失败: ${e.message}`, {
        module: 'task',
        event: 'active_claim',
        result: 'error',
        activeType,
      })
    }
  }
  return { scanned, claimed, errors }
}

async function checkAndClaimIllustratedRewards() {
  try {
    const beforeTicket = await getTicketBalanceFromBag()
    const reply = await claimAllIllustratedRewards()
    const items = [
      ...(Array.isArray(reply && reply.items) ? reply.items : []),
      ...(Array.isArray(reply && reply.bonus_items) ? reply.bonus_items : []),
    ]
    const afterTicket = await getTicketBalanceFromBag()
    const gainTicket = Math.max(0, afterTicket - beforeTicket)
    if (gainTicket < 200)
      return false

    log('任务', `领取成功: 点券${gainTicket}`, {
      module: 'task',
      event: 'illustrated_rewards',
      result: 'ok',
      scope: 'illustrated',
      count: items.length,
    })
    taskClaimDoneDateKey = getDateKey()
    taskClaimLastAt = Date.now()
    recordOperation('taskClaim', 1)
    return true
  }
  catch (e) {
    return false
  }
}

// ============ 自动领取 ============

async function checkAndClaimTasks() {
  if (checking)
    return
  if (!isAutomationOn('task'))
    return
  checking = true
  try {
    const reply = await getTaskInfo()
    if (!reply.task_info)
      return

    const taskInfo = reply.task_info
    const dailyAll = buildDailyTasksForDebug(taskInfo)

    const dailyClaimable = analyzeTaskList(dailyAll, 'daily')
    const growthClaimable = analyzeTaskList(taskInfo.growth_tasks || [], 'growth')
    const mainClaimable = analyzeTaskList(taskInfo.tasks || [], 'main')
    const claimable = [...dailyClaimable, ...growthClaimable, ...mainClaimable]
    if (claimable.length > 0) {
      log('任务', `发现 ${claimable.length} 个可领取任务`, {
        module: 'task',
        event: 'task_scan',
        result: 'ok',
        count: claimable.length,
      })
      if (dailyClaimable.length > 0) {
        log('任务', `每日任务可领取: ${dailyClaimable.map(t => t.desc).join('，')}`, {
          module: 'task',
          event: 'task_scan',
          result: 'ok',
          count: dailyClaimable.length,
          scope: 'daily',
        })
      }
      let dailyClaimSuccess = 0
      for (const task of claimable) {
        const ok = await doClaim(task)
        if (task.category === 'daily' && ok)
          dailyClaimSuccess += 1
      }
      if (dailyClaimable.length > 0 && dailyClaimSuccess === 0) {
        log('任务', '每日任务本次未领取成功', {
          module: 'task',
          event: 'task_claim',
          result: 'none',
          scope: 'daily',
        })
      }
    }
    await checkAndClaimActives(taskInfo.actives || [])
    await checkAndClaimIllustratedRewards()
  }
  catch (e) {
    logWarn('任务', `检查任务失败: ${e.message}`, {
      module: 'task',
      event: 'task_scan',
      result: 'error',
    })
  }
  finally {
    checking = false
  }
}

async function doClaim(task) {
  try {
    const useShare = task.shareMultiple > 1
    const multipleStr = useShare ? ` (${task.shareMultiple}倍)` : ''

    const claimReply = await claimTaskReward(task.id, useShare)
    const items = claimReply.items || []
    const rewardStr = items.length > 0 ? getRewardSummary(items) : '无'

    const categoryName = task.category === 'daily' ? '每日任务' : (task.category === 'growth' ? '成长任务' : '任务')
    log('任务', `领取(${categoryName}): ${task.desc}${multipleStr} → ${rewardStr}`, {
      module: 'task',
      event: 'task_claim',
      result: 'ok',
      taskId: task.id,
      shared: useShare,
    })
    taskClaimDoneDateKey = getDateKey()
    taskClaimLastAt = Date.now()
    recordOperation('taskClaim', 1)
    await sleep(300)
    return true
  }
  catch (e) {
    // 领取失败静默处理
    return false
  }
}

function onTaskInfoNotify(taskInfo) {
  if (!taskInfo)
    return
  if (!isAutomationOn('task'))
    return

  const claimable = [
    ...analyzeTaskList(taskInfo.daily_tasks || [], 'daily'),
    ...analyzeTaskList(taskInfo.growth_tasks || [], 'growth'),
    ...analyzeTaskList(taskInfo.tasks || [], 'main'),
  ]
  const actives = taskInfo.actives || []
  const hasClaimable = claimable.length > 0
  if (!hasClaimable && actives.length === 0)
    return
  if (hasClaimable) {
    log('任务', `有 ${claimable.length} 个任务可领取，准备自动领取...`, {
      module: 'task',
      event: 'task_claim',
      result: 'plan',
      count: claimable.length,
    })
  }
  if (claimTimer)
    clearTimeout(claimTimer)
  claimTimer = setTimeout(async () => {
    claimTimer = null
    if (hasClaimable)
      await claimTasksFromList(claimable)
    await checkAndClaimActives(actives)
    await checkAndClaimIllustratedRewards()
  }, 1000)
}

async function claimTasksFromList(claimable) {
  if (!isAutomationOn('task'))
    return
  for (const task of claimable) {
    await doClaim(task)
  }
}

// ============ 初始化 ============

function initTaskSystem() {
  cleanupTaskSystem()
  networkEvents.on('taskInfoNotify', onTaskInfoNotify)
  initTimer = setTimeout(() => {
    initTimer = null
    checkAndClaimTasks()
  }, 4000)
}

function cleanupTaskSystem() {
  networkEvents.off('taskInfoNotify', onTaskInfoNotify)
  if (initTimer) {
    clearTimeout(initTimer)
    initTimer = null
  }
  if (claimTimer) {
    clearTimeout(claimTimer)
    claimTimer = null
  }
  checking = false
}

module.exports = {
  checkAndClaimTasks,
  initTaskSystem,
  cleanupTaskSystem,
  getAllTasks,
  claimTaskReward,
  doClaim, // 供手动领取使用
  getTaskClaimDailyState: () => ({
    key: 'task_claim',
    doneToday: taskClaimDoneDateKey === getDateKey(),
    lastClaimAt: taskClaimLastAt,
  }),
  getTaskDailyStateLikeApp: async () => {
    try {
      const reply = await getTaskInfo()
      const ti = reply && reply.task_info ? reply.task_info : {}
      const dailyAll = buildDailyTasksForDebug(ti)
      const completedDaily = dailyAll.filter((t) => {
        const progress = toNum(t && t.progress)
        const totalProgress = toNum(t && t.total_progress)
        return totalProgress > 0 && progress >= totalProgress
      })
      const completedCount = Math.min(3, completedDaily.length)
      const pendingDaily = dailyAll.filter((t) => {
        const isUnlocked = !!(t && t.is_unlocked)
        const isClaimed = !!(t && t.is_claimed)
        const totalProgress = toNum(t && t.total_progress)
        return isUnlocked && !isClaimed && totalProgress > 0
      })
      const dailyClaimable = analyzeTaskList(dailyAll, 'daily')
      return {
        key: 'task_claim',
        // 每日任务总数按 3 计算，完成口径为 progress >= total_progress
        doneToday: completedCount >= 3,
        lastClaimAt: taskClaimLastAt,
        claimableCount: dailyClaimable.length,
        pendingCount: pendingDaily.length,
        completedCount,
        totalCount: 3,
      }
    }
    catch (e) {
      return {
        key: 'task_claim',
        doneToday: false,
        lastClaimAt: taskClaimLastAt,
        claimableCount: 0,
        pendingCount: 0,
        completedCount: 0,
        totalCount: 3,
      }
    }
  },
  getGrowthTaskStateLikeApp: async () => {
    try {
      const reply = await getTaskInfo()
      const ti = reply && reply.task_info ? reply.task_info : {}
      const growthList = Array.isArray(ti.growth_tasks) ? ti.growth_tasks : []
      const tasks = growthList.map((t) => {
        const progress = Math.max(0, toNum(t && t.progress))
        const totalProgress = Math.max(0, toNum(t && t.total_progress))
        const isClaimed = !!(t && t.is_claimed)
        const isUnlocked = !!(t && t.is_unlocked)
        const isCompleted = totalProgress > 0 && progress >= totalProgress
        return {
          id: toNum(t && t.id),
          desc: (t && t.desc) || `成长任务#${toNum(t && t.id)}`,
          progress,
          totalProgress,
          isClaimed,
          isUnlocked,
          isCompleted,
        }
      })
      const totalCount = tasks.length
      const completedCount = tasks.filter(t => t.isCompleted).length
      return {
        key: 'growth_task',
        doneToday: totalCount > 0 && completedCount >= totalCount,
        completedCount,
        totalCount,
        tasks,
      }
    }
    catch (e) {
      return {
        key: 'growth_task',
        doneToday: false,
        completedCount: 0,
        totalCount: 0,
        tasks: [],
      }
    }
  },
}
