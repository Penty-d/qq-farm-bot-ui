const process = require('node:process');
/**
 * 运行时存储 - 自动化开关、种子偏好、账号管理
 */

const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { CONFIG: BASE_CONFIG } = require('../config/config');
const { readTextFile, readJsonFile, writeJsonFileAtomic } = require('../services/json-db');

const STORE_FILE = getDataFile('store.json');
const ACCOUNTS_FILE = getDataFile('accounts.json');
const ALLOWED_PLANTING_STRATEGIES = ['preferred', 'level', 'max_exp', 'max_fert_exp', 'max_profit', 'max_fert_profit', 'bag_priority'];
const PUSHOO_CHANNELS = new Set([
    'webhook', 'qmsg', 'serverchan', 'pushplus', 'pushplushxtrip',
    'dingtalk', 'wecom', 'bark', 'gocqhttp', 'onebot', 'atri',
    'pushdeer', 'igot', 'telegram', 'feishu', 'ifttt', 'wecombot',
    'discord', 'wxpusher',
    'custom_request',
]);
const INTERVAL_MAX_SEC = 86400;
const DEFAULT_OFFLINE_DELETE_SEC = 1;
const DEFAULT_FERTILIZER_LAND_TYPES = ['gold', 'black', 'red', 'normal'];
const FERTILIZER_LAND_TYPE_SET = new Set(DEFAULT_FERTILIZER_LAND_TYPES);
const DEFAULT_STEAL_PLANT_BLACKLIST = [];
const DEFAULT_OFFLINE_REMINDER = {
    channel: 'webhook',
    reloginUrlMode: 'none',
    endpoint: '',
    token: '',
    title: '账号下线提醒',
    msg: '账号下线',
    offlineDeleteSec: DEFAULT_OFFLINE_DELETE_SEC,
    offlineDeleteEnabled: false,
    custom_headers: '',
    custom_body: '',
};

const DEFAULT_QR_LOGIN = {
    apiDomain: 'q.qq.com',
};

const DEFAULT_RUNTIME_CLIENT = {
    serverUrl: BASE_CONFIG.serverUrl,
    clientVersion: BASE_CONFIG.clientVersion,
    os: BASE_CONFIG.os,
    device_info: {
        sys_software: (BASE_CONFIG.device_info && BASE_CONFIG.device_info.sys_software) ? BASE_CONFIG.device_info.sys_software : 'iOS 26.2.1',
        network: (BASE_CONFIG.device_info && BASE_CONFIG.device_info.network) ? BASE_CONFIG.device_info.network : 'wifi',
        memory: (BASE_CONFIG.device_info && BASE_CONFIG.device_info.memory) ? BASE_CONFIG.device_info.memory : '7672',
        device_id: (BASE_CONFIG.device_info && BASE_CONFIG.device_info.device_id) ? BASE_CONFIG.device_info.device_id : 'iPhone X<iPhone18,3>',
    },
};
// ============ 全局配置 ============
const DEFAULT_ACCOUNT_CONFIG = {
    automation: {
        farm: true,
        farm_manage: true, // 农场打理总开关（浇水/除草/除虫）
        farm_water: true, // 自动浇水
        farm_weed: true, // 自动除草
        farm_bug: true, // 自动除虫
        farm_push: true,   // 收到 LandsNotify 推送时是否立即触发巡田
        land_upgrade: true, // 是否自动升级土地
        friend: true,       // 好友互动总开关
        friend_help_exp_limit: true, // 帮忙经验达上限后自动停止帮忙
        friend_steal: true, // 偷菜
        friend_steal_blacklist: [...DEFAULT_STEAL_PLANT_BLACKLIST], // 偷菜作物黑名单（按作物ID）
        friend_help: true,  // 帮忙
        friend_bad: false,  // 捣乱(放虫草)
        task: true,
        email: true,
        fertilizer_gift: false,
        fertilizer_buy: false,
        fertilizer_buy_type: 'organic',
        fertilizer_buy_max: 10,
        fertilizer_buy_mode: 'threshold',
        fertilizer_buy_threshold: 100,
        free_gifts: true,
        share_reward: true,
        vip_gift: true,
        month_card: true,
        open_server_gift: true,
        sell: false,
        fertilizer: 'none',
        fertilizer_multi_season: false,
        fertilizer_land_types: [...DEFAULT_FERTILIZER_LAND_TYPES],
    },
    plantingStrategy: 'preferred',
    preferredSeedId: 0,
    bagSeedPriority: [],
    intervals: {
        farm: 2,
        friend: 10,
        farmMin: 2,
        farmMax: 2,
        friendMin: 10,
        friendMax: 10,
    },
    friendBlockLevel: {
        enabled: true,
        Level: 1,
    },
    friendQuietHours: {
        enabled: false,
        start: '23:00',
        end: '07:00',
    },
    friendBlacklist: [],
    friendCache: [],
};
const ALLOWED_AUTOMATION_KEYS = new Set(Object.keys(DEFAULT_ACCOUNT_CONFIG.automation));

let accountFallbackConfig = {
    ...DEFAULT_ACCOUNT_CONFIG,
    automation: {
        ...DEFAULT_ACCOUNT_CONFIG.automation,
        fertilizer_land_types: [...DEFAULT_FERTILIZER_LAND_TYPES],
        friend_steal_blacklist: [...DEFAULT_STEAL_PLANT_BLACKLIST],
    },
    intervals: { ...DEFAULT_ACCOUNT_CONFIG.intervals },
    friendBlockLevel: { ...DEFAULT_ACCOUNT_CONFIG.friendBlockLevel },
    friendQuietHours: { ...DEFAULT_ACCOUNT_CONFIG.friendQuietHours },
};

