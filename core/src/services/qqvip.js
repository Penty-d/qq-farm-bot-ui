/**
 * QQ 会员每日礼包
 */

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { log } = require('../utils/utils');
const { getDateKey, getRewardSummary, isAlreadyClaimedError: commonIsAlreadyClaimedError, createDailyCooldown } = require('./common');

const DAILY_KEY = 'vip_daily_gift';
const CHECK_COOLDOWN_MS = 10 * 60 * 1000;

let doneDateKey = '';
let lastClaimAt = 0;
let lastResult = '';
let lastHasGift = null;
let lastCanClaim = null;

const dailyCooldown = createDailyCooldown({ cooldownMs: CHECK_COOLDOWN_MS });

function markDoneToday() {
    doneDateKey = getDateKey();
}

function isDoneToday() {
    return doneDateKey === getDateKey();
}

function isAlreadyClaimedError(err) {
    return commonIsAlreadyClaimedError(err);
}

async function getDailyGiftStatus() {
    const body = types.GetDailyGiftStatusRequest.encode(types.GetDailyGiftStatusRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.qqvippb.QQVipService', 'GetDailyGiftStatus', body);
    return types.GetDailyGiftStatusReply.decode(replyBody);
}

async function claimDailyGift() {
    const body = types.ClaimDailyGiftRequest.encode(types.ClaimDailyGiftRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.qqvippb.QQVipService', 'ClaimDailyGift', body);
    return types.ClaimDailyGiftReply.decode(replyBody);
}

async function performDailyVipGift(force = false) {
    if (!dailyCooldown.canRun(force)) return false;

    try {
        const status = await getDailyGiftStatus();
        lastHasGift = !!(status && status.has_gift);
        lastCanClaim = !!(status && status.can_claim);
        if (!status || !status.can_claim) {
            markDoneToday();
            dailyCooldown.markRan();
            lastResult = 'none';
            log('会员', '今日暂无可领取会员礼包', {
                module: 'task',
                event: DAILY_KEY,
                result: 'none',
            });
            return false;
        }
        const rep = await claimDailyGift();
        const items = Array.isArray(rep && rep.items) ? rep.items : [];
        const reward = getRewardSummary(items);
        log('会员', reward ? `领取成功 → ${reward}` : '领取成功', {
            module: 'task',
            event: DAILY_KEY,
            result: 'ok',
            count: items.length,
        });
        lastClaimAt = Date.now();
        markDoneToday();
        dailyCooldown.markRan();
        lastResult = 'ok';
        return true;
    } catch (e) {
        if (isAlreadyClaimedError(e)) {
            markDoneToday();
            dailyCooldown.markRan();
            lastClaimAt = Date.now();
            lastResult = 'ok';
            log('会员', '今日会员礼包已领取', {
                module: 'task',
                event: DAILY_KEY,
                result: 'ok',
            });
            return false;
        }
        lastResult = 'error';
        log('会员', `领取会员礼包失败: ${e.message}`, {
            module: 'task',
            event: DAILY_KEY,
            result: 'error',
        });
        return false;
    }
}

module.exports = {
    performDailyVipGift,
    getVipDailyState: () => ({
        key: DAILY_KEY,
        doneToday: isDoneToday(),
        ...dailyCooldown.getState(),
        lastClaimAt,
        result: lastResult,
        hasGift: lastHasGift,
        canClaim: lastCanClaim,
    }),
};
