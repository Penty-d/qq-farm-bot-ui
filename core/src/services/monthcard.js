/**
 * 月卡礼包
 */

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { log } = require('../utils/utils');
const { getDateKey, getRewardSummary,createDailyCooldown } = require('./common');

const DAILY_KEY = 'month_card_gift';
const CHECK_COOLDOWN_MS = 10 * 60 * 1000;

let doneDateKey = '';
let lastClaimAt = 0;
let lastResult = '';
let lastHasCard = null;
let lastHasClaimable = null;

const dailyCooldown = createDailyCooldown({ cooldownMs: CHECK_COOLDOWN_MS });

function markDoneToday() {
    doneDateKey = getDateKey();
}

function isDoneToday() {
    return doneDateKey === getDateKey();
}

async function getMonthCardInfos() {
    const body = types.GetMonthCardInfosRequest.encode(types.GetMonthCardInfosRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.mallpb.MallService', 'GetMonthCardInfos', body);
    return types.GetMonthCardInfosReply.decode(replyBody);
}

async function claimMonthCardReward(goodsId) {
    const body = types.ClaimMonthCardRewardRequest.encode(types.ClaimMonthCardRewardRequest.create({
        goods_id: Number(goodsId) || 0,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.mallpb.MallService', 'ClaimMonthCardReward', body);
    return types.ClaimMonthCardRewardReply.decode(replyBody);
}

async function performDailyMonthCardGift(force = false) {
    if (!dailyCooldown.canRun(force)) return false;

    try {
        const rep = await getMonthCardInfos();
        const infos = Array.isArray(rep && rep.infos) ? rep.infos : [];
        lastHasCard = infos.length > 0;
        const claimable = infos.filter((x) => x && x.can_claim && Number(x.goods_id || 0) > 0);
        lastHasClaimable = claimable.length > 0;
        if (!infos.length) {
            markDoneToday();
            dailyCooldown.markRan();
            lastResult = 'none';
            log('月卡', '当前没有月卡或已过期', {
                module: 'task',
                event: DAILY_KEY,
                result: 'none',
            });
            return false;
        }
        if (!claimable.length) {
            markDoneToday();
            dailyCooldown.markRan();
            lastResult = 'none';
            log('月卡', '今日暂无可领取月卡礼包', {
                module: 'task',
                event: DAILY_KEY,
                result: 'none',
            });
            return false;
        }
        let claimed = 0;
        for (const info of claimable) {
            try {
                const ret = await claimMonthCardReward(Number(info.goods_id || 0));
                const items = Array.isArray(ret && ret.items) ? ret.items : [];
                const reward = getRewardSummary(items);
                log('月卡', reward ? `领取成功 → ${reward}` : '领取成功', {
                    module: 'task',
                    event: DAILY_KEY,
                    result: 'ok',
                    goodsId: Number(info.goods_id || 0),
                });
                claimed += 1;
            } catch (e) {
                log('月卡', `领取失败(gid=${Number(info.goods_id || 0)}): ${e.message}`, {
                    module: 'task',
                    event: DAILY_KEY,
                    result: 'error',
                    goodsId: Number(info.goods_id || 0),
                });
            }
        }
        if (claimed > 0) {
            lastClaimAt = Date.now();
            markDoneToday();
            dailyCooldown.markRan();
            lastResult = 'ok';
            return true;
        }
        dailyCooldown.markRan();
        log('月卡', '本次未成功领取月卡礼包', {
            module: 'task',
            event: DAILY_KEY,
            result: 'none',
        });
        lastResult = 'none';
        return false;
    } catch (e) {
        lastResult = 'error';
        log('月卡', `查询月卡礼包失败: ${e.message}`, {
            module: 'task',
            event: DAILY_KEY,
            result: 'error',
        });
        return false;
    }
}

module.exports = {
    performDailyMonthCardGift,
    getMonthCardDailyState: () => ({
        key: DAILY_KEY,
        doneToday: isDoneToday(),
        ...dailyCooldown.getState(),
        lastClaimAt,
        result: lastResult,
        hasCard: lastHasCard,
        hasClaimable: lastHasClaimable,
    }),
};