const globalConfig = {
    accountConfigs: {},
    defaultAccountConfig: cloneAccountConfig(DEFAULT_ACCOUNT_CONFIG),
    ui: {
        theme: 'dark',
    },
    offlineReminder: { ...DEFAULT_OFFLINE_REMINDER },
    qrLogin: { ...DEFAULT_QR_LOGIN },
    runtimeClient: { ...DEFAULT_RUNTIME_CLIENT, device_info: { ...DEFAULT_RUNTIME_CLIENT.device_info } },
    adminPasswordHash: '',
    disablePasswordAuth: false,
};

function normalizeOfflineReminder(input) {
    const src = (input && typeof input === 'object') ? input : {};
    let offlineDeleteSec = Number.parseInt(src.offlineDeleteSec, 10);
    if (!Number.isFinite(offlineDeleteSec) || offlineDeleteSec < 1) {
        offlineDeleteSec = DEFAULT_OFFLINE_REMINDER.offlineDeleteSec;
    }
    const rawChannel = (src.channel !== undefined && src.channel !== null)
        ? String(src.channel).trim().toLowerCase()
        : '';
    const endpoint = (src.endpoint !== undefined && src.endpoint !== null)
        ? String(src.endpoint).trim()
        : DEFAULT_OFFLINE_REMINDER.endpoint;
    const migratedChannel = rawChannel
        || (PUSHOO_CHANNELS.has(String(endpoint || '').trim().toLowerCase())
            ? String(endpoint || '').trim().toLowerCase()
            : DEFAULT_OFFLINE_REMINDER.channel);
    const channel = PUSHOO_CHANNELS.has(migratedChannel)
        ? migratedChannel
        : DEFAULT_OFFLINE_REMINDER.channel;
    const rawReloginUrlMode = (src.reloginUrlMode !== undefined && src.reloginUrlMode !== null)
        ? String(src.reloginUrlMode).trim().toLowerCase()
        : DEFAULT_OFFLINE_REMINDER.reloginUrlMode;
    const reloginUrlMode = new Set(['none', 'qq_link', 'qr_code','all']).has(rawReloginUrlMode)
        ? rawReloginUrlMode
        : DEFAULT_OFFLINE_REMINDER.reloginUrlMode;
    const token = (src.token !== undefined && src.token !== null)
        ? String(src.token).trim()
        : DEFAULT_OFFLINE_REMINDER.token;
    const title = (src.title !== undefined && src.title !== null)
        ? String(src.title).trim()
        : DEFAULT_OFFLINE_REMINDER.title;
    const msg = (src.msg !== undefined && src.msg !== null)
        ? String(src.msg).trim()
        : DEFAULT_OFFLINE_REMINDER.msg;
    const offlineDeleteEnabled = src.offlineDeleteEnabled !== undefined
        ? !!src.offlineDeleteEnabled
        : !!DEFAULT_OFFLINE_REMINDER.offlineDeleteEnabled;
    const custom_headers = (src.custom_headers !== undefined && src.custom_headers !== null)
        ? String(src.custom_headers).trim()
        : DEFAULT_OFFLINE_REMINDER.custom_headers;
    const custom_body = (src.custom_body !== undefined && src.custom_body !== null)
        ? String(src.custom_body).trim()
        : DEFAULT_OFFLINE_REMINDER.custom_body;
    return {
        channel,
        reloginUrlMode,
        endpoint,
        token,
        title,
        msg,
        offlineDeleteSec,
        offlineDeleteEnabled,
        custom_headers,
        custom_body,
    };
}


function normalizeApiDomain(input, fallback = DEFAULT_QR_LOGIN.apiDomain) {
    const raw = String(input || '').trim();
    if (!raw) return fallback;
    const normalized = /^https?:\/\//i.test(raw) ? raw : (`https://${  raw}`);
    try {
        const parsed = new URL(normalized);
        const host = String(parsed.host || '').trim();
        return host || fallback;
    } catch {
        return fallback;
    }
}


function normalizeQrLoginConfig(input) {
    const src = (input && typeof input === 'object') ? input : {};
    return {
        apiDomain: normalizeApiDomain(src.apiDomain, DEFAULT_QR_LOGIN.apiDomain),
    };
}

function normalizeRuntimeClientVersion(input, fallback = DEFAULT_RUNTIME_CLIENT.clientVersion) {
    const raw = String(input || '').trim();
    if (!raw) return fallback;
    if (raw.length > 64) return fallback;
    if (!/^[\w.-]+$/.test(raw)) return fallback;
    return raw;
}

function normalizeRuntimeClientOs(input, fallback = DEFAULT_RUNTIME_CLIENT.os) {
    const raw = String(input || '').trim();
    if (!raw) return fallback;
    if (raw.length > 16) return fallback;
    if (!/^[\w.-]+$/.test(raw)) return fallback;
    return raw;
}

function normalizeRuntimeClientServerUrl(input, fallback = DEFAULT_RUNTIME_CLIENT.serverUrl) {
    const raw = String(input || '').trim();
    if (!raw) return fallback;
    // serverUrl 需要是 base url，query 由 network.connect() 追加
    if (raw.includes('?') || raw.includes('#')) return fallback;
    try {
        const parsed = new URL(raw);
        const protocol = String(parsed.protocol || '').toLowerCase();
        if (protocol !== 'ws:' && protocol !== 'wss:') return fallback;
        return parsed.toString().replace(/\/$/, '');
    } catch {
        return fallback;
    }
}

