/**
 * 开服红包每日领取
 */

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { log } = require('../utils/utils');
const { getDateKey, getRewardSummary, isAlreadyClaimedError: commonIsAlreadyClaimedError, createDailyCooldown } = require('./common');

const DAILY_KEY = 'open_server_gift';
const CHECK_COOLDOWN_MS = 10 * 60 * 1000;

let doneDateKey = '';
let lastClaimAt = 0;
let lastResult = '';
let lastHasClaimable = null;

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

async function getTodayClaimStatus() {
    const body = types.GetTodayClaimStatusRequest.encode(types.GetTodayClaimStatusRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.redpacketpb.RedPacketService', 'GetTodayClaimStatus', body);
    return types.GetTodayClaimStatusReply.decode(replyBody);
}

async function claimRedPacket(id) {
    const body = types.ClaimRedPacketRequest.encode(types.ClaimRedPacketRequest.create({
        id: Number(id) || 0,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.redpacketpb.RedPacketService', 'ClaimRedPacket', body);
    return types.ClaimRedPacketReply.decode(replyBody);
}

async function performDailyOpenServerGift(force = false) {
    if (!dailyCooldown.canRun(force)) return false;

    try {
        const status = await getTodayClaimStatus();
        const infos = Array.isArray(status && status.infos) ? status.infos : [];
        const claimable = infos.filter((x) => x && x.can_claim && Number(x.id || 0) > 0);
        lastHasClaimable = claimable.length > 0;

        if (!claimable.length) {
            markDoneToday();
            dailyCooldown.markRan();
            lastResult = 'none';
            log('开服', '今日暂无可领取开服红包', {
                module: 'task',
                event: DAILY_KEY,
                result: 'none',
            });
            return false;
        }

        let claimed = 0;
        let alreadyDoneToday = false;
        for (const info of claimable) {
            const packetId = Number(info.id || 0);
            try {
                const ret = await claimRedPacket(packetId);
                const items = ret && ret.item ? [ret.item] : [];
                const reward = getRewardSummary(items);
                log('开服', reward ? `领取成功 → ${reward}` : '领取成功', {
                    module: 'task',
                    event: DAILY_KEY,
                    result: 'ok',
                    redPacketId: packetId,
                });
                claimed += 1;
            } catch (e) {
                if (isAlreadyClaimedError(e)) {
                    alreadyDoneToday = true;
                    break;
                }
                log('开服', `领取失败(id=${packetId}): ${e.message}`, {
                    module: 'task',
                    event: DAILY_KEY,
                    result: 'error',
                    redPacketId: packetId,
                });
            }
        }

        if (claimed > 0 || alreadyDoneToday) {
            lastClaimAt = Date.now();
            markDoneToday();
            dailyCooldown.markRan();
            lastResult = 'ok';
            if (alreadyDoneToday && claimed === 0) {
                log('开服', '今日开服红包已领取', {
                    module: 'task',
                    event: DAILY_KEY,
                    result: 'ok',
                });
                return false;
            }
            return claimed > 0;
        }

        dailyCooldown.markRan();
        lastResult = 'none';
        return false;
    } catch (e) {
        if (isAlreadyClaimedError(e)) {
            markDoneToday();
            dailyCooldown.markRan();
            lastResult = 'none';
            log('开服', '今日开服红包已领取', {
                module: 'task',
                event: DAILY_KEY,
                result: 'none',
            });
            return false;
        }
        lastResult = 'error';
        log('开服', `领取开服红包失败: ${e.message}`, {
            module: 'task',
            event: DAILY_KEY,
            result: 'error',
        });
        return false;
    }
}

module.exports = {
    performDailyOpenServerGift,
    getOpenServerDailyState: () => ({
        key: DAILY_KEY,
        doneToday: isDoneToday(),
        ...dailyCooldown.getState(),
        lastClaimAt,
        result: lastResult,
        hasClaimable: lastHasClaimable,
    }),
};
