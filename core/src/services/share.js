/**
 * 分享奖励
 */

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { log } = require('../utils/utils');
const { getDateKey, getRewardSummary, isAlreadyClaimedError, createDailyCooldown } = require('./common');

const DAILY_KEY = 'daily_share';
const CHECK_COOLDOWN_MS = 10 * 60 * 1000;

let doneDateKey = '';
const lastCheckAt = 0;
let lastClaimAt = 0;

const dailyCooldown = createDailyCooldown({ cooldownMs: CHECK_COOLDOWN_MS });

function markDoneToday() {
    doneDateKey = getDateKey();
}

function isDoneToday() {
    return doneDateKey === getDateKey();
}

async function checkCanShare() {
    const body = types.CheckCanShareRequest.encode(types.CheckCanShareRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'CheckCanShare', body);
    return types.CheckCanShareReply.decode(replyBody);
}

async function reportShare() {
    const body = types.ReportShareRequest.encode(types.ReportShareRequest.create({ shared: true })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'ReportShare', body);
    return types.ReportShareReply.decode(replyBody);
}

async function claimShareReward() {
    const body = types.ClaimShareRewardRequest.encode(types.ClaimShareRewardRequest.create({ claimed: true })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'ClaimShareReward', body);
    return types.ClaimShareRewardReply.decode(replyBody);
}

async function performDailyShare(force = false) {
    if (!dailyCooldown.canRun(force)) return false;
    try {
        const can = await checkCanShare();
        if (!can || !can.can_share) {
            markDoneToday();
            dailyCooldown.markRan();
            log('分享', '今日暂无可领取分享礼包', {
                module: 'task',
                event: DAILY_KEY,
                result: 'none',
            });
            return false;
        }
        const report = await reportShare();
        if (!report || !report.success) {
            dailyCooldown.markRan(); // 即使失败也标记已检查，避免重复尝试
            log('分享', '上报分享状态失败', {
                module: 'task',
                event: DAILY_KEY,
                result: 'error',
            });
            return false;
        }
        let rep = null;
        try {
            rep = await claimShareReward();
        } catch (e) {
            if (isAlreadyClaimedError(e)) {
                markDoneToday();
                dailyCooldown.markRan();
                log('分享', '今日分享奖励已领取', {
                    module: 'task',
                    event: DAILY_KEY,
                    result: 'none',
                });
                return false;
            }
            throw e;
        }
        if (!rep || !rep.success) {
            log('分享', '领取分享礼包失败', {
                module: 'task',
                event: DAILY_KEY,
                result: 'error',
            });
            return false;
        }
        const items = Array.isArray(rep.items) ? rep.items : [];
        const reward = getRewardSummary(items);
        log('分享', reward ? `领取成功 → ${reward}` : '领取成功', {
            module: 'task',
            event: DAILY_KEY,
            result: 'ok',
            count: items.length,
        });
        lastClaimAt = Date.now();
        markDoneToday();
        dailyCooldown.markRan();
        return true;
    } catch (e) {
        log('分享', `领取失败: ${e.message}`, {
            module: 'task',
            event: DAILY_KEY,
            result: 'error',
        });
        return false;
    }
}

module.exports = {
    performDailyShare,
    getShareDailyState: () => ({
        key: DAILY_KEY,
        doneToday: isDoneToday(),
        lastCheckAt,
        lastClaimAt,
        ...dailyCooldown.getState(),
    }),
};