function normalizeRuntimeClientDeviceInfo(input, fallback = DEFAULT_RUNTIME_CLIENT.device_info) {
    const src = (input && typeof input === 'object') ? input : {};
    const base = (fallback && typeof fallback === 'object') ? fallback : DEFAULT_RUNTIME_CLIENT.device_info;
    const toStr = (v, d, maxLen = 200) => {
        const s = String(v !== undefined && v !== null ? v : d).trim();
        if (!s) return String(d || '').trim();
        return s.length > maxLen ? s.slice(0, maxLen) : s;
    };
    return {
        sys_software: toStr(src.sys_software, base.sys_software, 100),
        network: toStr(src.network, base.network, 32),
        memory: toStr(src.memory, base.memory, 32),
        device_id: toStr(src.device_id, base.device_id, 120),
    };
}

function normalizeRuntimeClientConfig(input) {
    const src = (input && typeof input === 'object') ? input : {};
    const current = normalizeRuntimeClientConfig.current || DEFAULT_RUNTIME_CLIENT;
    const fallback = (current && typeof current === 'object') ? current : DEFAULT_RUNTIME_CLIENT;
    const baseDevice = (fallback.device_info && typeof fallback.device_info === 'object')
        ? fallback.device_info
        : DEFAULT_RUNTIME_CLIENT.device_info;

    const next = {
        serverUrl: normalizeRuntimeClientServerUrl(src.serverUrl, fallback.serverUrl),
        clientVersion: normalizeRuntimeClientVersion(src.clientVersion, fallback.clientVersion),
        os: normalizeRuntimeClientOs(src.os, fallback.os),
        device_info: normalizeRuntimeClientDeviceInfo(src.device_info, baseDevice),
    };
    return next;
}

function getRuntimeClientConfig() {
    const current = globalConfig.runtimeClient || DEFAULT_RUNTIME_CLIENT;
    // 提供当前值作为 normalize fallback
    normalizeRuntimeClientConfig.current = current;
    const normalized = normalizeRuntimeClientConfig(current);
    delete normalizeRuntimeClientConfig.current;
    // device_info.client_version 永远由 clientVersion 派生
    return {
        ...normalized,
        device_info: {
            ...normalized.device_info,
            client_version: normalized.clientVersion,
        },
    };
}

function setRuntimeClientConfig(cfg) {
    const current = getRuntimeClientConfig();
    const incoming = (cfg && typeof cfg === 'object') ? cfg : {};
    const merged = {
        ...current,
        ...incoming,
        device_info: {
            ...(current.device_info || {}),
            ...((incoming.device_info && typeof incoming.device_info === 'object') ? incoming.device_info : {}),
        },
    };
    // normalize 时使用 merged 作为 fallback
    normalizeRuntimeClientConfig.current = merged;
    const normalized = normalizeRuntimeClientConfig(merged);
    delete normalizeRuntimeClientConfig.current;
    globalConfig.runtimeClient = {
        ...normalized,
        device_info: { ...normalized.device_info },
    };
    saveGlobalConfig();
    return getRuntimeClientConfig();
}
function normalizeFertilizerLandTypes(input, fallback = DEFAULT_FERTILIZER_LAND_TYPES) {
    const source = Array.isArray(input) ? input : fallback;
    const normalized = [];
    for (const item of source) {
        const value = String(item || '').trim().toLowerCase();
        if (!FERTILIZER_LAND_TYPE_SET.has(value)) continue;
        if (normalized.includes(value)) continue;
        normalized.push(value);
    }
    return normalized;
}

function normalizeStealPlantBlacklist(input, fallback = DEFAULT_STEAL_PLANT_BLACKLIST) {
    const source = Array.isArray(input) ? input : fallback;
    const normalized = [];
    for (const item of source) {
        const value = Number.parseInt(item, 10);
        if (!Number.isFinite(value) || value <= 0) continue;
        if (normalized.includes(value)) continue;
        normalized.push(value);
    }
    return normalized;
}

function normalizeBagSeedPriority(input) {
    if (!Array.isArray(input)) return [];
    const normalized = [];
    for (const item of input) {
        const value = Number.parseInt(item, 10);
        if (!Number.isFinite(value) || value <= 0) continue;
        if (normalized.includes(value)) continue;
        normalized.push(value);
    }
    return normalized;
}

function normalizeFertilizerBuyAutomation(automation) {
    const next = (automation && typeof automation === 'object') ? automation : {};
    const mode = String(next.fertilizer_buy_mode || '').trim().toLowerCase();
    const type = String(next.fertilizer_buy_type || '').trim().toLowerCase();
    if (mode === 'unlimited' && type === 'both') {
        next.fertilizer_buy_type = 'organic';
    }
    return next;
}

function normalizeFriendCache(input) {
    if (!Array.isArray(input)) return [];
    const seen = new Set();
    const normalized = [];
    for (const item of input) {
        if (!item || typeof item !== 'object') continue;
        const gid = Number(item.gid);
        if (!Number.isFinite(gid) || gid <= 0) continue;
        if (seen.has(gid)) continue;
        seen.add(gid);
        normalized.push({
            gid,
            nick: String(item.nick || '').trim() || `GID:${gid}`,
            avatarUrl: String(item.avatarUrl || '').trim(),
        });
    }
    return normalized;
}

