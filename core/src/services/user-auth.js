const authStore = require('../models/auth-store');
const store = require('../models/store');
const {
    hashPassword,
    verifyPassword,
    checkPasswordStrength,
    generateToken,
} = require('./security');

const { ROLE_ADMIN, ROLE_USER } = authStore;

function normalizeRole(role) {
    return String(role || '').trim().toLowerCase() === ROLE_ADMIN ? ROLE_ADMIN : ROLE_USER;
}

function isAdmin(user) {
    return normalizeRole(user && user.role) === ROLE_ADMIN;
}

function sanitizeSessionUser(user) {
    const src = user && typeof user === 'object' ? user : {};
    return {
        id: Number(src.id) || 0,
        username: String(src.username || ''),
        role: normalizeRole(src.role),
        createdAt: Number(src.createdAt) || 0,
        updatedAt: Number(src.updatedAt) || 0,
        createdBy: src.createdBy ? String(src.createdBy) : '',
        lastLoginAt: Number(src.lastLoginAt) || 0,
    };
}

async function ensureDefaultAdmin() {
    const users = authStore.listUsers();
    const hasAdmin = users.some(user => normalizeRole(user && user.role) === ROLE_ADMIN);
    if (hasAdmin) {
        return users;
    }

    const legacyHash = store.getAdminPasswordHash ? String(store.getAdminPasswordHash() || '') : '';
    let passwordHash = legacyHash;
    if (!passwordHash) {
        passwordHash = await hashPassword('admin');
        if (store.setAdminPasswordHash) {
            store.setAdminPasswordHash(passwordHash);
        }
    }

    const adminUser = authStore.findUserByUsername('admin');
    if (adminUser) {
        authStore.updateUserRole(adminUser.id, ROLE_ADMIN);
        if (legacyHash && String(adminUser.passwordHash || '') !== legacyHash) {
            authStore.updateUserPassword(adminUser.id, legacyHash);
        }
        return authStore.listUsers();
    }

    authStore.createUser({
        username: 'admin',
        passwordHash,
        role: ROLE_ADMIN,
        createdBy: 'system',
    });

    return authStore.listUsers();
}

async function registerUser({ username, password, inviteCode }) {
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const normalizedPassword = String(password || '');
    const normalizedInviteCode = String(inviteCode || '').trim().toUpperCase();

    if (!normalizedUsername) {
        throw new Error('用户名不能为空');
    }
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(normalizedUsername)) {
        throw new Error('用户名需为 3-32 位字母、数字或下划线');
    }

    const strength = checkPasswordStrength(normalizedPassword);
    if (!strength.valid) {
        throw new Error(strength.feedback[0] || '密码不符合要求');
    }

    if (authStore.findUserByUsername(normalizedUsername)) {
        throw new Error('用户名已存在');
    }

    if (!normalizedInviteCode) {
        throw new Error('邀请码不能为空');
    }

    const invite = authStore.getInviteByCode(normalizedInviteCode);
    if (!invite || Number(invite.remainingUses) <= 0) {
        throw new Error('邀请码不存在或已失效');
    }

    const passwordHash = await hashPassword(normalizedPassword);
    const user = authStore.createUser({
        username: normalizedUsername,
        passwordHash,
        role: ROLE_USER,
        createdBy: invite.createdBy || '',
    });

    authStore.consumeInvite(normalizedInviteCode);
    return sanitizeSessionUser(user);
}

async function loginUser({ username, password }) {
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const normalizedPassword = String(password || '');
    if (!normalizedUsername) {
        throw new Error('用户名不能为空');
    }
    if (!normalizedPassword) {
        throw new Error('密码不能为空');
    }

    const found = authStore.findUserByUsername(normalizedUsername);
    if (!found) {
        throw new Error('用户名或密码错误');
    }

    const ok = await verifyPassword(normalizedPassword, String(found.passwordHash || ''));
    if (!ok) {
        throw new Error('用户名或密码错误');
    }

    const user = authStore.markUserLogin(found.id) || found;
    return sanitizeSessionUser(user);
}

