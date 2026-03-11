/**
 * 仓库系统 - 自动出售果实
 * 协议说明：BagReply 使用 item_bag（ItemBag），item_bag.items 才是背包物品列表
 */

const protobuf = require('protobufjs');
const { getFruitName, getPlantByFruitId, getPlantBySeedId, getItemById, getItemImageById, getSeedImageBySeedId } = require('../config/gameConfig');
const { isAutomationOn } = require('../models/store');
const { sendMsgAsync, networkEvents, getUserState } = require('../utils/network');
const { types } = require('../utils/proto');
const { toLong, toNum, log, logWarn, sleep } = require('../utils/utils');
const { updateStatusGold } = require('./status');

const SELL_BATCH_SIZE = 15;
const FERTILIZER_RELATED_IDS = new Set([
    100003, // 化肥礼包
    100004, // 有机化肥礼包
    80001, 80002, 80003, 80004, // 普通化肥道具
    80011, 80012, 80013, 80014, // 有机化肥道具
]);
const FERTILIZER_CONTAINER_LIMIT_HOURS = 990;
const NORMAL_CONTAINER_ID = 1011;
const ORGANIC_CONTAINER_ID = 1012;
const NORMAL_FERTILIZER_ITEM_HOURS = new Map([
    [80001, 1], [80002, 4], [80003, 8], [80004, 12],
]);
const ORGANIC_FERTILIZER_ITEM_HOURS = new Map([
    [80011, 1], [80012, 4], [80013, 8], [80014, 12],
]);
let fertilizerGiftDoneDateKey = '';
let fertilizerGiftLastOpenAt = 0;

function getDateKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// ============ API ============