function mergeFriendCache(existing, newItems) {
    const merged = normalizeFriendCache(existing);
    const seen = new Set(merged.map(f => f.gid));
    const toAdd = normalizeFriendCache(newItems);
    for (const item of toAdd) {
        if (seen.has(item.gid)) {
            const idx = merged.findIndex(f => f.gid === item.gid);
            if (idx >= 0) {
                merged[idx] = { ...merged[idx], ...item };
            }
        } else {
            seen.add(item.gid);
            merged.push(item);
        }
    }
    return merged;
}

function cloneAccountConfig(base = DEFAULT_ACCOUNT_CONFIG) {
    const srcAutomation = (base && base.automation && typeof base.automation === 'object')
        ? base.automation
        : {};
    const automation = { ...DEFAULT_ACCOUNT_CONFIG.automation };
    for (const key of Object.keys(automation)) {
        if (key === 'fertilizer_land_types') {
            automation[key] = normalizeFertilizerLandTypes(srcAutomation[key], DEFAULT_FERTILIZER_LAND_TYPES);
            continue;
        }
        if (key === 'friend_steal_blacklist') {
            automation[key] = normalizeStealPlantBlacklist(srcAutomation[key], DEFAULT_STEAL_PLANT_BLACKLIST);
            continue;
        }
        if (srcAutomation[key] !== undefined) automation[key] = srcAutomation[key];
    }
    normalizeFertilizerBuyAutomation(automation);

    const rawBlacklist = Array.isArray(base.friendBlacklist) ? base.friendBlacklist : [];
    const rawFriendCache = Array.isArray(base.friendCache) ? base.friendCache : [];
    return {
        ...base,
        automation,
        intervals: { ...(base.intervals || DEFAULT_ACCOUNT_CONFIG.intervals) },
        friendBlockLevel: { ...(base.friendBlockLevel || DEFAULT_ACCOUNT_CONFIG.friendBlockLevel) },
        friendQuietHours: { ...(base.friendQuietHours || DEFAULT_ACCOUNT_CONFIG.friendQuietHours) },
        friendBlacklist: rawBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0),
        friendCache: normalizeFriendCache(rawFriendCache),
        plantingStrategy: ALLOWED_PLANTING_STRATEGIES.includes(String(base.plantingStrategy || ''))
            ? String(base.plantingStrategy)
            : DEFAULT_ACCOUNT_CONFIG.plantingStrategy,
        preferredSeedId: Math.max(0, Number.parseInt(base.preferredSeedId, 10) || 0),
        bagSeedPriority: normalizeBagSeedPriority(base.bagSeedPriority),
    };
}

function resolveAccountId(accountId) {
    const direct = (accountId !== undefined && accountId !== null) ? String(accountId).trim() : '';
    if (direct) return direct;
    const envId = String(process.env.FARM_ACCOUNT_ID || '').trim();
    return envId;
}

function normalizeAccountConfig(input, fallback = accountFallbackConfig) {
    const src = (input && typeof input === 'object') ? input : {};
    const cfg = cloneAccountConfig(fallback || DEFAULT_ACCOUNT_CONFIG);

    if (src.automation && typeof src.automation === 'object') {
        for (const [k, v] of Object.entries(src.automation)) {
            if (!ALLOWED_AUTOMATION_KEYS.has(k)) continue;
            if (k === 'fertilizer') {
                const allowed = ['both', 'normal', 'organic', 'none'];
                cfg.automation[k] = allowed.includes(v) ? v : cfg.automation[k];
            } else if (k === 'fertilizer_buy_type') {
                cfg.automation[k] = ['organic', 'normal', 'both'].includes(v) ? v : cfg.automation[k];
            } else if (k === 'fertilizer_buy_mode') {
                cfg.automation[k] = ['threshold', 'unlimited'].includes(v) ? v : cfg.automation[k];
            } else if (k === 'fertilizer_buy_max') {
                const n = Number(v);
                cfg.automation[k] = (Number.isFinite(n) && n >= 1 && n <= 10) ? Math.floor(n) : cfg.automation[k];
            } else if (k === 'fertilizer_buy_threshold') {
                const n = Number(v);
                cfg.automation[k] = (Number.isFinite(n) && n >= 0) ? n : cfg.automation[k];
            } else if (k === 'fertilizer_land_types') {
                cfg.automation[k] = normalizeFertilizerLandTypes(v, cfg.automation[k]);
            } else if (k === 'friend_steal_blacklist') {
                cfg.automation[k] = normalizeStealPlantBlacklist(v, cfg.automation[k]);
            } else {
                cfg.automation[k] = !!v;
            }
        }
        normalizeFertilizerBuyAutomation(cfg.automation);
    }

    if (src.plantingStrategy && ALLOWED_PLANTING_STRATEGIES.includes(src.plantingStrategy)) {
        cfg.plantingStrategy = src.plantingStrategy;
    }

    if (src.preferredSeedId !== undefined && src.preferredSeedId !== null) {
        cfg.preferredSeedId = Math.max(0, Number.parseInt(src.preferredSeedId, 10) || 0);
    }

    if (src.bagSeedPriority !== undefined) {
        cfg.bagSeedPriority = normalizeBagSeedPriority(src.bagSeedPriority);
    }

    if (src.intervals && typeof src.intervals === 'object') {
        for (const [type, sec] of Object.entries(src.intervals)) {
            if (cfg.intervals[type] === undefined) continue;
            cfg.intervals[type] = Math.max(1, Number.parseInt(sec, 10) || cfg.intervals[type] || 1);
        }
        cfg.intervals = normalizeIntervals(cfg.intervals);
    } else {
        cfg.intervals = normalizeIntervals(cfg.intervals);
    }

    if (src.friendBlockLevel && typeof src.friendBlockLevel === 'object') {
        const old = cfg.friendBlockLevel || {};
        cfg.friendBlockLevel = {
            enabled: src.friendBlockLevel.enabled !== undefined ? !!src.friendBlockLevel.enabled : !!old.enabled,
            Level: normalizeBlockLevel(src.friendBlockLevel.Level),
        };
    }

    if (src.friendQuietHours && typeof src.friendQuietHours === 'object') {
        const old = cfg.friendQuietHours || {};
        cfg.friendQuietHours = {
            enabled: src.friendQuietHours.enabled !== undefined ? !!src.friendQuietHours.enabled : !!old.enabled,
            start: normalizeTimeString(src.friendQuietHours.start, old.start || '23:00'),
            end: normalizeTimeString(src.friendQuietHours.end, old.end || '07:00'),
        };
    }

    if (Array.isArray(src.friendBlacklist)) {
        cfg.friendBlacklist = src.friendBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0);
    }

    if (Array.isArray(src.friendCache)) {
        cfg.friendCache = normalizeFriendCache(src.friendCache);
    }

    return cfg;
}

