/**
 * 自己的农场操作 - 收获/浇水/除草/除虫/铲除/种植/商店/巡田
 */

const protobuf = require('protobufjs');
const { CONFIG, PlantPhase, PHASE_NAMES } = require('../config/config');
const { getPlantNameBySeedId, getPlantName, getPlantExp, formatGrowTime, getPlantGrowTime, getAllSeeds, getPlantById, getPlantBySeedId, getSeedImageBySeedId } = require('../config/gameConfig');
const { isAutomationOn, getPreferredSeed, getAutomation, getPlantingStrategy, getOrganicAntiStealMinutes } = require('../models/store');
const { sendMsgAsync, getUserState, networkEvents, getWsErrorState } = require('../utils/network');
const { types } = require('../utils/proto');
const { toLong, toNum, getServerTimeSec, toTimeSec, log, logWarn, sleep } = require('../utils/utils');
const { getPlantRankings } = require('./analytics');
const { createScheduler } = require('./scheduler');
const { recordOperation } = require('./stats');
const { getFarmOptimizer } = require('./rate-limiter');
const { getBag, getBagItems, getContainerHoursFromBagItems } = require('./warehouse');
const { autoBuyOrganicFertilizer } = require('./mall');

// ============ 内部状态 ============
let isCheckingFarm = false;
let isFirstFarmCheck = true;
let farmLoopRunning = false;
let externalSchedulerMode = false;
const farmScheduler = createScheduler('farm');
let lastOrganicAntiStealCheck = 0;// 上次检查有机化肥防偷的时间
const ANTI_STEAL_CHECK_COOLDOWN_MS = 1 * 1000;// 每1秒检查一次有机化肥防偷

// ============ 农场 API ============

// 操作限制更新回调 (由 friend.js 设置)
let onOperationLimitsUpdate = null;
function setOperationLimitsCallback(callback) {
    onOperationLimitsUpdate = callback;
}

/**
 * 通用植物操作请求
 */
