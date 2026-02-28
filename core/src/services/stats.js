/**
 * 统计工具 - 重构版
 * 基于状态变化累加收益，而非依赖初始值快照
 */

// 账号 worker 启动时间（每个 worker 独立）
const workerBootAtMs = Date.now();

// 操作计数
const operations = {
    harvest: 0,
    water: 0,
    weed: 0,
    bug: 0,
    fertilize: 0,
    plant: 0,
    steal: 0,
    helpWater: 0,
    helpWeed: 0,
    helpBug: 0,
    taskClaim: 0,
    sell: 0,
    upgrade: 0,
    levelUp: 0,
};

// 状态追踪
const lastState = {
    gold: -1,
    exp: -1,
    coupon: -1,
};

// 会话初始总量（登录成功时记录）
const initialState = {
    gold: null,
    exp: null,
    coupon: null,
};

// 本次会话累计收益
const session = {
    goldGained: 0,
    expGained: 0,
    couponGained: 0,
    lastExpGain: 0, // 最近一次经验增量
    lastGoldGain: 0, // 最近一次金币增量
};

function recordOperation(type, count = 1) {
    if (operations[type] !== undefined) {
        operations[type] += count;
    }
}

/**
 * 初始化状态 (登录时调用)
 */
function initStats(gold, exp, coupon = 0) {
    const g = Number.isFinite(Number(gold)) ? Number(gold) : 0;
    const e = Number.isFinite(Number(exp)) ? Number(exp) : 0;
    const c = Number.isFinite(Number(coupon)) ? Number(coupon) : 0;
    lastState.gold = g;
    lastState.exp = e;
    lastState.coupon = c;
    initialState.gold = g;
    initialState.exp = e;
    initialState.coupon = c;
}

/**
 * 更新状态并计算增量
 * 只要数值增加，就累加到 sessionGains
 */
function updateStats(currentGold, currentExp) {
    // 首次初始化
    if (lastState.gold === -1) lastState.gold = currentGold;
    if (lastState.exp === -1) lastState.exp = currentExp;

    // 计算金币增量
    if (currentGold > lastState.gold) {
        const delta = currentGold - lastState.gold;
        session.lastGoldGain = delta;
        // console.warn(`[Stats] Gold +${delta}`);
    } else if (currentGold < lastState.gold) {
        // 消费了金币，不计入收益，但要更新 lastState
        // console.warn(`[Stats] Gold -${lastState.gold - currentGold}`);
        session.lastGoldGain = 0;
    }
    lastState.gold = currentGold;

    // 计算经验增量 (经验通常只增不减)
    if (currentExp > lastState.exp) {
        const delta = currentExp - lastState.exp;
        
        // 防抖: 如果 1秒内 增加了完全相同的 delta，视为重复包忽略
        const now = Date.now();
        if (delta === session.lastExpGain && (now - (session.lastExpTime || 0) < 1000)) {
            console.warn(`[系统] 忽略重复经验增量 +${delta}`);
        } else {
            session.lastExpGain = delta;
            session.lastExpTime = now;
            console.warn(`[系统] 经验 +${delta} (总计: ${currentExp})`);
        }
    } else {
        session.lastExpGain = 0;
    }
    lastState.exp = currentExp;
}

// 兼容旧接口，重定向到 updateStats
function recordGoldExp(gold, exp) {
    updateStats(gold, exp);
}

function setInitialValues(gold, exp, coupon = 0) {
    initStats(gold, exp, coupon);
}

function resetSessionGains() {
    session.goldGained = 0;
    session.expGained = 0;
    session.couponGained = 0;
    session.lastGoldGain = 0;
    session.lastExpGain = 0;
    session.lastExpTime = 0;
}

function recomputeSessionTotals(currentGold, currentExp, currentCoupon) {
    if (initialState.gold === null || initialState.exp === null || initialState.coupon === null) {
        initialState.gold = currentGold;
        initialState.exp = currentExp;
        initialState.coupon = currentCoupon;
    }
    session.goldGained = currentGold - initialState.gold;
    session.expGained = currentExp - initialState.exp;
    session.couponGained = currentCoupon - initialState.coupon;
}

function getStats(statusData, userState, connected, limits) {
    const statusObj = (statusData && typeof statusData === 'object') ? statusData : {};
    const userObj = (userState && typeof userState === 'object') ? userState : {};

    // 优先使用 network 层 userState（通常是最新实时值），statusData 仅作为兜底
    const rawGold = (userObj.gold !== null && userObj.gold !== undefined) ? userObj.gold : statusObj.gold;
    const rawExp = (userObj.exp !== null && userObj.exp !== undefined) ? userObj.exp : statusObj.exp;
    const rawCoupon = (userObj.coupon !== null && userObj.coupon !== undefined) ? userObj.coupon : statusObj.coupon;
    const currentGold = Number.isFinite(Number(rawGold)) ? Number(rawGold) : 0;
    const currentExp = Number.isFinite(Number(rawExp)) ? Number(rawExp) : 0;
    const currentCoupon = Number.isFinite(Number(rawCoupon)) ? Number(rawCoupon) : 0;

    // 仅在连接就绪后统计，避免登录前 0 -> 登录后真实值被误计为收益
    if (connected) {
        // 兜底统计：即使状态钩子漏掉，也会按当前总值差量累计收益
        updateStats(currentGold, currentExp);
        // 会话总增量 = 当前总量 - 初始总量（不依赖具体操作）
        recomputeSessionTotals(currentGold, currentExp, currentCoupon);
    }

    const operationsSnapshot = { ...operations };
    return {
        connection: { connected },
        status: {
            name: userObj.name || statusObj.name,
            level: statusObj.level || userObj.level || 0,
            gold: currentGold,
            coupon: Number.isFinite(Number(userObj.coupon)) ? Number(userObj.coupon) : 0,
            exp: currentExp,
            platform: statusObj.platform || userObj.platform || 'qq',
        },
        uptime: Math.max(0, Math.floor((Date.now() - workerBootAtMs) / 1000)),
        operations: operationsSnapshot,
        sessionExpGained: session.expGained,
        sessionGoldGained: session.goldGained,
        sessionCouponGained: session.couponGained,
        lastExpGain: session.lastExpGain,
        lastGoldGain: session.lastGoldGain,
        limits,
    };
}

module.exports = {
    recordOperation,
    initStats,
    updateStats,
    setInitialValues, // 兼容旧接口
    recordGoldExp,    // 兼容旧接口
    resetSessionGains,
    getStats,
};