function getAccountConfigSnapshot(accountId) {
    const id = resolveAccountId(accountId);
    if (!id) return cloneAccountConfig(accountFallbackConfig);
    return normalizeAccountConfig(globalConfig.accountConfigs[id], accountFallbackConfig);
}

function setAccountConfigSnapshot(accountId, nextConfig, persist = true) {
    const id = resolveAccountId(accountId);
    if (!id) {
        accountFallbackConfig = normalizeAccountConfig(nextConfig, accountFallbackConfig);
        globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);
        if (persist) saveGlobalConfig();
        return cloneAccountConfig(accountFallbackConfig);
    }
    globalConfig.accountConfigs[id] = normalizeAccountConfig(nextConfig, accountFallbackConfig);
    if (persist) saveGlobalConfig();
    return cloneAccountConfig(globalConfig.accountConfigs[id]);
}

function removeAccountConfig(accountId) {
    const id = resolveAccountId(accountId);
    if (!id) return;
    if (globalConfig.accountConfigs[id]) {
        delete globalConfig.accountConfigs[id];
        saveGlobalConfig();
    }
}

function ensureAccountConfig(accountId, options = {}) {
    const id = resolveAccountId(accountId);
    if (!id) return null;
    if (globalConfig.accountConfigs[id]) {
        return cloneAccountConfig(globalConfig.accountConfigs[id]);
    }
    globalConfig.accountConfigs[id] = normalizeAccountConfig(globalConfig.defaultAccountConfig, accountFallbackConfig);
    // 新账号默认不施肥（不受历史 defaultAccountConfig 旧值影响）
    if (globalConfig.accountConfigs[id] && globalConfig.accountConfigs[id].automation) {
        globalConfig.accountConfigs[id].automation.fertilizer = 'none';
    }
    if (options.persist !== false) saveGlobalConfig();
    return cloneAccountConfig(globalConfig.accountConfigs[id]);
}

// 加载全局配置
function loadGlobalConfig() {
    ensureDataDir();
    try {
        const data = readJsonFile(STORE_FILE, () => ({}));
        if (data && typeof data === 'object') {
            if (data.defaultAccountConfig && typeof data.defaultAccountConfig === 'object') {
                accountFallbackConfig = normalizeAccountConfig(data.defaultAccountConfig, DEFAULT_ACCOUNT_CONFIG);
            } else {
                accountFallbackConfig = cloneAccountConfig(DEFAULT_ACCOUNT_CONFIG);
            }
            globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);

            const cfgMap = (data.accountConfigs && typeof data.accountConfigs === 'object')
                ? data.accountConfigs
                : {};
            globalConfig.accountConfigs = {};
            for (const [id, cfg] of Object.entries(cfgMap)) {
                const sid = String(id || '').trim();
                if (!sid) continue;
                globalConfig.accountConfigs[sid] = normalizeAccountConfig(cfg, accountFallbackConfig);
            }
            // 统一规范化，确保内存中不残留旧字段（如 automation.friend）
            globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);
            for (const [id, cfg] of Object.entries(globalConfig.accountConfigs)) {
                globalConfig.accountConfigs[id] = normalizeAccountConfig(cfg, accountFallbackConfig);
            }
            globalConfig.ui = { ...globalConfig.ui, ...(data.ui || {}) };
            const theme = String(globalConfig.ui.theme || '').toLowerCase();
            globalConfig.ui.theme = theme === 'light' ? 'light' : 'dark';
            globalConfig.offlineReminder = normalizeOfflineReminder(data.offlineReminder);
            globalConfig.qrLogin = normalizeQrLoginConfig(data.qrLogin);
            if (data.runtimeClient && typeof data.runtimeClient === 'object') {
                // normalize 时使用当前 default 作为 fallback
                normalizeRuntimeClientConfig.current = DEFAULT_RUNTIME_CLIENT;
                const normalized = normalizeRuntimeClientConfig(data.runtimeClient);
                delete normalizeRuntimeClientConfig.current;
                globalConfig.runtimeClient = {
                    ...normalized,
                    device_info: { ...(normalized.device_info || {}) },
                };
            } else {
                globalConfig.runtimeClient = { ...DEFAULT_RUNTIME_CLIENT, device_info: { ...DEFAULT_RUNTIME_CLIENT.device_info } };
            }
            if (typeof data.adminPasswordHash === 'string') {
                globalConfig.adminPasswordHash = data.adminPasswordHash;
            }
            if (typeof data.disablePasswordAuth === 'boolean') {
                globalConfig.disablePasswordAuth = data.disablePasswordAuth;
            }
        }
    } catch (e) {
        console.error('加载配置失败:', e.message);
    }
}

