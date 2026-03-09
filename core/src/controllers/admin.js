const crypto = require('node:crypto');
/**
 * 管理面板 HTTP 服务
 * 改写为接收 DataProvider 模式
 */

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const express = require('express');
const { Server: SocketIOServer } = require('socket.io');
const { version } = require('../../package.json');
const { CONFIG } = require('../config/config');
const { getLevelExpProgress } = require('../config/gameConfig');
const { getResourcePath } = require('../config/runtime-paths');
const store = require('../models/store');
const { addOrUpdateAccount, deleteAccount } = store;
const { findAccountByRef, normalizeAccountRef, resolveAccountId } = require('../services/account-resolver');
const { createModuleLogger } = require('../services/logger');
const { MiniProgramLoginSession } = require('../services/qrlogin');
const { sendPushooMessage } = require('../services/push');
const { getSchedulerRegistrySnapshot } = require('../services/scheduler');
const {
    rateLimitMiddleware,
    recordLoginAttempts,
    clearLoginAttempts,
} = require('../services/security');
const {
    isAdmin,
    ensureDefaultAdmin,
    registerUser,
    loginUser,
    changePassword,
    createSessionManager,
    ensureAccountAccess,
    filterAccountsForUser,
    markAccountsForCurrentUser,
    buildAccountStatusStats,
    createInviteCode,
    listInviteCodes,
    deleteInviteCode,
    listAllUsers,
} = require('../services/user-auth');
const adminLogger = createModuleLogger('admin');

let app = null;
let server = null;
let provider = null; // DataProvider
let io = null;

function emitRealtimeStatus(accountId, status) {
    if (!io) return;
    const id = String(accountId || '').trim();
    if (!id) return;
    io.to(`account:${id}`).emit('status:update', { accountId: id, status });
    io.to('account:all').emit('status:update', { accountId: id, status });
}

function emitRealtimeLog(entry) {
    if (!io) return;
    const payload = (entry && typeof entry === 'object') ? entry : {};
    const id = String(payload.accountId || '').trim();
    if (id) io.to(`account:${id}`).emit('log:new', payload);
    io.to('account:all').emit('log:new', payload);
}

function emitRealtimeAccountLog(entry) {
    if (!io) return;
    const payload = (entry && typeof entry === 'object') ? entry : {};
    const id = String(payload.accountId || '').trim();
    if (id) io.to(`account:${id}`).emit('account-log:new', payload);
    io.to('account:all').emit('account-log:new', payload);
}