async function getBag() {
    const body = types.BagRequest.encode(types.BagRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.itempb.ItemService', 'Bag', body);
    return types.BagReply.decode(replyBody);
}

function toSellItem(item) {
    const idNum = toNum(item && item.id);
    const countNum = toNum(item && item.count);
    const uidNum = toNum(item && item.uid);
    const payload = {
        id: toLong(idNum),
        count: toLong(countNum),
    };
    // SellRequest 通常只需要 id + count；仅在 uid 有效时携带
    if (uidNum > 0) payload.uid = toLong(uidNum);
    return payload;
}

async function sellItems(items) {
    const payload = items.map(toSellItem);
    const body = types.SellRequest.encode(types.SellRequest.create({ items: payload })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.itempb.ItemService', 'Sell', body);
    return types.SellReply.decode(replyBody);
}

async function useItem(itemId, count = 1, landIds = []) {
    const body = types.UseRequest.encode(types.UseRequest.create({
        item_id: toLong(itemId),
        count: toLong(count),
        land_ids: (landIds || []).map((id) => toLong(id)),
    })).finish();
    try {
        const { body: replyBody } = await sendMsgAsync('gamepb.itempb.ItemService', 'Use', body);
        return types.UseReply.decode(replyBody);
    } catch (e) {
        const msg = String((e && e.message) || '');
        const isParamError = msg.includes('code=1000020') || msg.includes('请求参数错误');
        if (!isParamError) throw e;

        // 兼容另一种 UseRequest 编码: { item: { id, count } }
        const writer = protobuf.Writer.create();
        const itemWriter = writer.uint32(10).fork(); // field 1: item
        itemWriter.uint32(8).int64(toLong(itemId));  // item.id
        itemWriter.uint32(16).int64(toLong(count));  // item.count
        itemWriter.ldelim();
        const fallbackBody = writer.finish();

        const { body: fallbackReplyBody } = await sendMsgAsync('gamepb.itempb.ItemService', 'Use', fallbackBody);
        return types.UseReply.decode(fallbackReplyBody);
    }
}

async function batchUseItems(items) {
    const payload = (items || []).map((it) => ({
        id: toLong(it.itemId),
        count: toLong(it.count || 1),
        uid: toLong(it.uid || 0),
    }));
    const body = types.BatchUseRequest.encode(types.BatchUseRequest.create({ items: payload })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.itempb.ItemService', 'BatchUse', body);
    return types.BatchUseReply.decode(replyBody);
}

function isFruitItemId(id) {
    return !!getPlantByFruitId(Number(id));
}

function getBagItems(bagReply) {
    if (bagReply && bagReply.item_bag && bagReply.item_bag.items && bagReply.item_bag.items.length) {
        return bagReply.item_bag.items;
    }
    return bagReply && bagReply.items ? bagReply.items : [];
}

function isFertilizerRelatedItemId(itemId) {
    const id = Number(itemId) || 0;
    if (id <= 0) return false;
    // 禁止对容器道具执行使用，避免触发 1011/1012 补充逻辑
    if (id === 1011 || id === 1012) return false;
    if (FERTILIZER_RELATED_IDS.has(id)) return true;
    const info = getItemById(id);
    if (!info || typeof info !== 'object') return false;
    const interactionType = String(info.interaction_type || '').toLowerCase();
    return interactionType === 'fertilizer' || interactionType === 'fertilizerpro';
}

function collectFertilizerUsePayload(items) {
    const merged = new Map();
    for (const it of (items || [])) {
        const id = toNum(it && it.id);
        const count = Math.max(0, toNum(it && it.count));
        if (id <= 0 || count <= 0) continue;
        if (!isFertilizerRelatedItemId(id)) continue;
        merged.set(id, (merged.get(id) || 0) + count);
    }
    return Array.from(merged.entries()).map(([id, count]) => ({ id, count }));
}

function getContainerHoursFromBagItems(items) {
    let normalSec = 0;
    let organicSec = 0;
    for (const it of (items || [])) {
        const id = toNum(it && it.id);
        const count = Math.max(0, toNum(it && it.count));
        if (id === NORMAL_CONTAINER_ID) normalSec = count;
        if (id === ORGANIC_CONTAINER_ID) organicSec = count;
    }
    return {
        normal: normalSec / 3600,
        organic: organicSec / 3600,
    };
}

function getFertilizerItemTypeAndHours(itemId) {
    const id = Number(itemId) || 0;
    if (NORMAL_FERTILIZER_ITEM_HOURS.has(id)) {
        return { type: 'normal', perItemHours: NORMAL_FERTILIZER_ITEM_HOURS.get(id) };
    }
    if (ORGANIC_FERTILIZER_ITEM_HOURS.has(id)) {
        return { type: 'organic', perItemHours: ORGANIC_FERTILIZER_ITEM_HOURS.get(id) };
    }
    const info = getItemById(id) || {};
    const interactionType = String(info.interaction_type || '').toLowerCase();
    if (interactionType === 'fertilizer') return { type: 'normal', perItemHours: 1 };
    if (interactionType === 'fertilizerpro') return { type: 'organic', perItemHours: 1 };
    return { type: 'other', perItemHours: 0 };
}

function isFertilizerContainerFullError(err) {
    const msg = String((err && err.message) || '');
    return msg.includes('code=1003002')
        || msg.includes('普通化肥容器已达到上限')
        || msg.includes('普通化肥容器已满')
        || msg.includes('有机化肥容器已达到上限')
        || msg.includes('有机化肥容器已满');
}

async function autoOpenFertilizerGiftPacks() {
    try {
        const bagReply = await getBag();
        const bagItems = getBagItems(bagReply);
        const payloads = collectFertilizerUsePayload(bagItems);
        if (payloads.length <= 0) {
            return 0;
        }
        const containerHours = getContainerHoursFromBagItems(bagItems);

        let opened = 0;
        const details = [];
        // 按条目 BatchUse，避免数量大时逐个 Use 造成请求风暴
        for (const row of payloads) {
            const itemId = Number(row.id) || 0;
            const rawCount = Math.max(1, Number(row.count) || 0);
            const { type, perItemHours } = getFertilizerItemTypeAndHours(itemId);
            let useCount = rawCount;

            // 容器达到 990h 后不再使用对应化肥道具；未达到时也按剩余可用小时裁剪数量
            if (type === 'normal' || type === 'organic') {
                const currentHours = type === 'normal' ? containerHours.normal : containerHours.organic;
                if (currentHours >= FERTILIZER_CONTAINER_LIMIT_HOURS) {
                    continue;
                }
                if (perItemHours > 0) {
                    const remainHours = Math.max(0, FERTILIZER_CONTAINER_LIMIT_HOURS - currentHours);
                    const maxCountByHours = Math.floor(remainHours / perItemHours);
                    useCount = Math.max(0, Math.min(rawCount, maxCountByHours));
                    if (useCount <= 0) continue;
                }
            }
            const itemInfo = getItemById(itemId);
            const itemName = itemInfo && itemInfo.name ? String(itemInfo.name) : `物品#${itemId}`;
            let used = 0;
            try {
                await batchUseItems([{ itemId, count: useCount, uid: 0 }]);
                used = useCount;
            } catch {
                // 临时关闭回退 Use：BatchUse 失败时直接跳过该条目
                // await useItem(itemId, 999, []);
                // used = useCount;
                used = 0;
            }
            if (used > 0) {
                opened += used;
                details.push(`${itemName}x${used}`);
                if (type === 'normal' && perItemHours > 0) containerHours.normal += used * perItemHours;
                if (type === 'organic' && perItemHours > 0) containerHours.organic += used * perItemHours;
            }
            await sleep(100);
        }

        if (opened > 0) {
            fertilizerGiftDoneDateKey = getDateKey();
            fertilizerGiftLastOpenAt = Date.now();
            log('仓库', `自动使用化肥类道具 x${opened}${details.length ? ` [${details.join('，')}]` : ''}`, {
                module: 'warehouse',
                event: 'fertilizer_gift_open',
                result: 'ok',
                count: opened,
            });
        }
        return opened;
    } catch (e) {
        if (isFertilizerContainerFullError(e)) {
            return 0;
        }
        logWarn('仓库', `开启化肥礼包失败: ${e.message}`, {
            module: 'warehouse',
            event: 'fertilizer_gift_open',
            result: 'error',
        });
        return 0;
    }
}

async function openFertilizerGiftPacksSilently() {
    return autoOpenFertilizerGiftPacks();
}

function getGoldFromItems(items) {
    for (const item of (items || [])) {
        const id = toNum(item.id);
        if (id === 1 || id === 1001) {
            const count = toNum(item.count);
            if (count > 0) return count;
        }
    }
    return 0;
}

function deriveGoldGainFromSellReply(reply, lastKnownGold) {
    const gainFromGetItems = getGoldFromItems((reply && reply.get_items) || []);
    if (gainFromGetItems > 0) {
        // get_items 通常就是本次获得值
        return { gain: gainFromGetItems, nextKnownGold: lastKnownGold };
    }

    // 兼容旧 proto/旧结构
    const currentOrDelta = getGoldFromItems((reply && (reply.items || reply.sell_items)) || []);
    if (currentOrDelta <= 0) return { gain: 0, nextKnownGold: lastKnownGold };

    // 协议在不同场景下可能返回“当前总金币”或“本次变化值”
    if (lastKnownGold > 0 && currentOrDelta >= lastKnownGold) {
        return { gain: currentOrDelta - lastKnownGold, nextKnownGold: currentOrDelta };
    }
    return { gain: currentOrDelta, nextKnownGold: lastKnownGold };
}

function getCurrentTotals() {
    const state = getUserState() || {};
    return {
        gold: Number(state.gold || 0),
        exp: Number(state.exp || 0),
    };
}

async function getCurrentTotalsFromBag() {
    const bagReply = await getBag();
    const items = getBagItems(bagReply);
    let gold = null;
    let exp = null;
    for (const item of items) {
        const id = toNum(item.id);
        const count = toNum(item.count);
        if (id === 1 || id === 1001) gold = count;       // 金币
        if (id === 1101) exp = count;     // 累计经验
    }
    return { gold, exp };
}

async function getBagDetail() {
    const bagReply = await getBag();
    const rawItems = getBagItems(bagReply);
    const merged = new Map();
    for (const it of (rawItems || [])) {
        const id = toNum(it.id);
        const count = toNum(it.count);
        if (id <= 0 || count <= 0) continue;
        const info = getItemById(id) || null;
        let name = info && info.name ? String(info.name) : '';
        let category = 'item';
        if (id === 1 || id === 1001) {
            name = '金币';
            category = 'gold';
        } else if (id === 1101) {
            name = '经验';
            category = 'exp';
        } else if (getPlantByFruitId(id)) {
            if (!name) name = `${getFruitName(id)}果实`;
            category = 'fruit';
        } else if (getPlantBySeedId(id)) {
            const p = getPlantBySeedId(id);
            if (!name) name = `${p && p.name ? p.name : '未知'}种子`;
            category = 'seed';
        }
        if (!name) name = `物品${id}`;
        const interactionType = info && info.interaction_type ? String(info.interaction_type) : '';
        const priceId = info ? (Number(info.price_id) || 0) : 0;
        const priceUnit = priceId === 1005 ? '金豆豆' : priceId === 1002 ? '点券' : '金';

        if (!merged.has(id)) {
            merged.set(id, {
                id,
                count: 0,
                uid: 0, // 合并展示后 UID 不再有意义
                name,
                image: getItemImageById(id),
                category,
                itemType: info ? (Number(info.type) || 0) : 0,
                priceId,
                price: info ? (Number(info.price) || 0) : 0,
                priceUnit,
                level: info ? (Number(info.level) || 0) : 0,
                interactionType,
                hoursText: '',
            });
        }
        const row = merged.get(id);
        row.count += count;
    }

    const items = Array.from(merged.values()).map((row) => {
        if (row.interactionType === 'fertilizerbucket' && row.count > 0) {
            // 游戏显示更接近截断到 1 位小数（非四舍五入）
            const hoursFloor1 = Math.floor((row.count / 3600) * 10) / 10;
            row.hoursText = `${hoursFloor1.toFixed(1)}小时`;
        } else {
            row.hoursText = '';
        }
        return row;
    });
    items.sort((a, b) => {
        const taRaw = Number(a.itemType || 0);
        const tbRaw = Number(b.itemType || 0);
        const typePriority = new Map([
            [17, 0],
            [5, 1],
            [6, 2],
        ]);
        const ta = typePriority.has(taRaw) ? typePriority.get(taRaw) : (taRaw > 0 ? (1000 + taRaw) : Number.MAX_SAFE_INTEGER);
        const tb = typePriority.has(tbRaw) ? typePriority.get(tbRaw) : (tbRaw > 0 ? (1000 + tbRaw) : Number.MAX_SAFE_INTEGER);
        if (ta !== tb) return ta - tb;

        const ca = Number(a.count || 0);
        const cb = Number(b.count || 0);
        if (cb !== ca) return cb - ca;
        return Number(a.id || 0) - Number(b.id || 0);
    });
    return { totalKinds: items.length, items };
}

/**
 * 获取背包中的所有种子
 * @returns {Promise<Array<{seedId: number, name: string, count: number, requiredLevel: number, image: string, plantSize: number}>>} 种子列表
 */
async function getBagSeeds() {
    const bagReply = await getBag();
    const items = getBagItems(bagReply);
    const seeds = [];
    const merged = new Map();

    for (const item of items) {
        const id = toNum(item.id);
        const count = toNum(item.count);
        if (count <= 0) continue;

        const plant = getPlantBySeedId(id);
        if (!plant) continue;

        if (!merged.has(id)) {
            merged.set(id, {
                seedId: id,
                name: plant.name || `种子${id}`,
                count: 0,
                requiredLevel: Number(plant.land_level_need) || 0,
                image: getSeedImageBySeedId(id),
                plantSize: Math.max(1, Number(plant.size) || 1),
            });
        }
        merged.get(id).count += count;
    }

    for (const seed of merged.values()) {
        seeds.push(seed);
    }

    // 默认按等级降序排列
    seeds.sort((a, b) => b.requiredLevel - a.requiredLevel);
    return seeds;
}

// ============ 出售逻辑 ============

/**
 * 检查并出售所有果实
 */
async function sellAllFruits() {
    const sellEnabled = isAutomationOn('sell');
    if (!sellEnabled) {
        return;
    }
    try {
        const bagReply = await getBag();
        const items = getBagItems(bagReply);

        const toSell = [];
        const names = [];
        for (const item of items) {
            const id = toNum(item.id);
            const count = toNum(item.count);
            if (isFruitItemId(id) && count > 0) {
                toSell.push(item);
                names.push(`${getFruitName(id)}x${count}`);
            }
        }

        if (toSell.length === 0) {
            log('仓库', '无果实可出售');
            return;
        }

        const totalsBefore = getCurrentTotals();
        const goldBefore = totalsBefore.gold;
        let serverGoldTotal = 0;
        let knownGold = goldBefore;
        for (let i = 0; i < toSell.length; i += SELL_BATCH_SIZE) {
            const batch = toSell.slice(i, i + SELL_BATCH_SIZE);
            try {
                const reply = await sellItems(batch);
                const inferred = deriveGoldGainFromSellReply(reply, knownGold);
                const gained = Math.max(0, toNum(inferred.gain));
                knownGold = inferred.nextKnownGold;
                if (gained > 0) serverGoldTotal += gained;
            } catch (batchErr) {
                // 某个条目可能参数非法，降级为逐个出售，跳过错误条目
                logWarn('仓库', `批量出售失败，改为逐个重试: ${batchErr.message}`);
                for (const it of batch) {
                    try {
                        const singleReply = await sellItems([it]);
                        const inferred = deriveGoldGainFromSellReply(singleReply, knownGold);
                        const gained = Math.max(0, toNum(inferred.gain));
                        knownGold = inferred.nextKnownGold;
                        if (gained > 0) serverGoldTotal += gained;
                    } catch (singleErr) {
                        const sid = toNum(it.id);
                        const sc = toNum(it.count);
                        logWarn('仓库', `跳过不可售物品: ID=${sid} x${sc} (${singleErr.message})`, {
                            module: 'warehouse',
                            event: 'sell_skip_invalid',
                            result: 'skip',
                            itemId: sid,
                            count: sc,
                        });
                    }
                }
            }
            if (i + SELL_BATCH_SIZE < toSell.length) await sleep(300);
        }
        // 等待金币通知更新（最多 2s）
        let goldAfter = goldBefore;
        const startWait = Date.now();
        while (Date.now() - startWait < 2000) {
            const currentGold = (getUserState() && getUserState().gold) ? getUserState().gold : goldAfter;
            if (currentGold !== goldBefore) {
                goldAfter = currentGold;
                break;
            }
            await sleep(200);
        }
        const totalsAfter = getCurrentTotals();
        const totalGoldDelta = goldAfter > goldBefore ? (goldAfter - goldBefore) : 0;
        const totalsDeltaGold = totalsAfter.gold - totalsBefore.gold;
        const totalsDeltaExp = totalsAfter.exp - totalsBefore.exp;

        // 通知缺失时，尝试从背包读取金币做最终兜底
        let bagDelta = 0;
        if (totalGoldDelta <= 0 && serverGoldTotal <= 0) {
            try {
                const bagAfter = await getBag();
                const bagGold = getGoldFromItems(getBagItems(bagAfter));
                if (bagGold > goldBefore) bagDelta = bagGold - goldBefore;
            } catch {}
        }

        const totalGoldEarned = Math.max(serverGoldTotal, totalGoldDelta, bagDelta);
        if (totalGoldDelta <= 0 && totalGoldEarned > 0) {
            // 某些情况下 ItemNotify 丢失，使用出售回包做金币兜底同步
            const state = getUserState();
            if (state) {
                state.gold = Number(state.gold || 0) + totalGoldEarned;
                updateStatusGold(state.gold);
            }
        }
        log('仓库', `出售 ${names.join(', ')}${totalGoldEarned > 0 ? `，获得 ${totalGoldEarned} 金币` : ''}`, {
            module: 'warehouse',
            event: 'sell_success',
            result: totalGoldEarned > 0 ? 'ok' : 'unknown_gain',
            count: toSell.length,
            gold: totalGoldEarned,
            totalsBefore,
            totalsAfter,
            totalsDeltaGold,
            totalsDeltaExp,
        });
        
        // 发送出售事件，用于统计金币收益
        if (totalGoldEarned > 0) {
            networkEvents.emit('sell', totalGoldEarned);
        }
    } catch (e) {
        logWarn('仓库', `出售失败: ${e.message}`);
    }
}

module.exports = {
    getBag,
    getBagDetail,
    getBagSeeds,
    sellItems,
    useItem,
    batchUseItems,
    openFertilizerGiftPacksSilently,
    getFertilizerGiftDailyState: () => ({
        key: 'fertilizer_gift_open',
        doneToday: fertilizerGiftDoneDateKey === getDateKey(),
        lastOpenAt: fertilizerGiftLastOpenAt,
    }),
    sellAllFruits,
    getBagItems,
    getCurrentTotalsFromBag,
};