function sanitizeGlobalConfigBeforeSave() {
    // default 配置统一白名单净化
    accountFallbackConfig = normalizeAccountConfig(globalConfig.defaultAccountConfig, DEFAULT_ACCOUNT_CONFIG);
    globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);

    // 每个账号配置也统一净化
    const map = (globalConfig.accountConfigs && typeof globalConfig.accountConfigs === 'object')
        ? globalConfig.accountConfigs
        : {};
    const nextMap = {};
    for (const [id, cfg] of Object.entries(map)) {
        const sid = String(id || '').trim();
        if (!sid) continue;
        nextMap[sid] = normalizeAccountConfig(cfg, accountFallbackConfig);
    }
    globalConfig.accountConfigs = nextMap;

    // runtimeClient 白名单净化
    globalConfig.runtimeClient = {
        ...getRuntimeClientConfig(),
        // 存盘时不强制写入 client_version（登录时派生即可），避免重复字段
        device_info: { ...getRuntimeClientConfig().device_info },
    };
}

// 保存全局配置
function saveGlobalConfig() {
    ensureDataDir();
    try {
        const oldJson = readTextFile(STORE_FILE, '');

        sanitizeGlobalConfigBeforeSave();
        const newJson = JSON.stringify(globalConfig, null, 2);
        
        if (oldJson !== newJson) {
            console.warn('[系统] 正在保存配置到:', STORE_FILE);
            writeJsonFileAtomic(STORE_FILE, globalConfig);
        }
    } catch (e) {
        console.error('保存配置失败:', e.message);
    }
}

function getAdminPasswordHash() {
    return String(globalConfig.adminPasswordHash || '');
}

function setAdminPasswordHash(hash) {
    globalConfig.adminPasswordHash = String(hash || '');
    saveGlobalConfig();
    return globalConfig.adminPasswordHash;
}

function getDisablePasswordAuth() {
    return Boolean(globalConfig.disablePasswordAuth);
}

function setDisablePasswordAuth(disabled) {
    globalConfig.disablePasswordAuth = Boolean(disabled);
    saveGlobalConfig();
    return globalConfig.disablePasswordAuth;
}

// 初始化加载
loadGlobalConfig();

function getAutomation(accountId) {
    const automation = { ...getAccountConfigSnapshot(accountId).automation };
    automation.fertilizer_land_types = normalizeFertilizerLandTypes(automation.fertilizer_land_types);
    automation.friend_steal_blacklist = normalizeStealPlantBlacklist(automation.friend_steal_blacklist);
    return automation;
}

function getConfigSnapshot(accountId) {
    const cfg = getAccountConfigSnapshot(accountId);
    return {
        automation: { ...cfg.automation },
        plantingStrategy: cfg.plantingStrategy,
        preferredSeedId: cfg.preferredSeedId,
        intervals: { ...cfg.intervals },
        friendBlockLevel: { ...cfg.friendBlockLevel },
        friendQuietHours: { ...cfg.friendQuietHours },
        friendBlacklist: [...(cfg.friendBlacklist || [])],
        ui: { ...globalConfig.ui },
        qrLogin: normalizeQrLoginConfig(globalConfig.qrLogin),
        runtimeClient: getRuntimeClientConfig(),
    };
}

