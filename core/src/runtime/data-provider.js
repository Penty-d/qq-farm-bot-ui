const { findAccountByRef, normalizeAccountRef, resolveAccountId: resolveAccountIdByList } = require('../services/account-resolver');
const { getSchedulerRegistrySnapshot } = require('../services/scheduler');

function createDataProvider(options) {
    const {
        workers,
        globalLogs,
        accountLogs,
        store,
        getAccounts,
        callWorkerApi,
        buildDefaultStatus,
        normalizeStatusForPanel,
        filterLogs,
        addAccountLog,
        nextConfigRevision,
        broadcastConfigToWorkers,
        startWorker,
        stopWorker,
        restartWorker,
    } = options;

    function getStoredAccountsList() {
        const data = getAccounts();
        return Array.isArray(data.accounts) ? data.accounts : [];
    }

    function resolveAccountRefId(accountRef) {
        const raw = normalizeAccountRef(accountRef);
        if (!raw) return '';
        const resolved = resolveAccountIdByList(getStoredAccountsList(), raw);
        return resolved || raw;
    }

    function findAccountByAnyRef(accountRef) {
        return findAccountByRef(getStoredAccountsList(), accountRef);
    }

    return {
        resolveAccountId: (accountRef) => resolveAccountRefId(accountRef),

        // 获取指定账号的状态 (如果 accountId 为空，返回概览?)
        getStatus: (accountRef) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) return buildDefaultStatus('');
            const w = workers[accountId];
            if (!w || !w.status) return buildDefaultStatus(accountId);
            return {
                ...buildDefaultStatus(accountId),
                ...normalizeStatusForPanel(w.status, accountId, w.name),
                wsError: w.wsError || null,
            };
        },

        getLogs: (accountRef, optionsOrLimit) => {
            const opts = (typeof optionsOrLimit === 'object' && optionsOrLimit) ? optionsOrLimit : { limit: optionsOrLimit };
            const max = Math.max(1, Number(opts.limit) || 100);
            const rawRef = normalizeAccountRef(accountRef);
            const accountId = resolveAccountRefId(accountRef);
            if (!rawRef) {
                return filterLogs(globalLogs, opts).slice(-max);
            }
            if (!accountId) return [];
            const accId = String(accountId || '');
            return filterLogs(globalLogs.filter(l => String(l.accountId || '') === accId), opts).slice(-max);
        },

        getAccountLogs: (limit) => accountLogs.slice(-limit).reverse(),
        addAccountLog: (action, msg, accountId, accountName, extra) => addAccountLog(action, msg, accountId, accountName, extra),

        // 透传方法
        getLands: (accountRef) => callWorkerApi(resolveAccountRefId(accountRef), 'getLands'),
        getFriends: (accountRef) => callWorkerApi(resolveAccountRefId(accountRef), 'getFriends'),
        getFriendLands: (accountRef, gid) => callWorkerApi(resolveAccountRefId(accountRef), 'getFriendLands', gid),
        doFriendOp: (accountRef, gid, opType) => callWorkerApi(resolveAccountRefId(accountRef), 'doFriendOp', gid, opType),
        getBag: (accountRef) => callWorkerApi(resolveAccountRefId(accountRef), 'getBag'),
        getDailyGifts: (accountRef) => callWorkerApi(resolveAccountRefId(accountRef), 'getDailyGiftOverview'),
        getSeeds: (accountRef) => callWorkerApi(resolveAccountRefId(accountRef), 'getSeeds'),

        setAutomation: async (accountRef, key, value) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) {
                throw new Error('Missing x-account-id');
            }
            store.setAutomation(key, value, accountId);
            const rev = nextConfigRevision();
            broadcastConfigToWorkers(accountId);
            return { automation: store.getAutomation(accountId), configRevision: rev };
        },

        doFarmOp: (accountRef, opType) => callWorkerApi(resolveAccountRefId(accountRef), 'doFarmOp', opType),
        doAnalytics: (accountRef, sortBy) => callWorkerApi(resolveAccountRefId(accountRef), 'getAnalytics', sortBy),
        saveSettings: async (accountRef, payload) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) {
                throw new Error('Missing x-account-id');
            }
            const body = (payload && typeof payload === 'object') ? payload : {};
            const plantingStrategy = (body.plantingStrategy !== undefined) ? body.plantingStrategy : body.strategy;
            const preferredSeedId = (body.preferredSeedId !== undefined) ? body.preferredSeedId : body.seedId;
            const snapshot = {
                plantingStrategy,
                preferredSeedId,
                intervals: body.intervals,
                friendQuietHours: body.friendQuietHours,
            };
            store.applyConfigSnapshot(snapshot, { accountId });
            const rev = nextConfigRevision();
            broadcastConfigToWorkers(accountId);
            return {
                strategy: store.getPlantingStrategy(accountId),
                preferredSeed: store.getPreferredSeed(accountId),
                intervals: store.getIntervals(accountId),
                friendQuietHours: store.getFriendQuietHours(accountId),
                configRevision: rev,
            };
        },

        setUITheme: async (theme) => {
            const snapshot = store.setUITheme(theme);
            return { ui: snapshot.ui || store.getUI() };
        },

        broadcastConfig: (accountId) => {
            broadcastConfigToWorkers(accountId);
        },

        setRuntimeAccountName: (accountRef, accountName) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) return;
            const worker = workers[accountId];
            if (worker) {
                worker.name = String(accountName || worker.name || accountId);
            }
        },

        // 账号管理直接操作 store
        getAccounts: () => {
            const data = getAccounts();
            data.accounts.forEach((a) => {
                const worker = workers[a.id];
                a.running = !!worker;
                if (worker && worker.status && worker.status.status && worker.status.status.name) {
                    a.nick = worker.status.status.name;
                }
            });
            return data;
        },

        startAccount: (accountRef) => {
            const accountId = resolveAccountRefId(accountRef);
            const acc = findAccountByAnyRef(accountId || accountRef);
            if (!acc) return false;
            startWorker(acc);
            return true;
        },

        stopAccount: (accountRef) => {
            const accountId = resolveAccountRefId(accountRef);
            const acc = findAccountByAnyRef(accountId || accountRef);
            if (!acc) return false;
            if (accountId) stopWorker(accountId);
            return true;
        },

        restartAccount: (accountRef) => {
            const accountId = resolveAccountRefId(accountRef);
            const acc = findAccountByAnyRef(accountId || accountRef);
            if (!acc) return false;
            restartWorker(acc);
            return true;
        },

        isAccountRunning: (accountRef) => {
            const accountId = resolveAccountRefId(accountRef);
            return !!(accountId && workers[accountId]);
        },

        getSchedulerStatus: async (accountRef) => {
            const accountId = resolveAccountRefId(accountRef);
            const runtime = getSchedulerRegistrySnapshot();
            let worker = null;
            let workerError = '';

            if (!accountId) {
                return { accountId: '', runtime, worker, workerError };
            }

            if (!workers[accountId]) {
                return { accountId, runtime, worker, workerError: '账号未运行' };
            }

            try {
                worker = await callWorkerApi(accountId, 'getSchedulers');
            } catch (e) {
                workerError = (e && e.message) ? e.message : String(e || 'unknown');
            }
            return { accountId, runtime, worker, workerError };
        },
    };
}

module.exports = {
    createDataProvider,
};