async function changePassword(sessionUser, oldPassword, newPassword) {
    const user = sessionUser && sessionUser.id ? authStore.findUserById(sessionUser.id) : null;
    if (!user) {
        throw new Error('用户不存在');
    }

    const oldOk = await verifyPassword(String(oldPassword || ''), String(user.passwordHash || ''));
    if (!oldOk) {
        throw new Error('原密码错误');
    }

    const nextPassword = String(newPassword || '');
    const strength = checkPasswordStrength(nextPassword);
    if (!strength.valid) {
        throw new Error(strength.feedback[0] || '密码不符合要求');
    }

    const passwordHash = await hashPassword(nextPassword);
    authStore.updateUserPassword(user.id, passwordHash);
    if (isAdmin(user) && store.setAdminPasswordHash) {
        store.setAdminPasswordHash(passwordHash);
    }
    return true;
}

function createSessionManager() {
    const sessions = new Map();

    function issue(user) {
        const token = generateToken(24);
        sessions.set(token, {
            token,
            user: sanitizeSessionUser(user),
            createdAt: Date.now(),
        });
        return token;
    }

    function get(token) {
        const normalizedToken = String(token || '').trim();
        if (!normalizedToken) {
            return null;
        }
        const session = sessions.get(normalizedToken);
        return session || null;
    }

    function getUser(token) {
        const session = get(token);
        if (!session) {
            return null;
        }

        const currentUser = authStore.findUserById(session.user && session.user.id);
        if (!currentUser) {
            sessions.delete(String(token || '').trim());
            return null;
        }

        const sanitizedUser = sanitizeSessionUser(currentUser);
        session.user = sanitizedUser;
        return sanitizedUser;
    }

    function revoke(token) {
        const normalizedToken = String(token || '').trim();
        if (!normalizedToken) {
            return false;
        }
        return sessions.delete(normalizedToken);
    }

    function revokeByUserId(userId) {
        const normalizedUserId = Number.parseInt(userId, 10);
        if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
            return 0;
        }

        let revokedCount = 0;
        for (const [token, session] of sessions.entries()) {
            if (Number(session && session.user && session.user.id) === normalizedUserId) {
                sessions.delete(token);
                revokedCount += 1;
            }
        }
        return revokedCount;
    }

    return {
        issue,
        get,
        getUser,
        revoke,
        revokeByUserId,
        has: (token) => !!getUser(token),
    };
}

function canAccessAccount(user, account) {
    if (!user || !account) {
        return false;
    }
    if (isAdmin(user)) {
        return true;
    }
    return Number(account.ownerUserId) === Number(user.id);
}

function ensureAccountAccess(user, account) {
    if (!account) {
        const error = new Error('Account not found');
        error.statusCode = 404;
        throw error;
    }
    if (!canAccessAccount(user, account)) {
        const error = new Error('Forbidden');
        error.statusCode = 403;
        throw error;
    }
    return true;
}

function sortAccountsForUser(accounts, user) {
    const list = Array.isArray(accounts) ? [...accounts] : [];
    const currentUserId = Number(user && user.id) || 0;
    return list.sort((a, b) => {
        if (isAdmin(user)) {
            const aOwned = Number(a && a.ownerUserId) === currentUserId ? 1 : 0;
            const bOwned = Number(b && b.ownerUserId) === currentUserId ? 1 : 0;
            if (aOwned !== bOwned) {
                return bOwned - aOwned;
            }
        }

        const aUpdated = Number(a && a.updatedAt) || 0;
        const bUpdated = Number(b && b.updatedAt) || 0;
        if (aUpdated !== bUpdated) {
            return bUpdated - aUpdated;
        }

        return String(a && a.id || '').localeCompare(String(b && b.id || ''));
    });
}

function filterAccountsForUser(accounts, user) {
    const visible = (Array.isArray(accounts) ? accounts : []).filter(account => canAccessAccount(user, account));
    return sortAccountsForUser(visible, user);
}