function applyConfigSnapshot(snapshot, options = {}) {
    const cfg = snapshot || {};
    const persist = options.persist !== false;
    const accountId = options.accountId;

    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);

    if (cfg.automation && typeof cfg.automation === 'object') {
        for (const [k, v] of Object.entries(cfg.automation)) {
            if (next.automation[k] === undefined) continue;
            if (k === 'fertilizer') {
                const allowed = ['both', 'normal', 'organic', 'none'];
                next.automation[k] = allowed.includes(v) ? v : next.automation[k];
            } else if (k === 'fertilizer_buy_type') {
                next.automation[k] = ['organic', 'normal', 'both'].includes(v) ? v : next.automation[k];
            } else if (k === 'fertilizer_buy_mode') {
                next.automation[k] = ['threshold', 'unlimited'].includes(v) ? v : next.automation[k];
            } else if (k === 'fertilizer_buy_max') {
                const n = Number(v);
                next.automation[k] = (Number.isFinite(n) && n >= 1 && n <= 10) ? Math.floor(n) : next.automation[k];
            } else if (k === 'fertilizer_buy_threshold') {
                const n = Number(v);
                next.automation[k] = (Number.isFinite(n) && n >= 0) ? n : next.automation[k];
            } else if (k === 'fertilizer_land_types') {
                next.automation[k] = normalizeFertilizerLandTypes(v, next.automation[k]);
            } else if (k === 'friend_steal_blacklist') {
                next.automation[k] = normalizeStealPlantBlacklist(v, next.automation[k]);
            } else {
                next.automation[k] = !!v;
            }
        }
        normalizeFertilizerBuyAutomation(next.automation);
    }

    if (cfg.plantingStrategy && ALLOWED_PLANTING_STRATEGIES.includes(cfg.plantingStrategy)) {
        next.plantingStrategy = cfg.plantingStrategy;
    }

    if (cfg.preferredSeedId !== undefined && cfg.preferredSeedId !== null) {
        next.preferredSeedId = Math.max(0, Number.parseInt(cfg.preferredSeedId, 10) || 0);
    }

    if (cfg.bagSeedPriority !== undefined) {
        next.bagSeedPriority = normalizeBagSeedPriority(cfg.bagSeedPriority);
    }

    if (cfg.intervals && typeof cfg.intervals === 'object') {
        for (const [type, sec] of Object.entries(cfg.intervals)) {
            if (next.intervals[type] === undefined) continue;
            next.intervals[type] = Math.max(1, Number.parseInt(sec, 10) || next.intervals[type] || 1);
        }
        next.intervals = normalizeIntervals(next.intervals);
    }

    if (cfg.friendBlockLevel && typeof cfg.friendBlockLevel === 'object') {
        const old = next.friendBlockLevel || {};
        next.friendBlockLevel = {
            enabled: cfg.friendBlockLevel.enabled !== undefined ? !!cfg.friendBlockLevel.enabled : !!old.enabled,
            Level: normalizeBlockLevel(cfg.friendBlockLevel.Level),
        };
    }

    if (cfg.friendQuietHours && typeof cfg.friendQuietHours === 'object') {
        const old = next.friendQuietHours || {};
        next.friendQuietHours = {
            enabled: cfg.friendQuietHours.enabled !== undefined ? !!cfg.friendQuietHours.enabled : !!old.enabled,
            start: normalizeTimeString(cfg.friendQuietHours.start, old.start || '23:00'),
            end: normalizeTimeString(cfg.friendQuietHours.end, old.end || '07:00'),
        };
    }

    if (Array.isArray(cfg.friendBlacklist)) {
        next.friendBlacklist = cfg.friendBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0);
    }

    if (Array.isArray(cfg.friendCache)) {
        next.friendCache = normalizeFriendCache(cfg.friendCache);
    }

    if (cfg.ui && typeof cfg.ui === 'object') {
        const theme = String(cfg.ui.theme || '').toLowerCase();
        if (theme === 'dark' || theme === 'light') {
            globalConfig.ui.theme = theme;
        }
    }

    setAccountConfigSnapshot(accountId, next, false);
    if (persist) saveGlobalConfig();
    return getConfigSnapshot(accountId);
}

function setAutomation(key, value, accountId) {
    return applyConfigSnapshot({ automation: { [key]: value } }, { accountId });
}

function isAutomationOn(key, accountId) {
    return !!getAccountConfigSnapshot(accountId).automation[key];
}

function getPreferredSeed(accountId) {
    return getAccountConfigSnapshot(accountId).preferredSeedId;
}

function getPlantingStrategy(accountId) {
    return getAccountConfigSnapshot(accountId).plantingStrategy;
}

function getBagSeedPriority(accountId) {
    return [...(getAccountConfigSnapshot(accountId).bagSeedPriority || [])];
}

function setPlantingStrategy(accountId, strategy) {
    if (!ALLOWED_PLANTING_STRATEGIES.includes(strategy)) return false;
    applyConfigSnapshot({ plantingStrategy: strategy }, { accountId });
    return true;
}

function getIntervals(accountId) {
    return { ...getAccountConfigSnapshot(accountId).intervals };
}

function normalizeIntervals(intervals) {
    const src = (intervals && typeof intervals === 'object') ? intervals : {};
    const toSec = (v, d) => {
        const n = Number.parseInt(v, 10);
        const base = Number.isFinite(n) ? n : d;
        return Math.max(1, Math.min(INTERVAL_MAX_SEC, base));
    };
    const farm = toSec(src.farm, 2);
    const friend = toSec(src.friend, 10);

    let farmMin = toSec(src.farmMin, farm);
    let farmMax = toSec(src.farmMax, farm);
    if (farmMin > farmMax) [farmMin, farmMax] = [farmMax, farmMin];

    let friendMin = toSec(src.friendMin, friend);
    let friendMax = toSec(src.friendMax, friend);
    if (friendMin > friendMax) [friendMin, friendMax] = [friendMax, friendMin];

    return {
        ...src,
        farm,
        friend,
        farmMin,
        farmMax,
        friendMin,
        friendMax,
    };
}

function normalizeBlockLevel(Level) {
    const num = Number(Level);
    if (isNaN(num) || num < 1) {
        return 1;
    }
    return Math.floor(num);
}

function getFriendBlockLevel(accountId) {
    return { ...getAccountConfigSnapshot(accountId).friendBlockLevel };
}

function normalizeTimeString(v, fallback) {
    const s = String(v || '').trim();
    const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) return fallback;
    const hh = Math.max(0, Math.min(23, Number.parseInt(m[1], 10)));
    const mm = Math.max(0, Math.min(59, Number.parseInt(m[2], 10)));
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function getFriendQuietHours(accountId) {
    return { ...getAccountConfigSnapshot(accountId).friendQuietHours };
}

