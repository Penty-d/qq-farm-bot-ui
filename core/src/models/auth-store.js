const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../services/json-db');

const USERS_FILE = getDataFile('users.json');
const INVITES_FILE = getDataFile('invites.json');

const ROLE_ADMIN = 'admin';
const ROLE_USER = 'user';

function now() {
    return Date.now();
}

function normalizeRole(role) {
    return String(role || '').trim().toLowerCase() === ROLE_ADMIN ? ROLE_ADMIN : ROLE_USER;
}

function normalizeUsername(username) {
    return String(username || '').trim().toLowerCase();
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeUser(raw, fallbackId = 0) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const id = Math.max(1, Number.parseInt(src.id, 10) || fallbackId || 1);
    const createdAt = Number(src.createdAt) || now();
    const updatedAt = Number(src.updatedAt) || createdAt;
    const username = normalizeUsername(src.username);
    return {
        id,
        username,
        passwordHash: String(src.passwordHash || ''),
        role: normalizeRole(src.role),
        createdAt,
        updatedAt,
        createdBy: src.createdBy ? String(src.createdBy) : '',
        lastLoginAt: Number(src.lastLoginAt) || 0,
    };
}

function normalizeUsersData(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const users = Array.isArray(data.users) ? data.users : [];
    const normalizedUsers = [];
    let maxId = 0;
    for (const item of users) {
        const normalized = normalizeUser(item, maxId + 1);
        if (!normalized.username)
            continue;
        if (!normalized.passwordHash)
            continue;
        if (normalizedUsers.some(user => user.username === normalized.username))
            continue;
        normalizedUsers.push(normalized);
        if (normalized.id > maxId)
            maxId = normalized.id;
    }
    let nextId = Number.parseInt(data.nextId, 10);
    if (!Number.isFinite(nextId) || nextId <= maxId)
        nextId = maxId + 1;
    if (normalizedUsers.length === 0)
        nextId = 1;
    return { users: normalizedUsers, nextId };
}

function normalizeInviteCode(code) {
    return String(code || '').trim().toUpperCase();
}

function normalizeInvite(raw, fallbackCode = '') {
    const src = raw && typeof raw === 'object' ? raw : {};
    const code = normalizeInviteCode(src.code || fallbackCode);
    const maxUses = Math.max(1, Number.parseInt(src.maxUses, 10) || 1);
    const usedCount = Math.max(0, Number.parseInt(src.usedCount, 10) || 0);
    const createdAt = Number(src.createdAt) || now();
    const updatedAt = Number(src.updatedAt) || createdAt;
    const invite = {
        code,
        maxUses,
        usedCount: Math.min(usedCount, maxUses),
        createdAt,
        updatedAt,
        createdBy: src.createdBy ? String(src.createdBy) : '',
        createdByUsername: src.createdByUsername ? String(src.createdByUsername) : '',
    };
    invite.remainingUses = Math.max(0, invite.maxUses - invite.usedCount);
    return invite;
}

function normalizeInvitesData(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const invites = Array.isArray(data.invites) ? data.invites : [];
    const normalizedInvites = [];
    for (const item of invites) {
        const normalized = normalizeInvite(item);
        if (!normalized.code)
            continue;
        if (normalized.remainingUses <= 0)
            continue;
        if (normalizedInvites.some(invite => invite.code === normalized.code))
            continue;
        normalizedInvites.push(normalized);
    }
    return { invites: normalizedInvites };
}

function loadUsersData() {
    ensureDataDir();
    return normalizeUsersData(readJsonFile(USERS_FILE, () => ({ users: [], nextId: 1 })));
}

function saveUsersData(data) {
    ensureDataDir();
    const normalized = normalizeUsersData(data);
    writeJsonFileAtomic(USERS_FILE, normalized);
    return normalized;
}

function loadInvitesData() {
    ensureDataDir();
    return normalizeInvitesData(readJsonFile(INVITES_FILE, () => ({ invites: [] })));
}

function saveInvitesData(data) {
    ensureDataDir();
    const normalized = normalizeInvitesData(data);
    writeJsonFileAtomic(INVITES_FILE, normalized);
    return normalized;
}