function startAdminServer(dataProvider) {
    if (app) return;
    provider = dataProvider;

    app = express();
    app.use(express.json());

    ensureDefaultAdmin().catch((error) => {
        adminLogger.error('init default admin failed', { error: error.message });
    });

    const sessions = createSessionManager();

    const authRequired = (req, res, next) => {
        const token = String(req.headers['x-admin-token'] || '').trim();
        const currentUser = sessions.getUser(token);
        if (!token || !currentUser) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }
        req.adminToken = token;
        req.currentUser = currentUser;
        next();
    };

    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, x-account-id, x-admin-token');
        if (req.method === 'OPTIONS') return res.sendStatus(200);
        next();
    });

    // 速率限制中间件
    app.use('/api', rateLimitMiddleware({
        windowMs: 60000,  // 1分钟
        maxRequests: 100, // 最多100次
        keyGenerator: (req) => req.ip,
    }));

    const webDist = path.join(__dirname, '../../../web/dist');
    if (fs.existsSync(webDist)) {
        app.use(express.static(webDist));
    } else {
        adminLogger.warn('web build not found', { webDist });
        app.get('/', (req, res) => res.send('web build not found. Please build the web project.'));
    }
    app.use('/game-config', express.static(getResourcePath('gameConfig')));

    // 登录与鉴权
    app.post('/api/register', async (req, res) => {
        const body = req.body || {};
        try {
            const user = await registerUser({
                username: body.username,
                password: body.password,
                inviteCode: body.inviteCode,
            });
            res.json({ ok: true, data: { user } });
        } catch (error) {
            return res.status(400).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/login', async (req, res) => {
        const { username, password } = req.body || {};

        try {
            recordLoginAttempts(`${req.ip}:${String(username || '').trim().toLowerCase()}`);
        } catch (error) {
            return res.status(429).json({ ok: false, error: error.message });
        }

        try {
            const user = await loginUser({ username, password });
            clearLoginAttempts(`${req.ip}:${String(username || '').trim().toLowerCase()}`);
            const token = sessions.issue(user);
            return res.json({ ok: true, data: { token, user } });
        } catch (error) {
            return res.status(401).json({ ok: false, error: error.message });
        }
    });

    app.use('/api', (req, res, next) => {
        if (
            req.path === '/login'
            || req.path === '/register'
            || req.path === '/qr/create'
            || req.path === '/qr/check'
            || req.path === '/auth/validate'
        ) return next();
        return authRequired(req, res, next);
    });

    app.get('/api/me', (req, res) => {
        return res.json({ ok: true, data: { user: req.currentUser } });
    });

    app.get('/api/admin/users', (req, res) => {
        try {
            const users = listAllUsers(req.currentUser);
            return res.json({ ok: true, data: { users } });
        } catch (error) {
            return res.status(403).json({ ok: false, error: error.message });
        }
    });

    app.get('/api/admin/invites', (req, res) => {
        try {
            const invites = listInviteCodes(req.currentUser);
            return res.json({ ok: true, data: { invites } });
        } catch (error) {
            return res.status(403).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/admin/invites', (req, res) => {
        try {
            const maxUses = Number.parseInt((req.body || {}).maxUses, 10) || 1;
            const invite = createInviteCode(req.currentUser, maxUses);
            return res.json({ ok: true, data: invite });
        } catch (error) {
            const statusCode = error.message === 'Forbidden' ? 403 : 400;
            return res.status(statusCode).json({ ok: false, error: error.message });
        }
    });

    app.delete('/api/admin/invites/:code', (req, res) => {
        try {
            const deleted = deleteInviteCode(req.currentUser, req.params.code);
            return res.json({ ok: true, data: { deleted } });
        } catch (error) {
            const statusCode = error.message === 'Forbidden' ? 403 : 400;
            return res.status(statusCode).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/admin/change-password', async (req, res) => {
        const body = req.body || {};
        try {
            await changePassword(req.currentUser, body.oldPassword, body.newPassword);
            return res.json({ ok: true });
        } catch (error) {
            return res.status(400).json({ ok: false, error: error.message });
        }
    });

    app.get('/api/ping', (req, res) => {
        res.json({ ok: true, data: { ok: true, uptime: process.uptime(), version } });
    });

    app.get('/api/auth/validate', (req, res) => {
        const token = String(req.headers['x-admin-token'] || '').trim();
        const user = sessions.getUser(token);
        const valid = !!token && !!user;
        if (!valid) {
            return res.status(401).json({ ok: false, data: { valid: false }, error: 'Unauthorized' });
        }
        res.json({ ok: true, data: { valid: true, user } });
    });

    // API: 调度任务快照（用于调度收敛排查）
    app.get('/api/scheduler', async (req, res) => {
        try {
            const id = getAccId(req);
            if (provider && typeof provider.getSchedulerStatus === 'function') {
                const data = await provider.getSchedulerStatus(id);
                return res.json({ ok: true, data });
            }
            return res.json({ ok: true, data: { runtime: getSchedulerRegistrySnapshot(), worker: null, workerError: 'DataProvider does not support scheduler status' } });
        } catch (e) {
            return handleApiError(res, e);
        }
    });

    app.post('/api/logout', (req, res) => {
        const token = req.adminToken;
        if (token) {
            sessions.revoke(token);
            if (io) {
                for (const socket of io.sockets.sockets.values()) {
                    if (String(socket.data.adminToken || '') === String(token)) {
                        socket.disconnect(true);
                    }
                }
            }
        }
        res.json({ ok: true });
    });

    const getAccountList = () => {
        try {
            if (provider && typeof provider.getAccounts === 'function') {
                const data = provider.getAccounts();
                if (data && Array.isArray(data.accounts)) return data.accounts;
            }
        } catch {
            // ignore provider failures
        }
        const data = store.getAccounts ? store.getAccounts() : { accounts: [] };
        return Array.isArray(data.accounts) ? data.accounts : [];
    };

    const isSoftRuntimeError = (err) => {
        const msg = String((err && err.message) || '');
        return msg === '账号未运行' || msg === 'API Timeout';
    };

    function handleApiError(res, err) {
        if (isSoftRuntimeError(err)) {
            return res.json({ ok: false, error: err.message });
        }
        return res.status(500).json({ ok: false, error: err.message });
    }

    const resolveAccId = (rawRef) => {
        const input = normalizeAccountRef(rawRef);
        if (!input) return '';

        if (provider && typeof provider.resolveAccountId === 'function') {
            const resolvedByProvider = normalizeAccountRef(provider.resolveAccountId(input));
            if (resolvedByProvider) return resolvedByProvider;
        }

        const resolved = resolveAccountId(getAccountList(), input);
        return resolved || input;
    };

    function getOwnedAccountList(currentUser) {
        const rawAccounts = provider && typeof provider.getAccounts === 'function'
            ? provider.getAccounts()
            : { accounts: getAccountList() };
        const accounts = Array.isArray(rawAccounts.accounts) ? rawAccounts.accounts : [];
        const enhanced = markAccountsForCurrentUser(accounts, currentUser, (accountId) => {
            try {
                return provider && typeof provider.getStatus === 'function'
                    ? provider.getStatus(accountId)
                    : null;
            } catch {
                return null;
            }
        });
        const filtered = filterAccountsForUser(enhanced, currentUser);
        return {
            accounts: filtered,
            nextId: rawAccounts.nextId || 1,
            stats: buildAccountStatusStats(filtered),
        };
    }

    function getAccessibleAccount(req, rawRef) {
        const resolvedId = resolveAccId(rawRef);
        if (!resolvedId) {
            const error = new Error('Missing x-account-id');
            error.statusCode = 400;
            throw error;
        }
        const account = findAccountByRef(getAccountList(), resolvedId);
        ensureAccountAccess(req.currentUser, account);
        return account;
    }

    // Helper to get account ID from header
    function getAccId(req) {
        const account = getAccessibleAccount(req, req.headers['x-account-id']);
        return String(account.id || '');
    }

    // API: 完整状态
    app.get('/api/status', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.json({ ok: false, error: 'Missing x-account-id' });

        try {
            const data = provider.getStatus(id);
            if (data && data.status) {
                const { level, exp } = data.status;
                const progress = getLevelExpProgress(level, exp);
                data.levelProgress = progress;
            }
            res.json({ ok: true, data });
        } catch (e) {
            res.json({ ok: false, error: e.message });
        }
    });

    app.post('/api/automation', async (req, res) => {
        const id = getAccId(req);
        if (!id) {
            return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        }
        try {
            let lastData = null;
            for (const [k, v] of Object.entries(req.body)) {
                lastData = await provider.setAutomation(id, k, v);
            }
            res.json({ ok: true, data: lastData || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 农田详情
    app.get('/api/lands', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });
        try {
            const data = await provider.getLands(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 好友列表
    app.get('/api/friends', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });
        try {
            const data = await provider.getFriends(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 好友农田详情
    app.get('/api/interact-records', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        try {
            const data = await provider.getInteractRecords(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    app.get('/api/friend/:gid/lands', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });
        try {
            const data = await provider.getFriendLands(id, req.params.gid);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 对指定好友执行单次操作（偷菜/浇水/除草/捣乱）
    app.post('/api/friend/:gid/op', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        try {
            const opType = String((req.body || {}).opType || '');
            const data = await provider.doFriendOp(id, req.params.gid, opType);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 好友黑名单
    app.get('/api/friend-blacklist', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        try {
            if (provider && typeof provider.getFriendBlacklist === 'function') {
                const list = await provider.getFriendBlacklist(id);
                return res.json({ ok: true, data: Array.isArray(list) ? list : [] });
            }
            const list = store.getFriendBlacklist ? store.getFriendBlacklist(id) : [];
            return res.json({ ok: true, data: Array.isArray(list) ? list : [] });
        } catch (e) {
            return handleApiError(res, e);
        }
    });

    app.post('/api/friend-blacklist/toggle', (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        const gid = Number((req.body || {}).gid);
        if (!gid) return res.status(400).json({ ok: false, error: 'Missing gid' });
        const current = store.getFriendBlacklist ? store.getFriendBlacklist(id) : [];
        let next;
        if (current.includes(gid)) {
            next = current.filter(g => g !== gid);
        } else {
            next = [...current, gid];
        }
        const saved = store.setFriendBlacklist ? store.setFriendBlacklist(id, next) : next;
        // 同步配置到 worker 进程
        if (provider && typeof provider.broadcastConfig === 'function') {
            provider.broadcastConfig(id);
        }
        res.json({ ok: true, data: saved });
    });

    // API: 种子列表
    app.get('/api/seeds', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });
        try {
            const data = await provider.getSeeds(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 背包物品
    app.get('/api/bag', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });
        try {
            const data = await provider.getBag(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 每日礼包状态总览
    app.get('/api/daily-gifts', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });
        try {
            const data = await provider.getDailyGifts(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 启动账号
    app.post('/api/accounts/:id/start', (req, res) => {
        try {
            const target = getAccessibleAccount(req, req.params.id);
            const ok = provider.startAccount(String(target.id || ''));
            if (!ok) {
                return res.status(404).json({ ok: false, error: 'Account not found' });
            }
            res.json({ ok: true });
        } catch (e) {
            const statusCode = Number(e.statusCode) || 500;
            res.status(statusCode).json({ ok: false, error: e.message });
        }
    });

    // API: 停止账号
    app.post('/api/accounts/:id/stop', (req, res) => {
        try {
            const target = getAccessibleAccount(req, req.params.id);
            const ok = provider.stopAccount(String(target.id || ''));
            if (!ok) {
                return res.status(404).json({ ok: false, error: 'Account not found' });
            }
            res.json({ ok: true });
        } catch (e) {
            const statusCode = Number(e.statusCode) || 500;
            res.status(statusCode).json({ ok: false, error: e.message });
        }
    });

    // API: 农场一键操作
    app.post('/api/farm/operate', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });
        try {
            const { opType } = req.body; // 'harvest', 'clear', 'plant', 'all'
            await provider.doFarmOp(id, opType);
            res.json({ ok: true });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 数据分析
    app.get('/api/analytics', async (req, res) => {
        try {
            const sortBy = req.query.sort || 'exp';
            const { getPlantRankings } = require('../services/analytics');
            const data = getPlantRankings(sortBy);
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 设置页统一保存（单次写入+单次广播）
    app.post('/api/settings/save', async (req, res) => {
        const id = getAccId(req);
        if (!id) {
            return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        }
        try {
            const data = await provider.saveSettings(id, req.body || {});
            res.json({ ok: true, data: data || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 设置面板主题
    app.post('/api/settings/theme', async (req, res) => {
        try {
            const theme = String((req.body || {}).theme || '');
            const data = await provider.setUITheme(theme);
            res.json({ ok: true, data: data || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 保存下线提醒配置
    app.post('/api/settings/offline-reminder', async (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const data = store.setOfflineReminder ? store.setOfflineReminder(body) : {};
            res.json({ ok: true, data: data || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 保存二维码登录接口配置
    app.post('/api/settings/qr-login', async (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const data = store.setQrLoginConfig ? store.setQrLoginConfig(body) : { apiDomain: 'q.qq.com' };
            res.json({ ok: true, data: data || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });
    // API: 测试下线提醒推送（不落盘）
    app.post('/api/settings/offline-reminder/test', async (req, res) => {
        try {
            const saved = store.getOfflineReminder ? store.getOfflineReminder() : {};
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const cfg = { ...(saved || {}), ...body };

            const channel = String(cfg.channel || '').trim().toLowerCase();
            const endpoint = String(cfg.endpoint || '').trim();
            const token = String(cfg.token || '').trim();
            const titleBase = String(cfg.title || '账号下线提醒').trim();
            const msgBase = String(cfg.msg || '账号下线').trim();
            const custom_headers = String(cfg.custom_headers || '').trim();
            const custom_body = String(cfg.custom_body || '').trim();

            if (!channel) {
                return res.status(400).json({ ok: false, error: '推送渠道不能为空' });
            }
            if ((channel === 'webhook' || channel === 'custom_request') && !endpoint) {
                return res.status(400).json({ ok: false, error: '接口地址不能为空' });
            }

            const now = new Date();
            const ts = now.toISOString().replace('T', ' ').slice(0, 19);
            const ret = await sendPushooMessage({
                channel,
                endpoint,
                token,
                title: `${titleBase}（测试）`,
                content: `${msgBase}\n\n这是一条下线提醒测试消息。\n时间: ${ts}`,
                custom_headers,
                custom_body,
            });

            if (!ret || !ret.ok) {
                return res.status(400).json({ ok: false, error: (ret && ret.msg) || '推送失败', data: ret || {} });
            }
            return res.json({ ok: true, data: ret });
        } catch (e) {
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 获取配置
    app.get('/api/settings', async (req, res) => {
        try {
            const id = getAccId(req);
            // 直接从主进程的 store 读取，确保即使账号未运行也能获取配置
            const intervals = store.getIntervals(id);
            const strategy = store.getPlantingStrategy(id);
            const preferredSeed = store.getPreferredSeed(id);
            const friendQuietHours = store.getFriendQuietHours(id);
            const automation = store.getAutomation(id);
            const ui = store.getUI();
            const offlineReminder = store.getOfflineReminder
                ? store.getOfflineReminder()
                : { channel: 'webhook', reloginUrlMode: 'none', endpoint: '', token: '', title: '账号下线提醒', msg: '账号下线', offlineDeleteSec: 1, offlineDeleteEnabled: false, custom_headers: '', custom_body: '' };
            const qrLogin = store.getQrLoginConfig
                ? store.getQrLoginConfig()
                : { apiDomain: 'q.qq.com' };
            res.json({ ok: true, data: { intervals, strategy, preferredSeed, friendQuietHours, automation, ui, offlineReminder, qrLogin } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 账号管理
    app.get('/api/accounts', (req, res) => {
        try {
            const data = getOwnedAccountList(req.currentUser);
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 更新账号备注（兼容旧接口）
    app.post('/api/account/remark', (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const rawRef = body.id || body.accountId || body.uin || req.headers['x-account-id'];
            const target = getAccessibleAccount(req, rawRef);

            const remark = String(body.remark !== undefined ? body.remark : body.name || '').trim();
            if (!remark) {
                return res.status(400).json({ ok: false, error: 'Missing remark' });
            }

            const accountId = String(target.id);
            const data = addOrUpdateAccount({
                id: accountId,
                name: remark,
                ownerUserId: target.ownerUserId,
                ownerUsername: target.ownerUsername,
            });
            if (provider && typeof provider.setRuntimeAccountName === 'function') {
                provider.setRuntimeAccountName(accountId, remark);
            }
            if (provider && provider.addAccountLog) {
                provider.addAccountLog('update', `更新账号备注: ${remark}`, accountId, remark);
            }
            res.json({ ok: true, data });
        } catch (e) {
            const statusCode = Number(e.statusCode) || 500;
            res.status(statusCode).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/accounts', (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const isUpdate = !!body.id;
            const resolvedUpdateId = isUpdate ? resolveAccId(body.id) : '';
            const payload = isUpdate ? { ...body, id: resolvedUpdateId || String(body.id) } : body;

            let wasRunning = false;
            if (isUpdate) {
                const targetAccount = getAccessibleAccount(req, payload.id);
                payload.id = String(targetAccount.id || '');
                payload.ownerUserId = targetAccount.ownerUserId;
                payload.ownerUsername = targetAccount.ownerUsername;
                if (provider.isAccountRunning) {
                    wasRunning = provider.isAccountRunning(payload.id);
                }
            } else {
                payload.ownerUserId = Number(req.currentUser.id) || 0;
                payload.ownerUsername = String(req.currentUser.username || '');
            }

            let onlyRemarkChanged = false;
            if (isUpdate) {
                const oldAccounts = getOwnedAccountList(req.currentUser);
                const oldAccount = oldAccounts.accounts.find(a => a.id === payload.id);
                if (oldAccount) {
                    const payloadKeys = Object.keys(payload);
                    const onlyIdAndName = payloadKeys.length === 4
                        && payloadKeys.includes('id')
                        && payloadKeys.includes('name')
                        && payloadKeys.includes('ownerUserId')
                        && payloadKeys.includes('ownerUsername');
                    if (onlyIdAndName) {
                        onlyRemarkChanged = true;
                    }
                }
            }

            const data = addOrUpdateAccount(payload);
            if (provider.addAccountLog) {
                const accountId = isUpdate ? String(payload.id) : String((data.accounts[data.accounts.length - 1] || {}).id || '');
                const accountName = payload.name || '';
                provider.addAccountLog(
                    isUpdate ? 'update' : 'add',
                    isUpdate ? `更新账号: ${accountName || accountId}` : `添加账号: ${accountName || accountId}`,
                    accountId,
                    accountName
                );
            }
            if (!isUpdate) {
                const newAcc = data.accounts[data.accounts.length - 1];
                if (newAcc) provider.startAccount(newAcc.id);
            } else if (wasRunning && !onlyRemarkChanged) {
                provider.restartAccount(payload.id);
            }
            res.json({ ok: true, data: getOwnedAccountList(req.currentUser) });
        } catch (e) {
            const statusCode = Number(e.statusCode) || 500;
            res.status(statusCode).json({ ok: false, error: e.message });
        }
    });

    app.delete('/api/accounts/:id', (req, res) => {
        try {
            const target = getAccessibleAccount(req, req.params.id);
            const resolvedId = String(target.id || '');
            provider.stopAccount(resolvedId);
            deleteAccount(resolvedId);
            if (provider.addAccountLog) {
                provider.addAccountLog('delete', `删除账号: ${(target && target.name) || req.params.id}`, resolvedId, target ? target.name : '');
            }
            res.json({ ok: true, data: getOwnedAccountList(req.currentUser) });
        } catch (e) {
            const statusCode = Number(e.statusCode) || 500;
            res.status(statusCode).json({ ok: false, error: e.message });
        }
    });

    // API: 账号日志
    app.get('/api/account-logs', (req, res) => {
        try {
            const limit = Number.parseInt(req.query.limit) || 100;
            const list = provider.getAccountLogs ? provider.getAccountLogs(limit) : [];
            if (!Array.isArray(list)) {
                return res.json([]);
            }
            if (isAdmin(req.currentUser)) {
                return res.json(list);
            }
            const visibleIds = new Set(getOwnedAccountList(req.currentUser).accounts.map(item => String(item.id || '')));
            return res.json(list.filter(item => visibleIds.has(String((item && item.accountId) || ''))));
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 日志
    app.get('/api/logs', (req, res) => {
        const queryAccountIdRaw = (req.query.accountId || '').toString().trim();
        let id = '';
        if (queryAccountIdRaw) {
            if (queryAccountIdRaw === 'all') {
                if (!isAdmin(req.currentUser)) {
                    return res.status(403).json({ ok: false, error: 'Forbidden' });
                }
                id = '';
            } else {
                const target = getAccessibleAccount(req, queryAccountIdRaw);
                id = String(target.id || '');
            }
        } else {
            id = getAccId(req);
        }

        const options = {
            limit: Number.parseInt(req.query.limit) || 100,
            tag: req.query.tag || '',
            module: req.query.module || '',
            event: req.query.event || '',
            keyword: req.query.keyword || '',
            isWarn: req.query.isWarn,
            timeFrom: req.query.timeFrom || '',
            timeTo: req.query.timeTo || '',
        };
        const list = provider.getLogs(id, options);
        res.json({ ok: true, data: list });
    });

    // API: 清空当前账号运行日志
    app.delete('/api/logs', (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        try {
            const data = provider.clearLogs(id);

            if (io && provider && typeof provider.getLogs === 'function') {
                const accountLogs = provider.getLogs(id, { limit: 100 });
                io.to(`account:${id}`).emit('logs:snapshot', {
                    accountId: id,
                    logs: Array.isArray(accountLogs) ? accountLogs : [],
                });

                const allLogs = provider.getLogs('', { limit: 100 });
                io.to('account:all').emit('logs:snapshot', {
                    accountId: 'all',
                    logs: Array.isArray(allLogs) ? allLogs : [],
                });
            }

            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // ============ QR Code Login APIs (无需账号选择) ============
    // 这些接口不需要 authRequired 也能调用（用于登录流程）
    app.post('/api/qr/create', async (req, res) => {
        try {
            const qrLogin = store.getQrLoginConfig ? store.getQrLoginConfig() : { apiDomain: 'q.qq.com' };
            const result = await MiniProgramLoginSession.requestLoginCode({ apiDomain: qrLogin.apiDomain });
            res.json({ ok: true, data: result });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/qr/check', async (req, res) => {
        const { code } = req.body || {};
        if (!code) {
            return res.status(400).json({ ok: false, error: 'Missing code' });
        }

        try {
            const qrLogin = store.getQrLoginConfig ? store.getQrLoginConfig() : { apiDomain: 'q.qq.com' };
            const result = await MiniProgramLoginSession.queryStatus(code, { apiDomain: qrLogin.apiDomain });

            if (result.status === 'OK') {
                const ticket = result.ticket;
                const uin = result.uin || '';
                const nickname = result.nickname || ''; // 获取昵称
                const appid = '1112386029'; // Farm appid

                const authCode = await MiniProgramLoginSession.getAuthCode(ticket, appid, { apiDomain: qrLogin.apiDomain });

                let avatar = '';
                if (uin) {
                    avatar = `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640`;
                }

                res.json({ ok: true, data: { status: 'OK', code: authCode, uin, avatar, nickname } });
            } else if (result.status === 'Used') {
                res.json({ ok: true, data: { status: 'Used' } });
            } else if (result.status === 'Wait') {
                res.json({ ok: true, data: { status: 'Wait' } });
            } else {
                res.json({ ok: true, data: { status: 'Error', error: result.msg } });
            }
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('*', (req, res) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/game-config')) {
             return res.status(404).json({ ok: false, error: 'Not Found' });
        }
        if (fs.existsSync(webDist)) {
            res.sendFile(path.join(webDist, 'index.html'));
        } else {
            res.status(404).send('web build not found. Please build the web project.');
        }
    });

    const applySocketSubscription = (socket, accountRef = '') => {
        const incoming = String(accountRef || '').trim();
        const currentUser = socket.data.currentUser || null;
        const resolved = incoming && incoming !== 'all' ? resolveAccId(incoming) : '';
        for (const room of socket.rooms) {
            if (room.startsWith('account:')) socket.leave(room);
        }

        if (resolved) {
            const account = findAccountByRef(getAccountList(), resolved);
            try {
                ensureAccountAccess(currentUser, account);
                socket.join(`account:${resolved}`);
                socket.data.accountId = resolved;
            } catch {
                socket.data.accountId = '';
            }
        } else if (isAdmin(currentUser)) {
            socket.join('account:all');
            socket.data.accountId = '';
        } else {
            socket.data.accountId = '';
        }

        socket.emit('subscribed', { accountId: socket.data.accountId || (isAdmin(currentUser) ? 'all' : '') });

        try {
            const targetId = socket.data.accountId || '';
            if (targetId && provider && typeof provider.getStatus === 'function') {
                const currentStatus = provider.getStatus(targetId);
                socket.emit('status:update', { accountId: targetId, status: currentStatus });
            }
            if (provider && typeof provider.getLogs === 'function') {
                const currentLogs = provider.getLogs(targetId, { limit: 100 });
                socket.emit('logs:snapshot', {
                    accountId: targetId || 'all',
                    logs: Array.isArray(currentLogs) ? currentLogs : [],
                });
            }
            if (provider && typeof provider.getAccountLogs === 'function') {
                const currentAccountLogs = provider.getAccountLogs(100);
                const safeLogs = Array.isArray(currentAccountLogs) ? currentAccountLogs : [];
                if (isAdmin(currentUser)) {
                    socket.emit('account-logs:snapshot', {
                        logs: safeLogs,
                    });
                } else {
                    const visibleIds = new Set(getOwnedAccountList(currentUser).accounts.map(item => String(item.id || '')));
                    socket.emit('account-logs:snapshot', {
                        logs: safeLogs.filter(item => visibleIds.has(String((item && item.accountId) || ''))),
                    });
                }
            }
        } catch {
            // ignore snapshot push errors
        }
    };

    const port = CONFIG.adminPort || 3000;
    server = app.listen(port, '0.0.0.0', () => {
        adminLogger.info('admin panel started', { url: `http://localhost:${port}`, port });
    });

    io = new SocketIOServer(server, {
        path: '/socket.io',
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
            allowedHeaders: ['x-admin-token', 'x-account-id'],
        },
    });

    io.use((socket, next) => {
        const authToken = socket.handshake.auth && socket.handshake.auth.token
            ? String(socket.handshake.auth.token)
            : '';
        const headerToken = socket.handshake.headers && socket.handshake.headers['x-admin-token']
            ? String(socket.handshake.headers['x-admin-token'])
            : '';
        const token = authToken || headerToken;
        if (!token || !sessions.has(token)) {
            return next(new Error('Unauthorized'));
        }
        socket.data.adminToken = token;
        socket.data.currentUser = sessions.getUser(token);
        return next();
    });

    io.on('connection', (socket) => {
        const initialAccountRef = (socket.handshake.auth && socket.handshake.auth.accountId)
            || (socket.handshake.query && socket.handshake.query.accountId)
            || '';
        applySocketSubscription(socket, initialAccountRef);
        socket.emit('ready', { ok: true, ts: Date.now() });

        socket.on('subscribe', (payload) => {
            const body = (payload && typeof payload === 'object') ? payload : {};
            applySocketSubscription(socket, body.accountId || '');
        });
    });
}

module.exports = {
    startAdminServer,
    emitRealtimeStatus,
    emitRealtimeLog,
    emitRealtimeAccountLog,
};