function getFriendBlacklist(accountId) {
    return [...(getAccountConfigSnapshot(accountId).friendBlacklist || [])];
}

function setFriendBlacklist(accountId, list) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);
    next.friendBlacklist = Array.isArray(list) ? list.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
    setAccountConfigSnapshot(accountId, next);
    return [...next.friendBlacklist];
}

function getFriendCache(accountId) {
    return normalizeFriendCache(getAccountConfigSnapshot(accountId).friendCache);
}

function setFriendCache(accountId, list) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);
    next.friendCache = normalizeFriendCache(list);
    setAccountConfigSnapshot(accountId, next);
    return [...next.friendCache];
}

function updateFriendCache(accountId, newItems) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);
    next.friendCache = mergeFriendCache(next.friendCache, newItems);
    setAccountConfigSnapshot(accountId, next);
    return [...next.friendCache];
}

function getUI() {
    return { ...globalConfig.ui };
}

function setUITheme(theme) {
    const t = String(theme || '').toLowerCase();
    const next = (t === 'light') ? 'light' : 'dark';
    return applyConfigSnapshot({ ui: { theme: next } });
}

function getOfflineReminder() {
    return normalizeOfflineReminder(globalConfig.offlineReminder);
}

function setOfflineReminder(cfg) {
    const current = normalizeOfflineReminder(globalConfig.offlineReminder);
    globalConfig.offlineReminder = normalizeOfflineReminder({ ...current, ...(cfg || {}) });
    saveGlobalConfig();
    return getOfflineReminder();
}


function getQrLoginConfig() {
    return normalizeQrLoginConfig(globalConfig.qrLogin);
}

function setQrLoginConfig(cfg) {
    const current = normalizeQrLoginConfig(globalConfig.qrLogin);
    globalConfig.qrLogin = normalizeQrLoginConfig({ ...current, ...(cfg || {}) });
    saveGlobalConfig();
    return getQrLoginConfig();
}
// ============ 账号管理 ============
function loadAccounts() {
    ensureDataDir();
    const data = readJsonFile(ACCOUNTS_FILE, () => ({ accounts: [], nextId: 1 }));
    return normalizeAccountsData(data);
}

function saveAccounts(data) {
    ensureDataDir();
    writeJsonFileAtomic(ACCOUNTS_FILE, normalizeAccountsData(data));
}

function getAccounts() {
    return loadAccounts();
}

function normalizeAccountsData(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    const maxId = accounts.reduce((m, a) => Math.max(m, Number.parseInt(a && a.id, 10) || 0), 0);
    let nextId = Number.parseInt(data.nextId, 10);
    if (!Number.isFinite(nextId) || nextId <= 0) nextId = maxId + 1;
    if (accounts.length === 0) nextId = 1;
    if (nextId <= maxId) nextId = maxId + 1;
    return { accounts, nextId };
}

function addOrUpdateAccount(acc) {
    const data = normalizeAccountsData(loadAccounts());
    let touchedAccountId = '';
    if (acc.id) {
        const idx = data.accounts.findIndex(a => a.id === acc.id);
        if (idx >= 0) {
            data.accounts[idx] = { ...data.accounts[idx], ...acc, name: acc.name !== undefined ? acc.name : data.accounts[idx].name, updatedAt: Date.now() };
            touchedAccountId = String(data.accounts[idx].id || '');
        }
    } else {
        const id = data.nextId++;
        touchedAccountId = String(id);
        const defaultName = String(
            acc.name
            || acc.nick
            || (acc.gid ? `GID:${acc.gid}` : '')
            || '',
        ).trim() || `账号${id}`;
        data.accounts.push({
            id: touchedAccountId,
            name: defaultName,
            code: acc.code || '',
            platform: acc.platform || 'qq',
            gid: acc.gid ? String(acc.gid) : '',
            openId: acc.openId ? String(acc.openId) : '',
            uin: acc.uin ? String(acc.uin) : '',
            qq: acc.qq ? String(acc.qq) : (acc.uin ? String(acc.uin) : ''),
            avatar: acc.avatar || acc.avatarUrl || '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    }
    saveAccounts(data);
    if (touchedAccountId) {
        ensureAccountConfig(touchedAccountId);
    }
    return data;
}

function deleteAccount(id) {
    const data = normalizeAccountsData(loadAccounts());
    data.accounts = data.accounts.filter(a => a.id !== String(id));
    if (data.accounts.length === 0) {
        data.nextId = 1;
    }
    saveAccounts(data);
    removeAccountConfig(id);
    return data;
}

module.exports = {
    getConfigSnapshot,
    applyConfigSnapshot,
    getAutomation,
    setAutomation,
    isAutomationOn,
    getPreferredSeed,
    getPlantingStrategy,
    getBagSeedPriority,
    setPlantingStrategy,
    getIntervals,
    getFriendBlockLevel,
    getFriendQuietHours,
    getFriendBlacklist,
    setFriendBlacklist,
    getFriendCache,
    setFriendCache,
    updateFriendCache,
    getUI,
    setUITheme,
    getOfflineReminder,
    setOfflineReminder,
    getQrLoginConfig,
    setQrLoginConfig,
    getRuntimeClientConfig,
    setRuntimeClientConfig,
    getAccounts,
    addOrUpdateAccount,
    deleteAccount,
    getAdminPasswordHash,
    setAdminPasswordHash,
    getDisablePasswordAuth,
    setDisablePasswordAuth,
};
