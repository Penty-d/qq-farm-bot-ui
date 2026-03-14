const EventEmitter = require('node:events');
const { createModuleLogger } = require('../services/logger');

function pad2(n) {
    return String(n).padStart(2, '0');
}

function formatLocalDateTime24(date = new Date()) {
    const d = date instanceof Date ? date : new Date();
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mm = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function createRuntimeState(options) {
    const {
        store,
        operationKeys = [],
    } = options;

    const workers = {};
    const globalLogs = [];
    const accountLogs = [];
    const runtimeEvents = new EventEmitter();
    let configRevision = Date.now();
    const runtimeLogger = createModuleLogger('runtime');

    function nextConfigRevision() {
        configRevision += 1;
        return configRevision;
    }

    function buildConfigSnapshotForAccount(accountId) {
        return {
            automation: store.getAutomation(accountId),
            plantingStrategy: store.getPlantingStrategy(accountId),
            preferredSeedId: store.getPreferredSeed(accountId),
            intervals: store.getIntervals(accountId),
            friendBlockLevel: store.getFriendBlockLevel(accountId),
            friendQuietHours: store.getFriendQuietHours(accountId),
            friendBlacklist: store.getFriendBlacklist(accountId),
            friendCache: store.getFriendCache(accountId),
            runtimeClient: store.getRuntimeClientConfig ? store.getRuntimeClientConfig() : null,
            __revision: configRevision,
        };
    }

    function log(tag, msg, extra = {}) {
        const time = formatLocalDateTime24(new Date());
        const level = tag === '错误' ? 'error' : 'info';
        runtimeLogger[level](msg, { tag, ...extra });
        const moduleName = (tag === '系统' || tag === '错误') ? 'system' : '';
        const entry = {
            time,
            tag,
            msg,
            meta: moduleName ? { module: moduleName } : {},
            ts: Date.now(),
            ...extra,
        };
        entry._searchText = `${entry.msg || ''} ${entry.tag || ''} ${JSON.stringify(entry.meta || {})}`.toLowerCase();
        globalLogs.push(entry);
        if (globalLogs.length > 1000) globalLogs.shift();
        runtimeEvents.emit('log', entry);
    }

    function addAccountLog(action, msg, accountId = '', accountName = '', extra = {}) {
        const entry = {
            time: formatLocalDateTime24(new Date()),
            action,
            msg,
            accountId: accountId ? String(accountId) : '',
            accountName: accountName || '',
            ...extra,
        };
        accountLogs.push(entry);
        if (accountLogs.length > 300) accountLogs.shift();
        runtimeEvents.emit('account_log', entry);
    }

    function normalizeStatusForPanel(data, accountId, accountName) {
        const src = (data && typeof data === 'object') ? data : {};
        const ops = (src.operations && typeof src.operations === 'object') ? { ...src.operations } : {};
        for (const k of operationKeys) {
            if (ops[k] === undefined || ops[k] === null || Number.isNaN(Number(ops[k]))) {
                ops[k] = 0;
            } else {
                ops[k] = Number(ops[k]);
            }
        }
        return {
            ...src,
            accountId,
            accountName,
            operations: ops,
        };
    }

    function buildDefaultOperations() {
        const ops = {};
        for (const k of operationKeys) ops[k] = 0;
        return ops;
    }

    function buildDefaultStatus(accountId) {
        return {
            connection: { connected: false },
            status: { name: '', level: 0, gold: 0, exp: 0, platform: 'qq' },
            uptime: 0,
            operations: buildDefaultOperations(),
            sessionExpGained: 0,
            sessionGoldGained: 0,
            sessionCouponGained: 0,
            lastExpGain: 0,
            lastGoldGain: 0,
            limits: {},
            wsError: null,
            automation: store.getAutomation(accountId),
            preferredSeed: store.getPreferredSeed(accountId),
            expProgress: { current: 0, needed: 0, level: 0 },
            configRevision,
            accountId: String(accountId || ''),
        };
    }

    function filterLogs(list, filters = {}) {
        const f = filters || {};
        const keyword = String(f.keyword || '').trim().toLowerCase();
        const keywordTerms = keyword ? keyword.split(/\s+/).filter(Boolean) : [];
        const tag = String(f.tag || '').trim();
        const moduleName = String(f.module || '').trim();
        const eventName = String(f.event || '').trim();
        const isWarn = f.isWarn;
        const timeFromMs = f.timeFrom ? Date.parse(String(f.timeFrom)) : Number.NaN;
        const timeToMs = f.timeTo ? Date.parse(String(f.timeTo)) : Number.NaN;
        return (list || []).filter((l) => {
            const logMs = Number(l && l.ts) || Date.parse(String((l && l.time) || ''));
            if (Number.isFinite(timeFromMs) && Number.isFinite(logMs) && logMs < timeFromMs) return false;
            if (Number.isFinite(timeToMs) && Number.isFinite(logMs) && logMs > timeToMs) return false;
            if (tag && String(l.tag || '') !== tag) return false;
            if (moduleName) {
                const logModule = String((l.meta || {}).module || '');
                // 兼容历史主进程日志：仅有 tag=系统/错误，没有 meta.module
                if (moduleName === 'system') {
                    const isSystemTag = String(l.tag || '') === '系统' || String(l.tag || '') === '错误';
                    if (logModule !== 'system' && !isSystemTag) return false;
                } else if (logModule !== moduleName) {
                    return false;
                }
            }
            if (eventName && String((l.meta || {}).event || '') !== eventName) return false;
            if (isWarn !== undefined && isWarn !== null && String(isWarn) !== '') {
                const expected = String(isWarn) === '1' || String(isWarn).toLowerCase() === 'true';
                if (!!l.isWarn !== expected) return false;
            }
            if (keywordTerms.length > 0) {
                const text = String(l._searchText || `${l.msg || ''} ${l.tag || ''}`).toLowerCase();
                for (const term of keywordTerms) {
                    if (!text.includes(term)) return false;
                }
            }
            return true;
        });
    }

    return {
        workers,
        globalLogs,
        accountLogs,
        runtimeEvents,
        nextConfigRevision,
        buildConfigSnapshotForAccount,
        log,
        addAccountLog,
        normalizeStatusForPanel,
        buildDefaultStatus,
        filterLogs,
    };
}

module.exports = {
    createRuntimeState,
};