async function sendPlantRequest(RequestType, ReplyType, method, landIds, hostGid) {
    const body = RequestType.encode(RequestType.create({
        land_ids: landIds,
        host_gid: toLong(hostGid),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', method, body);
    return ReplyType.decode(replyBody);
}

async function getAllLands() {
    const body = types.AllLandsRequest.encode(types.AllLandsRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'AllLands', body);
    const reply = types.AllLandsReply.decode(replyBody);
    // 更新操作限制
    if (reply.operation_limits && onOperationLimitsUpdate) {
        onOperationLimitsUpdate(reply.operation_limits);
    }
    return reply;
}

async function harvest(landIds) {
    const state = getUserState();
    const body = types.HarvestRequest.encode(types.HarvestRequest.create({
        land_ids: landIds,
        host_gid: toLong(state.gid),
        is_all: true,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Harvest', body);
    return types.HarvestReply.decode(replyBody);
}

async function doHarvest(landIds, opType = 'harvest') {
    const ids = (Array.isArray(landIds) ? landIds : []).filter(Boolean);
    if (ids.length === 0) {
        return { success: false, count: 0, error: null, reply: null };
    }

    try {
        const reply = await harvest(ids);
        log('收获', `收获完成 ${ids.length} 块土地`, {
            module: 'farm',
            event: 'harvest_crop',
            result: 'ok',
            count: ids.length,
            landIds: ids,
        });
        recordOperation('harvest', ids.length);
        networkEvents.emit('farmHarvested', {
            count: ids.length,
            landIds: ids,
            opType,
        });
        return { success: true, count: ids.length, error: null, reply };
    } catch (e) {
        logWarn('收获', e.message, {
            module: 'farm',
            event: 'harvest_crop',
            result: 'error',
        });
        return { success: false, count: 0, error: e.message, reply: null };
    }
}

async function doHarvest(landIds, opType = 'harvest') {
    const ids = (Array.isArray(landIds) ? landIds : []).filter(Boolean);
    if (ids.length === 0) {
        return { success: false, count: 0, reply: null };
    }
    try {
        const reply = await harvest(ids);
        log('收获', `收获完成 ${ids.length} 块土地`, {
            module: 'farm',
            event: 'harvest_crop',
            result: 'ok',
            count: ids.length,
            landIds: ids,
        });
        recordOperation('harvest', ids.length);
        networkEvents.emit('farmHarvested', {
            count: ids.length,
            landIds: ids,
            opType,
        });
        return { success: true, count: ids.length, reply };
    } catch (e) {
        logWarn('收获', e.message, {
            module: 'farm',
            event: 'harvest_crop',
            result: 'error',
        });
        return { success: false, count: 0, error: e };
    }
}

async function waterLand(landIds) {
    const state = getUserState();
    return sendPlantRequest(types.WaterLandRequest, types.WaterLandReply, 'WaterLand', landIds, state.gid);
}

async function weedOut(landIds) {
    const state = getUserState();
    return sendPlantRequest(types.WeedOutRequest, types.WeedOutReply, 'WeedOut', landIds, state.gid);
}

async function insecticide(landIds) {
    const state = getUserState();
    return sendPlantRequest(types.InsecticideRequest, types.InsecticideReply, 'Insecticide', landIds, state.gid);
}

// 普通肥料 ID
const NORMAL_FERTILIZER_ID = 1011;
// 有机肥料 ID
const ORGANIC_FERTILIZER_ID = 1012;

/**
 * 施肥 - 必须逐块进行，服务器不支持批量
 * 游戏中拖动施肥间隔很短，这里用 50ms
 */
async function fertilize(landIds, fertilizerId = NORMAL_FERTILIZER_ID) {
    let successCount = 0;
    for (const landId of landIds) {
        try {
            const body = types.FertilizeRequest.encode(types.FertilizeRequest.create({
                land_ids: [toLong(landId)],
                fertilizer_id: toLong(fertilizerId),
            })).finish();
            await sendMsgAsync('gamepb.plantpb.PlantService', 'Fertilize', body);
            successCount++;
        } catch {
            // 施肥失败（可能肥料不足），停止继续
            break;
        }
        if (landIds.length > 1) await sleep(50);  // 50ms 间隔
    }
    return successCount;
}

/**
 * 有机肥循环施肥:
 * 按地块顺序 1-2-3-...-1 持续施肥，直到出现失败即停止。
 */
async function fertilizeOrganicLoop(landIds) {
    const ids = (Array.isArray(landIds) ? landIds : []).filter(Boolean);
    if (ids.length === 0) return 0;

    let successCount = 0;
    let idx = 0;

    while (true) {
        const landId = ids[idx];
        try {
            const body = types.FertilizeRequest.encode(types.FertilizeRequest.create({
                land_ids: [toLong(landId)],
                fertilizer_id: toLong(ORGANIC_FERTILIZER_ID),
            })).finish();
            await sendMsgAsync('gamepb.plantpb.PlantService', 'Fertilize', body);
            successCount++;
        } catch {
            // 常见是有机肥耗尽，按需求直接停止
            break;
        }

        idx = (idx + 1) % ids.length;
        await sleep(1000);
    }

    return successCount;
}

function getOrganicFertilizerTargetsFromLands(lands) {
    const list = Array.isArray(lands) ? lands : [];
    const targets = [];
    for (const land of list) {
        if (!land || !land.unlocked) continue;
        const landId = toNum(land.id);
        if (!landId) continue;

        const plant = land.plant;
        if (!plant || !plant.phases || plant.phases.length === 0) continue;
        const currentPhase = getCurrentPhase(plant.phases);
        if (!currentPhase) continue;
        if (currentPhase.phase === PlantPhase.DEAD) continue;

        // 服务端有该字段时，<=0 说明该地当前不能再施有机肥
        if (Object.prototype.hasOwnProperty.call(plant, 'left_inorc_fert_times')) {
            const leftTimes = toNum(plant.left_inorc_fert_times);
            if (leftTimes <= 0) continue;
        }

        targets.push(landId);
    }
    return targets;
}

function getSlaveLandIds(land) {
    const ids = Array.isArray(land && land.slave_land_ids) ? land.slave_land_ids : [];
    return [...new Set(ids.map(id => toNum(id)).filter(Boolean))];
}

function hasPlantData(land) {
    const plant = land && land.plant;
    return !!(plant && Array.isArray(plant.phases) && plant.phases.length > 0);
}

function getLinkedMasterLand(land, landsMap) {
    const landId = toNum(land && land.id);
    const masterLandId = toNum(land && land.master_land_id);
    if (!masterLandId || masterLandId === landId) return null;

    const masterLand = landsMap.get(masterLandId);
    if (!masterLand) return null;

    const slaveIds = getSlaveLandIds(masterLand);
    if (slaveIds.length > 0 && !slaveIds.includes(landId)) return null;

    return masterLand;
}

function getDisplayLandContext(land, landsMap) {
    const masterLand = getLinkedMasterLand(land, landsMap);
    if (masterLand && hasPlantData(masterLand)) {
        const occupiedLandIds = [toNum(masterLand.id), ...getSlaveLandIds(masterLand)].filter(Boolean);
        return {
            sourceLand: masterLand,
            occupiedByMaster: true,
            masterLandId: toNum(masterLand.id),
            occupiedLandIds: occupiedLandIds.length > 0 ? occupiedLandIds : [toNum(masterLand.id)].filter(Boolean),
        };
    }

    const selfId = toNum(land && land.id);
    return {
        sourceLand: land,
        occupiedByMaster: false,
        masterLandId: selfId,
        occupiedLandIds: [selfId].filter(Boolean),
    };
}

function isOccupiedSlaveLand(land, landsMap) {
    return !!getDisplayLandContext(land, landsMap).occupiedByMaster;
}

function summarizeLandDetails(lands) {
    const summary = {
        harvestable: 0,
        growing: 0,
        empty: 0,
        dead: 0,
        needWater: 0,
        needWeed: 0,
        needBug: 0,
    };

    for (const land of Array.isArray(lands) ? lands : []) {
        if (!land || !land.unlocked) continue;

        const status = String(land.status || '');
        if (status === 'harvestable') summary.harvestable++;
        else if (status === 'dead') summary.dead++;
        else if (status === 'empty') summary.empty++;
        else if (status === 'growing' || status === 'stealable' || status === 'harvested') summary.growing++;

        if (land.needWater) summary.needWater++;
        if (land.needWeed) summary.needWeed++;
        if (land.needBug) summary.needBug++;
    }

    return summary;
}

const ALL_FERTILIZER_LAND_TYPES = ['gold', 'black', 'red', 'normal'];
const FERTILIZER_LAND_TYPE_LABELS = {
    gold: '金土地',
    black: '黑土地',
    red: '红土地',
    normal: '普通土地',
};

function getLandTypeByLevel(level) {
    const lv = toNum(level);
    if (lv >= 4) return 'gold';
    if (lv === 3) return 'black';
    if (lv === 2) return 'red';
    return 'normal';
}

function normalizeFertilizerLandTypes(input) {
    const source = Array.isArray(input) ? input : ALL_FERTILIZER_LAND_TYPES;
    const result = [];
    for (const item of source) {
        const value = String(item || '').trim().toLowerCase();
        if (!ALL_FERTILIZER_LAND_TYPES.includes(value)) continue;
        if (result.includes(value)) continue;
        result.push(value);
    }
    return result;
}

function filterLandIdsByTypes(landIds, landTypeById, selectedTypes) {
    const ids = Array.isArray(landIds) ? landIds : [];
    const selected = new Set(normalizeFertilizerLandTypes(selectedTypes));
    if (selected.size === 0) return [];
    if (selected.size === ALL_FERTILIZER_LAND_TYPES.length) return [...ids];

    const filtered = [];
    for (const id of ids) {
        const type = String(landTypeById.get(id) || '');
        if (!type) continue;
        if (selected.has(type)) filtered.push(id);
    }
    return filtered;
}

function formatFertilizerLandTypes(types) {
    return normalizeFertilizerLandTypes(types).map(type => FERTILIZER_LAND_TYPE_LABELS[type] || type);
}

async function runFertilizerByConfig(plantedLands = [], options = {}) {
    const automation = getAutomation() || {};
    const fertilizerConfig = automation.fertilizer || 'none';
    const reason = String(options.reason || '').trim().toLowerCase() === 'multi_season' ? 'multi_season' : 'normal';
    const reasonLabel = reason === 'multi_season' ? '多季补肥' : '常规施肥';
    const eventName = reason === 'multi_season' ? '多季补肥' : 'fertilize';// 事件名称
    const selectedLandTypes = normalizeFertilizerLandTypes(automation.fertilizer_land_types);
    const selectedLandTypeNames = formatFertilizerLandTypes(selectedLandTypes);
    const planted = [...new Set((Array.isArray(plantedLands) ? plantedLands : []).map(v => toNum(v)).filter(Boolean))];

    if (selectedLandTypes.length === 0) {
        log('施肥', `${reasonLabel}：未勾选施肥范围，跳过本轮施肥`, {
            module: 'farm',
            event: eventName,
            result: 'skip',
            reason,
            scope: 'none',
        });
        return { normal: 0, organic: 0 };
    }

    if (planted.length === 0 && fertilizerConfig !== 'organic' && fertilizerConfig !== 'both') {
        return { normal: 0, organic: 0 };
    }
      let latestLands = [];
    const landTypeById = new Map();
    try {
        const latest = await getAllLands();
        latestLands = Array.isArray(latest && latest.lands) ? latest.lands : [];
        for (const land of latestLands) {
            if (!land) continue;
            const landId = toNum(land.id);
            if (!landId) continue;
            landTypeById.set(landId, getLandTypeByLevel(land.level));
        }
    } catch (e) {
        logWarn('施肥', `${reasonLabel}：获取土地信息失败，按已知地块继续: ${e.message}`, {
            module: 'farm',
            event: eventName,
            result: 'error',
            reason,
        });
    }

    const isAllLandTypesSelected = selectedLandTypes.length === ALL_FERTILIZER_LAND_TYPES.length;
    if (landTypeById.size === 0 && !isAllLandTypesSelected) {
        logWarn('施肥', `${reasonLabel}：无法确认土地类型，已跳过本轮施肥`, {
            module: 'farm',
            event: eventName,
            result: 'skip',
            reason,
            landTypes: selectedLandTypes,
        });
        return { normal: 0, organic: 0 };
    }

    let normalTargets = planted;
    if (landTypeById.size > 0) {
        normalTargets = filterLandIdsByTypes(planted, landTypeById, selectedLandTypes);
    }

    let fertilizedNormal = 0;
    let fertilizedOrganic = 0;

    if ((fertilizerConfig === 'normal' || fertilizerConfig === 'both') && normalTargets.length > 0) {
        fertilizedNormal = await fertilize(normalTargets, NORMAL_FERTILIZER_ID);
        if (fertilizedNormal > 0) {
           log('施肥', `${reasonLabel}：已为 ${fertilizedNormal}/${normalTargets.length} 块地施普通化肥（范围: ${selectedLandTypeNames.join('、')}）`, 
           {
                module: 'farm', // 模块名称
                event: eventName, // 事件名称
                result: 'ok',  // 结果为成功
                reason, // 原因
                type: 'normal', // 肥料类型为普通
                count: fertilizedNormal, // 成功施肥数量
                landTypes: selectedLandTypes, /// 施肥范围
            });
            recordOperation('fertilize', fertilizedNormal);
        }
    }

    if (fertilizerConfig === 'organic' || fertilizerConfig === 'both') {
        let organicTargets = planted;
       if (latestLands.length > 0) { // 从最新地块数据中获取有机肥料目标
            organicTargets = getOrganicFertilizerTargetsFromLands(latestLands);
        }
        if (landTypeById.size > 0) {  // 从土地类型映射中筛选有机肥料目标
            organicTargets = filterLandIdsByTypes(organicTargets, landTypeById, selectedLandTypes);
        }

        fertilizedOrganic = await fertilizeOrganicLoop(organicTargets);
        if (fertilizedOrganic > 0) {
            log('施肥', `${reasonLabel}：有机化肥循环施肥完成，共施 ${fertilizedOrganic} 次（范围: ${selectedLandTypeNames.join('、')}）`, {
                module: 'farm', // 模块名称
                event: eventName, // 事件名称
                result: 'ok',  // 结果为成功
                reason, // 原因
                type: 'organic', // 肥料类型为有机
                count: fertilizedOrganic, // 成功施肥数量
                landTypes: selectedLandTypes, /// 施肥范围
            });
            recordOperation('fertilize', fertilizedOrganic);
        }
    }

    return { normal: fertilizedNormal, organic: fertilizedOrganic };
}

/**
 * 有机肥防偷功能
 * 当作物即将成熟时，使用有机肥催熟并立即收获，防止被好友偷菜
 * @returns {Promise<{fertilized: number, harvested: number}>} 施肥和收获的数量
 */
async function runOrganicAntiSteal() {
    const organicAntiStealEnabled = isAutomationOn('organicAntiSteal');
    if (!organicAntiStealEnabled) {
        return { fertilized: 0, harvested: 0 };
    }

    const now = Date.now();
    if (now - lastOrganicAntiStealCheck < ANTI_STEAL_CHECK_COOLDOWN_MS) {
        return { fertilized: 0, harvested: 0 };
    }
    lastOrganicAntiStealCheck = now;

    const thresholdMinutes = getOrganicAntiStealMinutes();
    const ANTI_STEAL_THRESHOLD_SEC = thresholdMinutes * 60;
    const nowSec = getServerTimeSec();
    let fertilizedCount = 0;
    let harvestedCount = 0;

    let latestLands;
    try {
        latestLands = await getAllLands();
    } catch (e) {
        logWarn('有机肥防偷', `获取地块数据失败: ${e.message}`);
        return { fertilized: 0, harvested: 0 };
    }

    if (!latestLands || !latestLands.lands) {
        return { fertilized: 0, harvested: 0 };
    }

    const lands = latestLands.lands;
    const antiStealTargets = [];

    for (const land of lands) {
        if (!land || !land.unlocked) continue;
        const landId = toNum(land.id);
        if (!landId) continue;

        const plant = land.plant;
        if (!plant || !plant.phases || plant.phases.length === 0) {
            continue;
        }

        const plantId = toNum(plant.id);
        const plantName = getPlantName(plantId) || plant.name || '未知作物';

        const currentPhase = getCurrentPhase(plant.phases);
        if (!currentPhase) continue;
        if (currentPhase.phase === PlantPhase.DEAD) continue;
        if (currentPhase.phase === PlantPhase.MATURE) continue;

        if (Object.prototype.hasOwnProperty.call(plant, 'left_inorc_fert_times')) {
            const leftTimes = toNum(plant.left_inorc_fert_times);
            if (leftTimes <= 0) continue;
        }

        const maturePhase = plant.phases.find((p) => p && toNum(p.phase) === PlantPhase.MATURE);
        if (!maturePhase) continue;

        const matureBegin = toTimeSec(maturePhase.begin_time);
        const matureInSec = matureBegin > nowSec ? (matureBegin - nowSec) : 0;

        if (matureInSec > 0 && matureInSec <= ANTI_STEAL_THRESHOLD_SEC) {
            const matureInMin = Math.ceil(matureInSec / 60);
            antiStealTargets.push({ landId, plantName, matureInSec, matureInMin });
        }
    }

    if (antiStealTargets.length === 0) {
        return { fertilized: 0, harvested: 0 };
    }

    let organicHoursAvailable = 0;
    try {
        const bag = await getBag();
        const bagItems = getBagItems(bag);
        const containerHours = getContainerHoursFromBagItems(bagItems);
        organicHoursAvailable = containerHours.organic;
    } catch (e) {
        logWarn('有机肥防偷', `检查有机肥库存失败: ${e.message}`);
        return { fertilized: 0, harvested: 0 };
    }

    if (organicHoursAvailable < antiStealTargets.length) {
        return { fertilized: 0, harvested: 0 };
    }

    const targetsSummary = antiStealTargets.map(t => `#${t.landId}(${t.matureInMin}分钟)`).join(', ');
    log('有机肥防偷', `发现 ${antiStealTargets.length} 块地需要防偷: ${targetsSummary}`, {
        module: 'farm',
        event: '有机肥防偷_发现目标',
        count: antiStealTargets.length,
        targets: targetsSummary,
    });

    log('有机肥防偷', '开始施有机肥...', {
        module: 'farm',
        event: '有机肥防偷_开始施肥',
        count: antiStealTargets.length,
    });

    const fertilizedLandIds = [];
    const fertilizedLands = [];

    for (const target of antiStealTargets) {
        try {
            const body = types.FertilizeRequest.encode(types.FertilizeRequest.create({
                land_ids: [toLong(target.landId)],
                fertilizer_id: toLong(ORGANIC_FERTILIZER_ID),
            })).finish();
            await sendMsgAsync('gamepb.plantpb.PlantService', 'Fertilize', body);
            fertilizedCount++;
            fertilizedLandIds.push(target.landId);
            fertilizedLands.push(`#${target.landId}(${target.plantName})`);
        } catch (e) {
            if (e.message && e.message.includes('1000019')) {
                logWarn('有机肥防偷', '有机化肥不足，无法继续防偷');
            } else {
                logWarn('有机肥防偷', `地块 #${target.landId} 施肥失败: ${e.message}`);
            }
            break;
        }
        if (antiStealTargets.length > 1) await sleep(50);
    }

    if (fertilizedCount === 0) {
        return { fertilized: 0, harvested: 0 };
    }

    const fertilizedSummary = fertilizedLands.join(', ');
    log('有机肥防偷', `施肥完成，成功 ${fertilizedCount}/${antiStealTargets.length} 块: ${fertilizedSummary}，等待服务器更新...`, {
        module: 'farm',
        event: '有机肥防偷_施肥完成',
        count: fertilizedCount,
        lands: fertilizedSummary,
    });
    recordOperation('fertilize', fertilizedCount);

    await sleep(25);// 等待服务器更新

    log('有机肥防偷', '开始收获施肥成功的地块...', {
        module: 'farm',
        event: '有机肥防偷_开始收获',
    });

    try {
        await harvest(fertilizedLandIds);
        harvestedCount = fertilizedCount;

        const details = fertilizedLands.join(', ');
        log('有机肥防偷', `收获完成！共收获 ${harvestedCount} 块地: ${details}`, {
            module: 'farm',
            event: '有机肥防偷_收获成功',
            count: harvestedCount,
            lands: fertilizedLandIds,
        });

        recordOperation('antiSteal', harvestedCount);
        recordOperation('harvest', harvestedCount);
        networkEvents.emit('farmHarvested', {
            count: harvestedCount,
            landIds: fertilizedLandIds,
            opType: 'antiSteal',
        });

        try {
            await removePlant(fertilizedLandIds);
            log('有机肥防偷', `已铲除 ${fertilizedLandIds.length} 块枯萎残留`, {
                module: 'farm',
                event: '有机肥防偷_铲除残留',
                count: fertilizedLandIds.length,
            });
        } catch (e) {
            logWarn('有机肥防偷', `铲除枯萎残留失败: ${e.message}`);
        }
    } catch (e) {
        const msg = String(e.message || '');
        if (msg.includes('1001021') || msg.includes('作物未成熟')) {
            logWarn('有机肥防偷', `作物尚未成熟，稍后自动重试收获`);
            lastOrganicAntiStealCheck = 0;// 重置上次检查时间，稍后重试
        } else {
            logWarn('有机肥防偷', `收获失败: ${msg}`);
        }
    }

    return { fertilized: fertilizedCount, harvested: harvestedCount };
}

async function removePlant(landIds) {
    const body = types.RemovePlantRequest.encode(types.RemovePlantRequest.create({
        land_ids: landIds.map(id => toLong(id)),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'RemovePlant', body);
    return types.RemovePlantReply.decode(replyBody);
}

async function upgradeLand(landId) {
    const body = types.UpgradeLandRequest.encode(types.UpgradeLandRequest.create({
        land_id: toLong(landId),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'UpgradeLand', body);
    return types.UpgradeLandReply.decode(replyBody);
}

async function unlockLand(landId, doShared = false) {
    const body = types.UnlockLandRequest.encode(types.UnlockLandRequest.create({
        land_id: toLong(landId),
        do_shared: !!doShared,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'UnlockLand', body);
    return types.UnlockLandReply.decode(replyBody);
}

// ============ 商店 API ============

async function getShopInfo(shopId) {
    const body = types.ShopInfoRequest.encode(types.ShopInfoRequest.create({
        shop_id: toLong(shopId),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.shoppb.ShopService', 'ShopInfo', body);
    return types.ShopInfoReply.decode(replyBody);
}

async function buyGoods(goodsId, num, price) {
    const body = types.BuyGoodsRequest.encode(types.BuyGoodsRequest.create({
        goods_id: toLong(goodsId),
        num: toLong(num),
        price: toLong(price),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.shoppb.ShopService', 'BuyGoods', body);
    return types.BuyGoodsReply.decode(replyBody);
}

// ============ 种植 ============

function encodePlantRequest(seedId, landIds) {
    const writer = protobuf.Writer.create();
    const itemWriter = writer.uint32(18).fork();
    itemWriter.uint32(8).int64(seedId);
    const idsWriter = itemWriter.uint32(18).fork();
    for (const id of landIds) {
        idsWriter.int64(id);
    }
    idsWriter.ldelim();
    itemWriter.ldelim();
    return writer.finish();
}

function getPlantSizeBySeedId(seedId) {
    const plantCfg = getPlantBySeedId(toNum(seedId));
    return Math.max(1, toNum(plantCfg && plantCfg.size) || 1);
}

/**
 * 种植 - 游戏中拖动种植间隔很短，这里用 50ms
 */
async function plantSeeds(seedId, landIds, options = {}) {
    let successCount = 0;
    const plantedLandIds = [];
    const occupiedLandIds = new Set();
    const maxPlantCount = Math.max(0, toNum(options.maxPlantCount) || 0) || Number.POSITIVE_INFINITY;
    const pendingLandIds = new Set((Array.isArray(landIds) ? landIds : []).map(id => toNum(id)).filter(Boolean));

    for (const rawLandId of landIds) {
        const landId = toNum(rawLandId);
        if (!landId || !pendingLandIds.has(landId)) continue;
        if (successCount >= maxPlantCount) break;

        try {
            const body = encodePlantRequest(seedId, [landId]);
            const { body: replyBody } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Plant', body);
            const reply = types.PlantReply.decode(replyBody);
            const changedLands = Array.isArray(reply && reply.land) ? reply.land : [];
            const changedMap = buildLandMap(changedLands);
            const selfLand = changedMap.get(landId);
            const displayContext = getDisplayLandContext(selfLand || { id: landId }, changedMap);
            const occupiedIds = displayContext.occupiedLandIds.length > 0
                ? displayContext.occupiedLandIds
                : [landId];

            successCount++;
            plantedLandIds.push(displayContext.masterLandId || landId);
            for (const occupiedId of occupiedIds) {
                occupiedLandIds.add(occupiedId);
                pendingLandIds.delete(occupiedId);
            }
        } catch (e) {
            logWarn('种植', `土地#${landId} 失败: ${e.message}`);
        }
        if (landIds.length > 1) await sleep(50);  // 50ms 间隔
    }
    return {
        planted: successCount,
        plantedLandIds,
        occupiedLandIds: [...occupiedLandIds],
    };
}

async function findBestSeed() {
    const SEED_SHOP_ID = 2;
    const shopReply = await getShopInfo(SEED_SHOP_ID);
    if (!shopReply.goods_list || shopReply.goods_list.length === 0) {
        logWarn('商店', '种子商店无商品');
        return null;
    }

    const state = getUserState();
    const available = [];
    for (const goods of shopReply.goods_list) {
        if (!goods.unlocked) continue;

        let meetsConditions = true;
        let requiredLevel = 0;
        const conds = goods.conds || [];
        for (const cond of conds) {
            if (toNum(cond.type) === 1) {
                requiredLevel = toNum(cond.param);
                if (state.level < requiredLevel) {
                    meetsConditions = false;
                    break;
                }
            }
        }
        if (!meetsConditions) continue;

        const limitCount = toNum(goods.limit_count);
        const boughtNum = toNum(goods.bought_num);
        if (limitCount > 0 && boughtNum >= limitCount) continue;

        available.push({
            goods,
            goodsId: toNum(goods.id),
            seedId: toNum(goods.item_id),
            price: toNum(goods.price),
            requiredLevel,
        });
    }

    if (available.length === 0) {
        logWarn('商店', '没有可购买的种子');
        return null;
    }

    // 按策略排序
    const strategy = getPlantingStrategy();
    const analyticsSortByMap = {
        max_exp: 'exp',
        max_fert_exp: 'fert',
        max_profit: 'profit',
        max_fert_profit: 'fert_profit',
    };
    const analyticsSortBy = analyticsSortByMap[strategy];
    if (analyticsSortBy) {
        try {
            const rankings = getPlantRankings(analyticsSortBy);
            const availableBySeedId = new Map(available.map(a => [a.seedId, a]));
            for (const row of rankings) {
                const seedId = Number(row && row.seedId) || 0;
                if (seedId <= 0) continue;
                const lv = Number(row && row.level);
                if (Number.isFinite(lv) && lv > state.level) continue;
                const found = availableBySeedId.get(seedId);
                if (found) return found;
            }
            logWarn('商店', `策略 ${strategy} 未找到可购买作物，回退最高等级`);
        } catch (e) {
            logWarn('商店', `策略 ${strategy} 计算失败: ${e.message}，回退最高等级`);
        }
        available.sort((a, b) => b.requiredLevel - a.requiredLevel);
        return available[0];
    }
    
    // 偏好模式
    if (strategy === 'preferred') {
        const preferred = getPreferredSeed();
        if (preferred > 0) {
            const found = available.find(a => a.seedId === preferred);
            if (found) return found;
            logWarn('商店', `优先种子 ${preferred} 当前不可购买，回退自动选择`);
        }
        // 如果偏好未找到或未设置，回退到默认（等级最高）
        available.sort((a, b) => b.requiredLevel - a.requiredLevel);
    }
    // 最高等级模式
    else if (strategy === 'level') {
        available.sort((a, b) => b.requiredLevel - a.requiredLevel);
    } 
    // 默认
    else {
        available.sort((a, b) => b.requiredLevel - a.requiredLevel);
    }

    return available[0];
}

async function getAvailableSeeds() {
    const SEED_SHOP_ID = 2;
    const state = getUserState();
    let list = [];
    
    try {
        const shopReply = await getShopInfo(SEED_SHOP_ID);
        if (shopReply.goods_list) {
            for (const goods of shopReply.goods_list) {
                // 不再过滤不可用的种子，而是返回给前端展示状态
                let requiredLevel = 0;
                for (const cond of goods.conds || []) {
                    if (toNum(cond.type) === 1) requiredLevel = toNum(cond.param);
                }
                
                const limitCount = toNum(goods.limit_count);
                const boughtNum = toNum(goods.bought_num);
                const isSoldOut = limitCount > 0 && boughtNum >= limitCount;

                const seedId = toNum(goods.item_id);
                const plantCfg = getPlantBySeedId(seedId);
                const plantId = toNum(plantCfg && plantCfg.id);

                list.push({
                    seedId,
                    plantId,
                    goodsId: toNum(goods.id),
                    name: getPlantNameBySeedId(seedId),
                    price: toNum(goods.price),
                    requiredLevel,
                    image: getSeedImageBySeedId(seedId),
                    locked: !goods.unlocked || state.level < requiredLevel,
                    soldOut: isSoldOut,
                });
            }
        }
    } catch (e) {
        const wsErr = getWsErrorState();
        if (!wsErr || Number(wsErr.code) !== 400) {
            logWarn('商店', `获取商店失败: ${e.message}，使用本地备选列表`);
        }
    }

    // 如果商店请求失败或为空，使用本地配置
    if (list.length === 0) {
        const allSeeds = getAllSeeds();
        list = allSeeds.map(s => ({
            ...s,
            goodsId: 0,
            price: null, // 未知价格
            requiredLevel: null, // 未知等级
            unknownMeta: true,
            locked: false,
            soldOut: false,
        }));
    }
    return list.sort((a, b) => {
        const av = (a.requiredLevel === null || a.requiredLevel === undefined) ? 9999 : a.requiredLevel;
        const bv = (b.requiredLevel === null || b.requiredLevel === undefined) ? 9999 : b.requiredLevel;
        return av - bv;
    });
}

async function getLandsDetail() {
    try {
        const landsReply = await getAllLands();
        if (!landsReply.lands) return { lands: [], summary: {} };
        const nowSec = getServerTimeSec();
        const landsMap = buildLandMap(landsReply.lands);
        const lands = [];

        for (const land of landsReply.lands) {
            const id = toNum(land.id);
            const level = toNum(land.level);
            const maxLevel = toNum(land.max_level);
            const landsLevel = toNum(land.lands_level);
            const landSize = toNum(land.land_size);
            const couldUnlock = !!land.could_unlock;
            const couldUpgrade = !!land.could_upgrade;
            const {
                sourceLand,
                occupiedByMaster,
                masterLandId,
                occupiedLandIds,
            } = getDisplayLandContext(land, landsMap);
            if (!land.unlocked) {
                lands.push({
                    id,
                    unlocked: false,
                    status: 'locked',
                    plantName: '',
                    phaseName: '',
                    level,
                    maxLevel,
                    landsLevel,
                    landSize,
                    couldUnlock,
                    couldUpgrade,
                    currentSeason: 0,
                    totalSeason: 0,
                    occupiedByMaster: false,
                    masterLandId: 0,
                    occupiedLandIds: [],
                    plantSize: 1,
                });
                continue;
            }
            const plant = sourceLand && sourceLand.plant;
            if (!plant || !plant.phases || plant.phases.length === 0) {
                lands.push({
                    id,
                    unlocked: true,
                    status: 'empty',
                    plantName: '',
                    phaseName: '空地',
                    level,
                    maxLevel,
                    landsLevel,
                    landSize,
                    couldUnlock,
                    couldUpgrade,
                    currentSeason: 0,
                    totalSeason: 0,
                    occupiedByMaster,
                    masterLandId,
                    occupiedLandIds,
                    plantSize: 1,
                });
                continue;// 空土地，直接添加到结果列表
            }
            const currentPhase = getCurrentPhase(plant.phases, false, '');
            if (!currentPhase) {
                lands.push({
                    id,
                    unlocked: true,
                    status: 'empty',
                    plantName: '',
                    phaseName: '',
                    level,
                    maxLevel,
                    landsLevel,
                    landSize,
                    couldUnlock,
                    couldUpgrade,
                    currentSeason: 0,
                    totalSeason: 0,
                    occupiedByMaster,
                    masterLandId,
                    occupiedLandIds,
                    plantSize: 1,
                });
                continue;
            }
            const phaseVal = currentPhase.phase;
            const plantId = toNum(plant.id);
            const plantName = getPlantName(plantId) || plant.name || '未知';
            const plantCfg = getPlantById(plantId);
            const seedId = toNum(plantCfg && plantCfg.seed_id);
            const seedImage = seedId > 0 ? getSeedImageBySeedId(seedId) : '';
            const plantSize = Math.max(1, toNum(plantCfg && plantCfg.size) || 1);
            const totalSeason = Math.max(1, toNum(plantCfg && plantCfg.seasons) || 1);
            const currentSeasonRaw = toNum(plant.season);
            const currentSeason = currentSeasonRaw > 0 ? Math.min(currentSeasonRaw, totalSeason) : 1;
            const phaseName = PHASE_NAMES[phaseVal] || '';
            const maturePhase = Array.isArray(plant.phases)
                ? plant.phases.find((p) => p && toNum(p.phase) === PlantPhase.MATURE)
                : null;
            const matureBegin = maturePhase ? toTimeSec(maturePhase.begin_time) : 0;
            const matureInSec = matureBegin > nowSec ? (matureBegin - nowSec) : 0;

            let landStatus = 'growing';
            if (phaseVal === PlantPhase.MATURE) landStatus = 'harvestable';
            else if (phaseVal === PlantPhase.DEAD) landStatus = 'dead';
            else if (phaseVal === PlantPhase.UNKNOWN || !plant.phases.length) landStatus = 'empty';

            const needWater = (toNum(plant.dry_num) > 0) || (toTimeSec(currentPhase.dry_time) > 0 && toTimeSec(currentPhase.dry_time) <= nowSec);
            const needWeed = (plant.weed_owners && plant.weed_owners.length > 0) || (toTimeSec(currentPhase.weeds_time) > 0 && toTimeSec(currentPhase.weeds_time) <= nowSec);
            const needBug = (plant.insect_owners && plant.insect_owners.length > 0) || (toTimeSec(currentPhase.insect_time) > 0 && toTimeSec(currentPhase.insect_time) <= nowSec);

            lands.push({
                id,
                unlocked: true,
                status: landStatus,
                plantName,
                seedId,
                seedImage,
                phaseName,
                matureInSec,
                needWater,
                needWeed,
                needBug,
                stealable: !!plant.stealable,
                level,
                maxLevel,
                landsLevel,
                landSize,
                couldUnlock,
                couldUpgrade,
                occupiedByMaster,
                masterLandId,
                occupiedLandIds,
                plantSize,
                currentSeason,
                totalSeason,
            });
        }

        return {
            lands,
            summary: summarizeLandDetails(lands),
        };
    } catch {
        return { lands: [], summary: {} };
    }
}

async function autoPlantEmptyLands(deadLandIds, emptyLandIds) {
    const landsToPlant = [...emptyLandIds];
    const state = getUserState();

    // 1. 铲除枯死/收获残留植物（一键操作）
    if (deadLandIds.length > 0) {
        try {
            await removePlant(deadLandIds);
            log('铲除', `已铲除 ${deadLandIds.length} 块 (${deadLandIds.join(',')})`, {
                module: 'farm', event: 'remove_plant', result: 'ok', count: deadLandIds.length
            });
            landsToPlant.push(...deadLandIds);
        } catch (e) {
            logWarn('铲除', `批量铲除失败: ${e.message}`, {
                module: 'farm', event: 'remove_plant', result: 'error'
            });
            // 失败时仍然尝试种植
            landsToPlant.push(...deadLandIds);
        }
    }

    if (landsToPlant.length === 0) return;

    // 2. 查询种子商店
    let bestSeed;
    try {
        bestSeed = await findBestSeed();
    } catch (e) {
        logWarn('商店', `查询失败: ${e.message}`);
        return;
    }
    if (!bestSeed) return;

    const seedName = getPlantNameBySeedId(bestSeed.seedId);
    const growTime = getPlantGrowTime(1020000 + (bestSeed.seedId - 20000));  // 转换为植物ID
    const growTimeStr = growTime > 0 ? ` 生长${formatGrowTime(growTime)}` : '';
    const plantSize = getPlantSizeBySeedId(bestSeed.seedId);
    const landFootprint = plantSize * plantSize;
    log('商店', `最佳种子: ${seedName} (${bestSeed.seedId}) 价格=${bestSeed.price}金币${growTimeStr}`, {
        module: 'warehouse', event: 'seed_pick', seedId: bestSeed.seedId, price: bestSeed.price
    });

    // 3. 购买
    let needCount = landsToPlant.length;
    if (landFootprint > 1) {
        needCount = Math.floor(landsToPlant.length / landFootprint);
        if (needCount <= 0) {
            log('种植', `${seedName} 需要至少 ${landFootprint} 块空地才能合并种植，当前仅 ${landsToPlant.length} 块可用，已跳过`, {
                module: 'farm',
                event: 'plant_seed',
                result: 'skip',
                seedId: bestSeed.seedId,
                landFootprint,
                emptyCount: landsToPlant.length,
            });
            return;
        }
    }
    const totalCost = bestSeed.price * needCount;
    if (totalCost > state.gold) {
        logWarn('商店', `金币不足! 需要 ${totalCost} 金币, 当前 ${state.gold} 金币`, {
            module: 'farm', event: 'seed_buy_skip', result: 'insufficient_gold', need: totalCost, current: state.gold
        });
        const canBuy = Math.floor(state.gold / bestSeed.price);
        if (canBuy <= 0) return;
        needCount = canBuy;
        log('商店', plantSize > 1 ? `金币有限，只尝试种植 ${canBuy} 组 ${plantSize}x${plantSize} 作物` : `金币有限，只种 ${canBuy} 块地`);
    }

    let actualSeedId = bestSeed.seedId;
    try {
        const buyReply = await buyGoods(bestSeed.goodsId, needCount, bestSeed.price);
        if (buyReply.get_items && buyReply.get_items.length > 0) {
            const gotItem = buyReply.get_items[0];
            const gotId = toNum(gotItem.id);
            if (gotId > 0) actualSeedId = gotId;
        }
        if (buyReply.cost_items) {
            for (const item of buyReply.cost_items) {
                state.gold -= toNum(item.count);
            }
        }
        const boughtName = getPlantNameBySeedId(actualSeedId);
        log('购买', `已购买 ${boughtName}种子 x${needCount}, 花费 ${bestSeed.price * needCount} 金币`, {
            module: 'warehouse',
            event: 'seed_buy',
            result: 'ok',
            seedId: actualSeedId,
            count: needCount,
            cost: bestSeed.price * needCount,
        });
    } catch (e) {
        logWarn('购买', e.message);
        return;
    }

    // 4. 种植（逐块拖动，间隔50ms）
    let plantedLands = [];
    try {
        const { planted, plantedLandIds, occupiedLandIds } = await plantSeeds(actualSeedId, landsToPlant, { maxPlantCount: needCount });
        const occupiedCount = occupiedLandIds.length > 0 ? occupiedLandIds.length : planted;
        log('种植', plantSize > 1
            ? `已种植 ${planted} 组 ${plantSize}x${plantSize} 作物，占用 ${occupiedCount} 块地 (${occupiedLandIds.join(',')})`
            : `已在 ${planted} 块地种植 (${landsToPlant.slice(0, planted).join(',')})`, {
            module: 'farm',
            event: 'plant_seed',
            result: 'ok',
            seedId: actualSeedId,
            count: planted,
            occupiedCount,
        });
        if (planted > 0) {
            plantedLands = plantedLandIds;
        }
    } catch (e) {
        logWarn('种植', e.message);
    }

    // 5. 施肥
    await runFertilizerByConfig(plantedLands);
}

function getCurrentPhase(phases, debug, landLabel) {
    if (!phases || phases.length === 0) return null;

    const nowSec = getServerTimeSec();

    if (debug) {
        console.warn(`    ${landLabel} 服务器时间=${nowSec} (${new Date(nowSec * 1000).toLocaleTimeString()})`);
        for (let i = 0; i < phases.length; i++) {
            const p = phases[i];
            const bt = toTimeSec(p.begin_time);
            const phaseName = PHASE_NAMES[p.phase] || `阶段${p.phase}`;
            const diff = bt > 0 ? (bt - nowSec) : 0;
            const diffStr = diff > 0 ? `(未来 ${diff}s)` : diff < 0 ? `(已过 ${-diff}s)` : '';
            console.warn(`    ${landLabel}   [${i}] ${phaseName}(${p.phase}) begin=${bt} ${diffStr} dry=${toTimeSec(p.dry_time)} weed=${toTimeSec(p.weeds_time)} insect=${toTimeSec(p.insect_time)}`);
        }
    }

    for (let i = phases.length - 1; i >= 0; i--) {
        const beginTime = toTimeSec(phases[i].begin_time);
        if (beginTime > 0 && beginTime <= nowSec) {
            if (debug) {
                console.warn(`    ${landLabel}   → 当前阶段: ${PHASE_NAMES[phases[i].phase] || phases[i].phase}`);
            }
            return phases[i];
        }
    }

    if (debug) {
        console.warn(`    ${landLabel}   → 所有阶段都在未来，使用第一个: ${PHASE_NAMES[phases[0].phase] || phases[0].phase}`);
    }
    return phases[0];
}

function analyzeLands(lands) {
    const result = {
        harvestable: [], needWater: [], needWeed: [], needBug: [],
        growing: [], empty: [], dead: [], unlockable: [], upgradable: [],
        harvestableInfo: [],
    };

    const nowSec = getServerTimeSec();
    const debug = isFirstFarmCheck;
    const landsMap = buildLandMap(lands);

    for (const land of lands) {
        const id = toNum(land.id);
        if (!land.unlocked) {
            if (land.could_unlock) {
                result.unlockable.push(id);
            }
            continue;
        }
        if (land.could_upgrade) {
            result.upgradable.push(id);
        }

        if (isOccupiedSlaveLand(land, landsMap)) {
            continue;
        }

        const plant = land.plant;
        if (!plant || !plant.phases || plant.phases.length === 0) {
            result.empty.push(id);
            continue;
        }

        const plantName = plant.name || '未知作物';
        const landLabel = `土地#${id}(${plantName})`;

        const currentPhase = getCurrentPhase(plant.phases, debug, landLabel);
        if (!currentPhase) {
            result.empty.push(id);
            continue;
        }
        const phaseVal = currentPhase.phase;

        if (phaseVal === PlantPhase.DEAD) {
            result.dead.push(id);
            continue;
        }

        if (phaseVal === PlantPhase.MATURE) {
            result.harvestable.push(id);
            const plantId = toNum(plant.id);
            const plantNameFromConfig = getPlantName(plantId);
            const plantExp = getPlantExp(plantId);
            result.harvestableInfo.push({
                landId: id,
                plantId,
                name: plantNameFromConfig || plantName,
                exp: plantExp,
            });
            continue;
        }

        const dryNum = toNum(plant.dry_num);
        const dryTime = toTimeSec(currentPhase.dry_time);
        if (dryNum > 0 || (dryTime > 0 && dryTime <= nowSec)) {
            result.needWater.push(id);
        }

        const weedsTime = toTimeSec(currentPhase.weeds_time);
        const hasWeeds = (plant.weed_owners && plant.weed_owners.length > 0) || (weedsTime > 0 && weedsTime <= nowSec);
        if (hasWeeds) {
            result.needWeed.push(id);
        }

        const insectTime = toTimeSec(currentPhase.insect_time);
        const hasBugs = (plant.insect_owners && plant.insect_owners.length > 0) || (insectTime > 0 && insectTime <= nowSec);
        if (hasBugs) {
            result.needBug.push(id);
        }

        result.growing.push(id);
    }

    return result;
}

function buildLandMap(lands) {
    const map = new Map();
    const list = Array.isArray(lands) ? lands : [];
    for (const land of list) {
        const id = toNum(land && land.id);
        if (id > 0) map.set(id, land);
    }
    return map;
}

function getLandLifecycleState(land) {
    if (!land) return 'unknown';
    const plant = land.plant;
    if (!plant || !Array.isArray(plant.phases) || plant.phases.length === 0) {
        return 'empty';
    }

    const currentPhase = getCurrentPhase(plant.phases, false, '');
    if (!currentPhase) return 'empty';

    const phaseVal = toNum(currentPhase.phase);
    if (phaseVal === PlantPhase.DEAD) return 'dead';
    if (phaseVal === PlantPhase.UNKNOWN) return 'empty';
    if (phaseVal >= PlantPhase.SEED && phaseVal <= PlantPhase.MATURE) return 'growing';
    return 'unknown';
}

function classifyHarvestedLandsByMap(landIds, landsMap) {
    const removable = [];
    const growing = [];
    const unknown = [];
    for (const id of landIds) {
        const land = landsMap.get(id);
        if (!land) {
            unknown.push(id);
            continue;
        }
        const state = getLandLifecycleState(land);
        if (state === 'dead' || state === 'empty') {
            removable.push(id);
            continue;
        }
        if (state === 'growing') {
            growing.push(id);
            continue;
        }
        unknown.push(id);
    }
    return { removable, growing, unknown };
}

async function resolveRemovableHarvestedLands(harvestedLandIds, harvestReply) {
    const ids = Array.isArray(harvestedLandIds) ? harvestedLandIds.filter(Boolean) : [];
    if (ids.length === 0) {
        return { removable: [], growing: [], fallbackRemoved: 0 };
    }

    const replyMap = buildLandMap(harvestReply && harvestReply.land);
    const firstPass = classifyHarvestedLandsByMap(ids, replyMap);
    const removable = [...firstPass.removable];
    const growing = [...firstPass.growing];
    let unknown = [...firstPass.unknown];
    let fallbackRemoved = 0;

    if (unknown.length > 0) {
        try {
            const latestLandsReply = await getAllLands();
            const latestMap = buildLandMap(latestLandsReply && latestLandsReply.lands);
            const secondPass = classifyHarvestedLandsByMap(unknown, latestMap);
            removable.push(...secondPass.removable);
            growing.push(...secondPass.growing);
            unknown = secondPass.unknown;
        } catch (e) {
            logWarn('农场', `收后状态补拉失败: ${e.message}`, {
                module: 'farm',
                event: 'post_harvest_state_fallback',
                result: 'error',
            });
        }
    }

    if (unknown.length > 0) {
        // 按兼容策略：不可判定时保持旧行为，继续铲除
        removable.push(...unknown);
        fallbackRemoved = unknown.length;
    }

    return {
        removable: [...new Set(removable)],
        growing: [...new Set(growing)],
        fallbackRemoved,
    };
}

async function checkFarm() {
    const state = getUserState();
    if (isCheckingFarm || !state.gid || !isAutomationOn('farm')) return false;
    isCheckingFarm = true;

    try {
        // 复用手动操作逻辑
        const result = await runFarmOperation('all', { automated: true });
        isFirstFarmCheck = false;
        return !!(result && result.hadWork);
    } catch (err) {
        logWarn('巡田', `检查失败: ${err.message}`);
        return false;
    } finally {
        isCheckingFarm = false;
    }
}

/**
 * 手动/自动执行农场操作
 * @param {string} opType - 'all', 'harvest', 'clear', 'plant', 'upgrade'
 */
async function runFarmOperation(opType, options = {}) {
    const isAutomated = !!options.automated;
    const landsReply = await getAllLands();
    if (!landsReply.lands || landsReply.lands.length === 0) {
        if (opType !== 'all') {
            log('农场', '没有土地数据');
        }
        return { hadWork: false, actions: [] };
    }

    const lands = landsReply.lands;
    const status = analyzeLands(lands);

    await runOrganicAntiSteal();

    const statusParts = [];
    if (status.harvestable.length) statusParts.push(`收:${status.harvestable.length}`);
    if (status.needWeed.length) statusParts.push(`草:${status.needWeed.length}`);
    if (status.needBug.length) statusParts.push(`虫:${status.needBug.length}`);
    if (status.needWater.length) statusParts.push(`水:${status.needWater.length}`);
    if (status.dead.length) statusParts.push(`枯:${status.dead.length}`);
    if (status.empty.length) statusParts.push(`空:${status.empty.length}`);
    if (status.unlockable.length) statusParts.push(`解:${status.unlockable.length}`);
    if (status.upgradable.length) statusParts.push(`升:${status.upgradable.length}`);
    statusParts.push(`长:${status.growing.length}`);

    const actions = [];
    const optimizer = getFarmOptimizer();

    // 执行除草/虫/水 (使用并发控制)
    if (opType === 'all' || opType === 'clear') {
        const canAutoManageFarm = !isAutomated || !!isAutomationOn('farm_manage');
        const enableAutoWater = !isAutomated || !!isAutomationOn('farm_water');
        const enableAutoWeed = !isAutomated || !!isAutomationOn('farm_weed');
        const enableAutoBug = !isAutomated || !!isAutomationOn('farm_bug');
        const farmOperations = [];
        
        if (canAutoManageFarm && enableAutoWeed && status.needWeed.length > 0) {
            farmOperations.push({
                type: 'weed',
                landIds: status.needWeed,
                fn: async () => {
                    await weedOut(status.needWeed);
                    actions.push(`除草${status.needWeed.length}`);
                    recordOperation('weed', status.needWeed.length);
                }
            });
        }
        if (canAutoManageFarm && enableAutoBug && status.needBug.length > 0) {
            farmOperations.push({
                type: 'bug',
                landIds: status.needBug,
                fn: async () => {
                    await insecticide(status.needBug);
                    actions.push(`除虫${status.needBug.length}`);
                    recordOperation('bug', status.needBug.length);
                }
            });
        }
        if (canAutoManageFarm && enableAutoWater && status.needWater.length > 0) {
            farmOperations.push({
                type: 'water',
                landIds: status.needWater,
                fn: async () => {
                    await waterLand(status.needWater);
                    actions.push(`浇水${status.needWater.length}`);
                    recordOperation('water', status.needWater.length);
                }
            });
        }
        
        // 使用批量操作优化器执行
        if (farmOperations.length > 0) {
            try {
                await optimizer.batchFarmOperations(farmOperations);
            } catch (e) {
                logWarn('农场', `批量操作失败: ${e.message}`);
            }
        }
    }

    // 执行收获
    let harvestedLandIds = [];// 收获的土地ID列表
    let harvestReply = null;// 收获回复
    let postHarvest = null;// 收获后处理
    if (opType === 'all' || opType === 'harvest') {// 所有操作或收获操作
        if (status.harvestable.length > 0) {
            try {
                harvestReply = await harvest(status.harvestable);
                log('收获', `收获完成 ${status.harvestable.length} 块土地`, {
                    module: 'farm',
                    event: 'harvest_crop',
                    result: 'ok',
                    count: status.harvestable.length,
                    landIds: [...status.harvestable],
                });
                actions.push(`收获${status.harvestable.length}`);
                recordOperation('harvest', status.harvestable.length);
                harvestedLandIds = [...status.harvestable];
                networkEvents.emit('farmHarvested', {
                    count: status.harvestable.length,
                    landIds: [...status.harvestable],
                    opType,
                });
            } catch (e) {
                logWarn('收获', e.message, {
                    module: 'farm',
                    event: 'harvest_crop',
                    result: 'error',
                });
            }
        }
    }

    // 执行种植
    if (opType === 'all' || opType === 'plant') {
        const allEmptyLands = [...new Set(status.empty)];
        let allDeadLands = [...new Set(status.dead)];

        if (opType === 'all' && harvestedLandIds.length > 0) {
            postHarvest = await resolveRemovableHarvestedLands(harvestedLandIds, harvestReply);// 处理可移除的土地
            allDeadLands = [...new Set([...allDeadLands, ...postHarvest.removable])];
        }
        // 注意：如果是单纯点"一键种植"，harvestedLandIds 为空，只种当前的空地/死地
        if (allDeadLands.length > 0 || allEmptyLands.length > 0) {
            try {
                const plantCount = allDeadLands.length + allEmptyLands.length;
                await autoPlantEmptyLands(allDeadLands, allEmptyLands);
                actions.push(`种植${plantCount}`);
                recordOperation('plant', plantCount);
            } catch (e) { logWarn('种植', e.message); }
        }
    }
     if (opType === 'all' && postHarvest && Array.isArray(postHarvest.growing) && postHarvest.growing.length > 0 && isAutomationOn('fertilizer_multi_season')) {
        const multiSeasonTargets = [...new Set(postHarvest.growing.map(v => toNum(v)).filter(Boolean))];
        if (multiSeasonTargets.length > 0) {
            
            try {
                await runFertilizerByConfig(multiSeasonTargets, { reason: 'multi_season' });
            } catch (e) {
                logWarn('施肥', `多季补肥执行失败: ${e.message}`, {
                    module: 'farm',
                    event: '多季补肥',// 事件名称
                    result: 'error',
                });
            }
        }
    }
    // ==================== 土地解锁/升级逻辑 ====================
    // 判断是否需要执行土地升级操作
    // - 手动操作 (opType === 'upgrade')：总是执行
    // - 自动巡查 (opType === 'all')：受 land_upgrade 开关控制
    const shouldAutoUpgrade = opType === 'all' && isAutomationOn('land_upgrade');
    if (shouldAutoUpgrade || opType === 'upgrade') {
        // ---------- 解锁土地 ----------
        // 检查是否有可解锁的土地
        if (status.unlockable.length > 0) {
            let unlocked = 0;
            // 逐个解锁土地
            for (const landId of status.unlockable) {
                try {
                    // 调用解锁接口，false 表示不使用共享解锁
                    await unlockLand(landId, false);
                    log('解锁', `土地#${landId} 解锁成功`, {
                        module: 'farm', event: 'unlock_land', result: 'ok', landId
                    });
                    unlocked++;
                } catch (e) {
                    logWarn('解锁', `土地#${landId} 解锁失败: ${e.message}`, {
                        module: 'farm', event: 'unlock_land', result: 'error', landId
                    });
                }
                // 每次操作间隔 200ms，避免请求过快
                await sleep(200);
            }
            // 记录解锁成功的数量到操作列表
            if (unlocked > 0) {
                actions.push(`解锁${unlocked}`);
            }
        }

        // ---------- 升级土地 ----------
        // 检查是否有可升级的土地
        if (status.upgradable.length > 0) {
            let upgraded = 0;
            // 逐个升级土地
            for (const landId of status.upgradable) {
                try {
                    // 调用升级接口
                    const reply = await upgradeLand(landId);
                    // 获取升级后的新等级
                    const newLevel = reply.land ? toNum(reply.land.level) : '?';
                    log('升级', `土地#${landId} 升级成功 → 等级${newLevel}`, {
                        module: 'farm', event: 'upgrade_land', result: 'ok', landId, level: newLevel
                    });
                    upgraded++;
                } catch (e) {
                    log('升级', `土地#${landId} 升级失败: ${e.message}`, {
                        module: 'farm', event: 'upgrade_land', result: 'error', landId
                    });
                }
                // 每次操作间隔 200ms，避免请求过快
                await sleep(200);
            }
            // 记录升级成功的数量到操作列表和统计
            if (upgraded > 0) {
                actions.push(`升级${upgraded}`);
                recordOperation('upgrade', upgraded);
            }
        }
    }

    // ==================== 日志输出 ====================
    // 格式化操作结果字符串，例如: " → 收获3/种植5/解锁1"
    const actionStr = actions.length > 0 ? ` → ${actions.join('/')}` : '';
    // 只有执行了操作才输出日志
    if (actions.length > 0) {
         log('农场', `[${statusParts.join(' ')}]${actionStr}`, {
             module: 'farm', event: 'farm_cycle', opType, actions
         });
    }
    // 返回是否有工作执行和操作列表
    return { hadWork: actions.length > 0, actions };
}

/**
 * 调度下一次农场检查
 * 使用定时器在指定延迟后执行下一次农场检查
 * @param {number} delayMs - 延迟时间（毫秒），默认使用配置的检查间隔
 */
function scheduleNextFarmCheck(delayMs = CONFIG.farmCheckInterval) {
    // 如果使用外部调度器，不执行内部调度
    if (externalSchedulerMode) return;
    // 如果农场检查循环未运行，不调度
    if (!farmLoopRunning) return;
    // 设置定时任务，延迟后执行农场检查
    farmScheduler.setTimeoutTask('farm_check_loop', Math.max(0, delayMs), async () => {
        // 再次检查循环是否仍在运行
        if (!farmLoopRunning) return;
        // 执行农场检查
        await checkFarm();
        // 检查完成后，调度下一次检查
        if (!farmLoopRunning) return;
        scheduleNextFarmCheck(CONFIG.farmCheckInterval);
    });
}

/**
 * 启动农场检查循环
 * 开始定期检查农场状态并执行自动化操作
 * @param {object} options - 配置选项
 * @param {boolean} options.externalScheduler - 是否使用外部调度器
 */
function startFarmCheckLoop(options = {}) {
    // 如果循环已经在运行，直接返回
    if (farmLoopRunning) return;
    // 设置是否使用外部调度器模式
    externalSchedulerMode = !!options.externalScheduler;
    // 标记循环为运行状态
    farmLoopRunning = true;
    // 监听土地变化推送事件
    networkEvents.on('landsChanged', onLandsChangedPush);
    // 如果不是外部调度模式，启动内部定时检查
    if (!externalSchedulerMode) {
        // 2秒后开始第一次检查
        scheduleNextFarmCheck(2000);
    }
}

/**
 * 处理土地变化推送事件
 * 当服务器推送土地状态变化时，触发农场检查
 * @param {Array} lands - 变化的土地列表
 */
let lastPushTime = 0;
function onLandsChangedPush(lands) {
    // 检查推送触发巡田开关是否开启
    if (!isAutomationOn('farm_push')) {
        return;
    }
    // 如果正在检查农场，跳过本次推送
    if (isCheckingFarm) return;
    // 防抖：500ms 内只处理一次推送
    const now = Date.now();
    if (now - lastPushTime < 500) return;
    lastPushTime = now;
    // 记录推送日志
    log('农场', `收到推送: ${lands.length}块土地变化，检查中...`, {
        module: 'farm', event: 'lands_notify', result: 'trigger_check', count: lands.length
    });
    // 延迟 100ms 后执行农场检查，避免与正在进行的检查冲突
    farmScheduler.setTimeoutTask('farm_push_check', 100, async () => {
        if (!isCheckingFarm) await checkFarm();
    });
}

/**
 * 停止农场检查循环
 * 清理所有定时任务和事件监听
 */
function stopFarmCheckLoop() {
    // 标记循环为停止状态
    farmLoopRunning = false;
    // 重置外部调度器模式
    externalSchedulerMode = false;
    // 清理所有定时任务
    farmScheduler.clearAll();
    // 移除土地变化推送事件监听
    networkEvents.removeListener('landsChanged', onLandsChangedPush);
}

/**
 * 刷新农场检查循环
 * 立即重新调度下一次农场检查
 * @param {number} delayMs - 延迟时间（毫秒），默认 200ms
 */
function refreshFarmCheckLoop(delayMs = 200) {
    // 如果循环未运行，不执行
    if (!farmLoopRunning) return;
    // 重新调度下一次检查
    scheduleNextFarmCheck(delayMs);
}

module.exports = {
    checkFarm, startFarmCheckLoop, stopFarmCheckLoop,
    refreshFarmCheckLoop,
    getCurrentPhase,
    setOperationLimitsCallback,
    getAllLands,
    getLandsDetail,
    getAvailableSeeds,
    runFarmOperation,
    runFertilizerByConfig,
    buildLandMap,
    getDisplayLandContext,
    isOccupiedSlaveLand,
};
