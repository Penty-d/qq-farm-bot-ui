/**
 * 邀请码处理模块 - 读取 share.txt 并通过 ReportArkClick 申请好友
 * 注意：此功能仅在微信环境下有效
 *
 * 原理：
 * 1. 首次登录时，游戏会在 LoginRequest 中携带 sharer_id 和 sharer_open_id
 * 2. 已登录状态下点击分享链接，游戏会发送 ReportArkClickRequest
 * 3. 服务器收到后会自动向分享者发送好友申请
 *
 * 我们使用 ReportArkClickRequest 来模拟已登录状态下的分享链接点击
 */

const fs = require('node:fs')
const { CONFIG } = require('../config/config')
const { getShareFilePath } = require('../config/runtime-paths')
const { sendMsgAsync } = require('../utils/network')
const { types } = require('../utils/proto')
const { toLong, log, logWarn, sleep } = require('../utils/utils')

/**
 * 解析分享链接，提取 uid 和 openid
 * 格式: ?uid=xxx&openid=xxx&share_source=xxx&doc_id=xxx
 */
function parseShareLink(link) {
  const result = { uid: null, openid: null, shareSource: null, docId: null }

  // 移除开头的 ? 如果有
  const queryStr = link.startsWith('?') ? link.slice(1) : link

  // 解析参数
  const params = new URLSearchParams(queryStr)
  result.uid = params.get('uid')
  result.openid = params.get('openid')
  result.shareSource = params.get('share_source')
  result.docId = params.get('doc_id')

  return result
}

/**
 * 读取 share.txt 文件并去重
 */
function readShareFile() {
  const shareFilePath = getShareFilePath()

  if (!fs.existsSync(shareFilePath)) {
    return []
  }

  try {
    const content = fs.readFileSync(shareFilePath, 'utf8')
    const lines = content.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && line.includes('openid='))

    const invites = []
    const seenUids = new Set() // 用于去重

    for (const line of lines) {
      const parsed = parseShareLink(line)
      if (parsed.openid && parsed.uid) {
        // 按 uid 去重，同一个用户只处理一次
        if (!seenUids.has(parsed.uid)) {
          seenUids.add(parsed.uid)
          invites.push(parsed)
        }
      }
    }

    return invites
  }
  catch (e) {
    logWarn('邀请', `读取 share.txt 失败: ${e.message}`)
    return []
  }
}

/**
 * 发送 ReportArkClick 请求
 * 模拟已登录状态下点击分享链接，触发服务器向分享者发送好友申请
 */
async function sendReportArkClick(sharerId, sharerOpenId, shareSource) {
  const body = types.ReportArkClickRequest.encode(types.ReportArkClickRequest.create({
    sharer_id: toLong(sharerId),
    sharer_open_id: sharerOpenId,
    share_cfg_id: toLong(shareSource || 0),
    scene_id: '1256', // 模拟微信场景
  })).finish()

  const { body: replyBody } = await sendMsgAsync('gamepb.userpb.UserService', 'ReportArkClick', body)
  return types.ReportArkClickReply.decode(replyBody)
}

// 请求间隔时间（毫秒）
const INVITE_REQUEST_DELAY = 2000

/**
 * 处理邀请码列表
 * 仅在微信环境下执行
 */
async function processInviteCodes() {
  // 检查是否为微信环境
  if (CONFIG.platform !== 'wx') {
    log('邀请', '当前为 QQ 环境，跳过邀请码处理（仅微信支持）')
    return
  }

  const invites = readShareFile()
  if (invites.length === 0) {
    return
  }

  log('邀请', `读取到 ${invites.length} 个邀请码（已去重），开始逐个处理...`)

  let successCount = 0
  let failCount = 0

  for (let i = 0; i < invites.length; i++) {
    const invite = invites[i]

    try {
      // 发送 ReportArkClick 请求，模拟点击分享链接
      await sendReportArkClick(invite.uid, invite.openid, invite.shareSource)
      successCount++
      log('邀请', `[${i + 1}/${invites.length}] 已向 uid=${invite.uid} 发送好友申请`)
    }
    catch (e) {
      failCount++
      logWarn('邀请', `[${i + 1}/${invites.length}] 向 uid=${invite.uid} 发送申请失败: ${e.message}`)
    }

    // 每个请求之间延迟，避免请求过快被限流
    if (i < invites.length - 1) {
      await sleep(INVITE_REQUEST_DELAY)
    }
  }

  log('邀请', `处理完成: 成功 ${successCount}, 失败 ${failCount}`)

  // 处理完成后清空文件
  clearShareFile()
}

/**
 * 清空已处理的邀请码文件
 */
function clearShareFile() {
  const shareFilePath = getShareFilePath()
  try {
    fs.writeFileSync(shareFilePath, '', 'utf8')
    log('邀请', '已清空 share.txt')
  }
  catch (e) {
    // 静默失败
  }
}

module.exports = {
  parseShareLink,
  readShareFile,
  sendReportArkClick,
  processInviteCodes,
  clearShareFile,
}