function sanitizeUser(user) {
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

function getUsers() {
    return loadUsersData();
}

function listUsers() {
    return loadUsersData().users.map(user => sanitizeUser(user));
}

function hasUsers() {
    return loadUsersData().users.length > 0;
}

function findUserByUsername(username) {
    const normalized = normalizeUsername(username);
    if (!normalized)
        return null;
    const data = loadUsersData();
    return data.users.find(user => user.username === normalized) || null;
}

function findUserById(userId) {
    const id = Number.parseInt(userId, 10);
    if (!Number.isFinite(id) || id <= 0)
        return null;
    const data = loadUsersData();
    return data.users.find(user => user.id === id) || null;
}

function createUser(payload) {
    const data = loadUsersData();
    const username = normalizeUsername(payload && payload.username);
    if (!username)
        throw new Error('用户名不能为空');
    if (data.users.some(user => user.username === username))
        throw new Error('用户名已存在');
    const passwordHash = String((payload && payload.passwordHash) || '').trim();
    if (!passwordHash)
        throw new Error('密码不能为空');

    const id = data.nextId++;
    const createdAt = now();
    const user = normalizeUser({
        id,
        username,
        passwordHash,
        role: normalizeRole(payload && payload.role),
        createdAt,
        updatedAt: createdAt,
        createdBy: payload && payload.createdBy ? String(payload.createdBy) : '',
        lastLoginAt: 0,
    }, id);

    data.users.push(user);
    saveUsersData(data);
    return sanitizeUser(user);
}

function updateUserPassword(userId, passwordHash) {
    const id = Number.parseInt(userId, 10);
    if (!Number.isFinite(id) || id <= 0)
        throw new Error('用户不存在');
    const nextHash = String(passwordHash || '').trim();
    if (!nextHash)
        throw new Error('密码不能为空');

    const data = loadUsersData();
    const target = data.users.find(user => user.id === id);
    if (!target)
        throw new Error('用户不存在');

    target.passwordHash = nextHash;
    target.updatedAt = now();
    saveUsersData(data);
    return sanitizeUser(target);
}

function markUserLogin(userId) {
    const id = Number.parseInt(userId, 10);
    if (!Number.isFinite(id) || id <= 0)
        return null;
    const data = loadUsersData();
    const target = data.users.find(user => user.id === id);
    if (!target)
        return null;
    target.lastLoginAt = now();
    target.updatedAt = now();
    saveUsersData(data);
    return sanitizeUser(target);
}

function createInvite(payload = {}) {
    const data = loadInvitesData();
    let code = normalizeInviteCode(payload.code);
    if (!code) {
        code = `INV-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    }
    if (data.invites.some(invite => invite.code === code))
        throw new Error('邀请码已存在');

    const invite = normalizeInvite({
        code,
        maxUses: payload.maxUses,
        usedCount: 0,
        createdAt: now(),
        updatedAt: now(),
        createdBy: payload.createdBy ? String(payload.createdBy) : '',
        createdByUsername: payload.createdByUsername ? String(payload.createdByUsername) : '',
    }, code);

    data.invites.unshift(invite);
    saveInvitesData(data);
    return invite;
}

function listInvites() {
    return loadInvitesData().invites
        .map(invite => normalizeInvite(invite))
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function getInviteByCode(code) {
    const normalized = normalizeInviteCode(code);
    if (!normalized)
        return null;
    const data = loadInvitesData();
    return data.invites.find(invite => invite.code === normalized) || null;
}

function consumeInvite(code) {
    const normalized = normalizeInviteCode(code);
    if (!normalized)
        throw new Error('邀请码不能为空');
    const data = loadInvitesData();
    const target = data.invites.find(invite => invite.code === normalized);
    if (!target)
        throw new Error('邀请码不存在或已失效');

    const invite = normalizeInvite(target);
    if (invite.remainingUses <= 0)
        throw new Error('邀请码不存在或已失效');

    target.usedCount = invite.usedCount + 1;
    target.updatedAt = now();

    if ((Number(target.usedCount) || 0) >= (Number(target.maxUses) || 0)) {
        data.invites = data.invites.filter(item => item.code !== normalized);
    }

    saveInvitesData(data);
    return normalizeInvite({
        ...invite,
        usedCount: invite.usedCount + 1,
        updatedAt: now(),
    });
}

function deleteInvite(code) {
    const normalized = normalizeInviteCode(code);
    if (!normalized)
        return false;
    const data = loadInvitesData();
    const beforeLength = data.invites.length;
    data.invites = data.invites.filter(invite => invite.code !== normalized);
    if (data.invites.length === beforeLength)
        return false;
    saveInvitesData(data);
    return true;
}

module.exports = {
    ROLE_ADMIN,
    ROLE_USER,
    sanitizeUser,
    getUsers,
    listUsers,
    hasUsers,
    findUserByUsername,
    findUserById,
    createUser,
    updateUserPassword,
    markUserLogin,
    createInvite,
    listInvites,
    getInviteByCode,
    consumeInvite,
    deleteInvite,
};