function decorateAccountsWithOwnership(accounts) {
    return (Array.isArray(accounts) ? accounts : []).map((account) => {
        const item = account && typeof account === 'object' ? { ...account } : {};
        return {
            ...item,
            ownerUserId: Number(item.ownerUserId) || 0,
            ownerUsername: String(item.ownerUsername || ''),
            belongsToCurrentUser: false,
            visibleStatus: item.visibleStatus || 'stopped',
            hasError: !!item.hasError,
        };
    });
}

function markAccountsForCurrentUser(accounts, user, getStatusById) {
    const list = decorateAccountsWithOwnership(accounts);
    const currentUserId = Number(user && user.id) || 0;
    return list.map((account) => {
        const status = typeof getStatusById === 'function' ? getStatusById(account.id) : null;
        const connected = !!(status && status.connection && status.connection.connected);
        const hasError = !!(status && status.wsError);
        return {
            ...account,
            belongsToCurrentUser: currentUserId > 0 && Number(account.ownerUserId) === currentUserId,
            visibleStatus: connected ? 'running' : (hasError ? 'error' : (account.running ? 'error' : 'stopped')),
            hasError,
        };
    });
}

function buildAccountStatusStats(accounts) {
    const runningIds = new Set();
    const errorIds = new Set();

    for (const account of Array.isArray(accounts) ? accounts : []) {
        const id = String(account && account.id || '').trim();
        if (!id) {
            continue;
        }
        if (String(account.visibleStatus || '') === 'running') {
            runningIds.add(id);
            continue;
        }
        if (String(account.visibleStatus || '') === 'error') {
            errorIds.add(id);
        }
    }

    return {
        total: new Set((Array.isArray(accounts) ? accounts : []).map(item => String(item && item.id || '')).filter(Boolean)).size,
        running: runningIds.size,
        error: errorIds.size,
    };
}

function createInviteCode(currentUser, maxUses) {
    if (!currentUser || !isAdmin(currentUser)) {
        throw new Error('Forbidden');
    }
    return authStore.createInvite({
        maxUses,
        createdBy: currentUser.id ? String(currentUser.id) : '',
        createdByUsername: currentUser.username ? String(currentUser.username) : '',
    });
}

function listInviteCodes(currentUser) {
    if (!currentUser || !isAdmin(currentUser)) {
        throw new Error('Forbidden');
    }
    return authStore.listInvites();
}

function deleteInviteCode(currentUser, code) {
    if (!currentUser || !isAdmin(currentUser)) {
        throw new Error('Forbidden');
    }
    return authStore.deleteInvite(code);
}

function listAllUsers(currentUser) {
    if (!currentUser || !isAdmin(currentUser)) {
        throw new Error('Forbidden');
    }
    return authStore.listUsers();
}

function deleteUser(currentUser, userId) {
    if (!currentUser || !isAdmin(currentUser)) {
        throw new Error('Forbidden');
    }

    const id = Number.parseInt(userId, 10);
    if (!Number.isFinite(id) || id <= 0) {
        throw new Error('用户不存在');
    }

    if (Number(currentUser.id) === id) {
        throw new Error('不能删除当前登录用户');
    }

    const target = authStore.findUserById(id);
    if (!target) {
        throw new Error('用户不存在');
    }

    if (normalizeRole(target.role) === ROLE_ADMIN) {
        const users = authStore.listUsers();
        const adminCount = users.filter(user => normalizeRole(user && user.role) === ROLE_ADMIN).length;
        if (adminCount <= 1) {
            throw new Error('至少需要保留一个管理员账号');
        }
    }

    authStore.deleteUser(id);
    return true;
}

module.exports = {
    ROLE_ADMIN,
    ROLE_USER,
    isAdmin,
    sanitizeSessionUser,
    ensureDefaultAdmin,
    registerUser,
    loginUser,
    changePassword,
    createSessionManager,
    canAccessAccount,
    ensureAccountAccess,
    sortAccountsForUser,
    filterAccountsForUser,
    decorateAccountsWithOwnership,
    markAccountsForCurrentUser,
    buildAccountStatusStats,
    createInviteCode,
    listInviteCodes,
    deleteInviteCode,
    listAllUsers,
    deleteUser,
};
