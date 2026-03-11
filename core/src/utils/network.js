const { Buffer } = require('node:buffer');
const EventEmitter = require('node:events');
/**
 * WebSocket 网络层 - 连接/消息编解码/登录/心跳
 */

const process = require('node:process');
const WebSocket = require('ws');
const { CONFIG } = require('../config/config');
const { createScheduler } = require('../services/scheduler');
const { updateStatusFromLogin, updateStatusGold, updateStatusLevel } = require('../services/status');
const { recordOperation } = require('../services/stats');
const { types } = require('./proto');
const { toLong, toNum, syncServerTime, log, logWarn } = require('./utils');
const cryptoWasm = require('./crypto-wasm');

// ============ 事件发射器 (用于推送通知) ============
const networkEvents = new EventEmitter();

// ============ 内部状态 ============
let ws = null;
let clientSeq = 1;
let serverSeq = 0;
const pendingCallbacks = new Map();
let wsErrorState = { code: 0, at: 0, message: '' };
const networkScheduler = createScheduler('network');

function rejectAllPendingRequests(reason = '请求被中断') {
    const entries = Array.from(pendingCallbacks.entries());
    pendingCallbacks.clear();
    for (const [, callback] of entries) {
        try {
            callback(new Error(reason));
        } catch {
            // ignore callback failure
        }
    }
    return entries.length;
}

// ============ 用户状态 (登录后设置) ============
const userState = {
    gid: 0,
    name: '',
    level: 0,
    gold: 0,
    exp: 0,
    coupon: 0, // 点券(ID:1002)
};

function getUserState() { return userState; }
function getWsErrorState() { return { ...wsErrorState }; }
function setWsErrorState(code, message) {
    wsErrorState = { code: Number(code) || 0, at: Date.now(), message: message || '' };
}
function clearWsErrorState() {
    wsErrorState = { code: 0, at: 0, message: '' };
}
function hasOwn(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

// ============ 消息编解码 ============
async function encodeMsg(serviceName, methodName, bodyBytes, clientSeqValue) {
    let finalBody = bodyBytes || Buffer.alloc(0);
    try {
        finalBody = await cryptoWasm.encryptBuffer(finalBody);
    } catch (e) {
        // 兼容模式：如果加密失败（例如环境不支持），尝试发送未加密包，但打印警告
        logWarn('系统', `WASM加密失败: ${e.message}`);
    }

    const msg = types.GateMessage.create({
        meta: {
            service_name: serviceName,
            method_name: methodName,
            message_type: 1,
            client_seq: toLong(clientSeqValue),
            server_seq: toLong(serverSeq),
        },
        body: finalBody,
    });
    const encoded = types.GateMessage.encode(msg).finish();
    return encoded;
}

async function sendMsg(serviceName, methodName, bodyBytes, callback) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        log('系统', '[WS] 连接未打开');
        if (callback) callback(new Error('连接未打开'));
        return false;
    }
    const seq = clientSeq;
    clientSeq += 1;
    let encoded;
    try {
        encoded = await encodeMsg(serviceName, methodName, bodyBytes, seq);
    } catch (err) {
        if (callback) callback(err);
        return false;
    }

    if (callback) pendingCallbacks.set(seq, callback);

    // 再次检查连接状态（因为 await 期间可能断开）
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        if (callback) {
            pendingCallbacks.delete(seq);
            callback(new Error('连接已在加密途中关闭'));
        }
        return false;
    }

    try {
        ws.send(encoded);
    } catch (err) {
        if (callback) {
            pendingCallbacks.delete(seq);
            callback(err);
        }
        return false;
    }
    return true;
}

/** Promise 版发送 */
function sendMsgAsync(serviceName, methodName, bodyBytes, timeout = 10000) {
    return new Promise((resolve, reject) => {
        // 检查连接状态
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            reject(new Error(`连接未打开: ${methodName}`));
            return;
        }

        const seq = clientSeq;
        const timeoutKey = `request_timeout_${seq}`;
        networkScheduler.setTimeoutTask(timeoutKey, timeout, () => {
            pendingCallbacks.delete(seq);
            // 检查当前待处理的请求数
            const pending = pendingCallbacks.size;
            reject(new Error(`请求超时: ${methodName} (seq=${seq}, pending=${pending})`));
        });

        sendMsg(serviceName, methodName, bodyBytes, (err, body, meta) => {
            networkScheduler.clear(timeoutKey);
            if (err) reject(err);
            else resolve({ body, meta });
        }).then(sent => {
            if (!sent) {
                networkScheduler.clear(timeoutKey);
                // 这里不再 reject，因为 callback 会被调用并 reject
                // 但如果 sendMsg 返回 false 且没有调用 callback (例如连接未打开)，则需要处理
                // 修改后的 sendMsg 会在连接未打开时调用 callback
            }
        }).catch(err => {
            networkScheduler.clear(timeoutKey);
            reject(err);
        });
    });
}

// ============ 消息处理 ============
function handleMessage(data) {
    try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const msg = types.GateMessage.decode(buf);
        const meta = msg.meta;
        if (!meta) return;

        if (meta.server_seq) {
            const seq = toNum(meta.server_seq);
            if (seq > serverSeq) serverSeq = seq;
        }

        const msgType = meta.message_type;

        // Notify
        if (msgType === 3) {
            handleNotify(msg);
            return;
        }

        // Response
        if (msgType === 2) {
            const errorCode = toNum(meta.error_code);
            const clientSeqVal = toNum(meta.client_seq);

            const cb = pendingCallbacks.get(clientSeqVal);
            if (cb) {
                pendingCallbacks.delete(clientSeqVal);
                if (errorCode !== 0) {
                    cb(new Error(`${meta.service_name}.${meta.method_name} 错误: code=${errorCode} ${meta.error_message || ''}`));
                } else {
                    cb(null, msg.body, meta);
                }
                return;
            }

            if (errorCode !== 0) {
                logWarn('错误', `${meta.service_name}.${meta.method_name} code=${errorCode} ${meta.error_message || ''}`);
            }
        }
    } catch (err) {
        logWarn('解码', err.message);
    }
}

// ============ 通知处理映射表 ============
const notifyHandlers = new Map();
// 被踢下线
notifyHandlers.set('Kickout', (eventBody) => {
    const notify = types.KickoutNotify.decode(eventBody);
    log('推送', `原因: ${notify.reason_message || '未知'}`);
    networkEvents.emit('kickout', {
        type: 'Kickout',
        reason: notify.reason_message || '未知',
    });
});

// 土地状态变化 (被放虫/放草/偷菜等)
notifyHandlers.set('LandsNotify', (eventBody) => {
    const notify = types.LandsNotify.decode(eventBody);
    const hostGid = toNum(notify.host_gid);
    const lands = notify.lands || [];
    if (lands.length > 0 && (hostGid === userState.gid || hostGid === 0)) {
        networkEvents.emit('landsChanged', lands);
    }
});

// 物品变化通知 (经验/金币等)
notifyHandlers.set('ItemNotify', (eventBody) => {
    const notify = types.ItemNotify.decode(eventBody);
    const items = notify.items || [];
    for (const itemChg of items) {
        const item = itemChg.item;
        if (!item) continue;
        const id = toNum(item.id);
        const count = toNum(item.count);
        const delta = toNum(itemChg.delta);

        // 仅使用 ID=1101 作为经验值标准
        if (id === 1101) {
            // 优先使用总量；若仅有 delta 也可累加
            if (count > 0) userState.exp = count;
            else if (delta !== 0) userState.exp = Math.max(0, Number(userState.exp || 0) + delta);
            // 这里调用 updateStatusLevel 会触发 status.js -> worker.js -> stats.js 的更新流程
            updateStatusLevel(userState.level, userState.exp);
        } else if (id === 1 || id === 1001) {
            // 金币通知有时只有 delta 没有总量，避免把未提供总量误当 0 覆盖
            if (count > 0) {
                userState.gold = count;
            } else if (delta !== 0) {
                userState.gold = Math.max(0, Number(userState.gold || 0) + delta);
            }
            updateStatusGold(userState.gold);
        } else if (id === 1002) {
            // 点券
            if (count > 0) {
                userState.coupon = count;
            } else if (delta !== 0) {
                userState.coupon = Math.max(0, Number(userState.coupon || 0) + delta);
            }
        }
    }
});

// 基本信息变化 (升级等)
notifyHandlers.set('BasicNotify', (eventBody) => {
    const notify = types.BasicNotify.decode(eventBody);
    if (!notify.basic) return;
    const oldLevel = userState.level;
    if (hasOwn(notify.basic, 'level')) {
        const nextLevel = toNum(notify.basic.level);
        if (Number.isFinite(nextLevel) && nextLevel > 0) userState.level = nextLevel;
    }
    let shouldUpdateGoldView = false;
    if (hasOwn(notify.basic, 'gold')) {
        const nextGold = toNum(notify.basic.gold);
        if (Number.isFinite(nextGold) && nextGold >= 0) {
            userState.gold = nextGold;
            shouldUpdateGoldView = true;
        }
    }
    if (hasOwn(notify.basic, 'exp')) {
        const exp = toNum(notify.basic.exp);
        if (Number.isFinite(exp) && exp >= 0) {
            userState.exp = exp;
            updateStatusLevel(userState.level, exp);
        }
    }
    if (shouldUpdateGoldView) {
        updateStatusGold(userState.gold);
    }
    if (userState.level !== oldLevel) {
        recordOperation('levelUp', 1);
    }
});

// 好友申请通知 (微信同玩)
notifyHandlers.set('FriendApplicationReceivedNotify', (eventBody) => {
    const notify = types.FriendApplicationReceivedNotify.decode(eventBody);
    const applications = notify.applications || [];
    if (applications.length > 0) {
        networkEvents.emit('friendApplicationReceived', applications);
    }
});

// 好友添加成功通知
notifyHandlers.set('FriendAddedNotify', (eventBody) => {
    const notify = types.FriendAddedNotify.decode(eventBody);
    const friends = notify.friends || [];
    if (friends.length > 0) {
        const names = friends.map(f => f.name || f.remark || `GID:${toNum(f.gid)}`).join(', ');
        log('好友', `新好友: ${names}`);
    }
});

// 商品解锁通知 (升级后解锁新种子等)
notifyHandlers.set('GoodsUnlockNotify', (eventBody) => {
    const notify = types.GoodsUnlockNotify.decode(eventBody);
    const goods = notify.goods_list || [];
    if (goods.length > 0) {
        networkEvents.emit('goodsUnlockNotify', goods);
    }
});

// 任务状态变化通知
notifyHandlers.set('TaskInfoNotify', (eventBody) => {
    const notify = types.TaskInfoNotify.decode(eventBody);
    if (notify.task_info) {
        networkEvents.emit('taskInfoNotify', notify.task_info);
    }
});

function handleNotify(msg) {
    if (!msg.body || msg.body.length === 0) return;
    try {
        const event = types.EventMessage.decode(msg.body);
        const type = event.message_type || '';
        const eventBody = event.body;

        for (const [key, handler] of notifyHandlers) {
            if (type.includes(key)) {
                try { handler(eventBody); } catch { }
                return;
            }
        }
        // 其他未处理的推送类型 (调试用)
        // log('推送', `未处理类型: ${type}`);
    } catch (e) {
        logWarn('推送', `解码失败: ${e.message}`);
    }
}

function buildDeviceInfo() {
    const cfg = (CONFIG.device_info && typeof CONFIG.device_info === 'object') ? CONFIG.device_info : {};
    return {
        client_version: String(CONFIG.clientVersion || cfg.client_version || ''),
        sys_software: String(cfg.sys_software || 'iOS 26.2.1'),
        network: String(cfg.network || 'wifi'),
        memory: String(cfg.memory || '7672'),
        device_id: String(cfg.device_id || 'iPhone X<iPhone18,3>'),
    };
}

// ============ 登录 ============
function sendLogin(onLoginSuccess) {
    const body = types.LoginRequest.encode(types.LoginRequest.create({
        sharer_id: toLong(0),
        sharer_open_id: '',
        device_info: buildDeviceInfo(),
        share_cfg_id: toLong(0),
        scene_id: '1256',
        report_data: {
            callback: '', cd_extend_info: '', click_id: '', clue_token: '',
            minigame_channel: 'other', minigame_platid: 2, req_id: '', trackid: '',
        },
    })).finish();

    sendMsg('gamepb.userpb.UserService', 'Login', body, (err, bodyBytes, _meta) => {
        if (err) {
            log('登录', `失败: ${err.message}`);
            // 如果是验证失败，直接退出进程
            if (err.message.includes('code=')) {
                log('系统', '账号验证失败，即将停止运行...');
                networkScheduler.setTimeoutTask('login_error_exit', 1000, () => process.exit(0));
            }
            return;
        }
        try {
            const reply = types.LoginReply.decode(bodyBytes);
            if (reply.basic) {
                clearWsErrorState();
                userState.gid = toNum(reply.basic.gid);
                userState.name = reply.basic.name || '未知';
                userState.level = toNum(reply.basic.level);
                userState.gold = toNum(reply.basic.gold);
                userState.exp = toNum(reply.basic.exp);

                // 更新状态栏
                updateStatusFromLogin({
                    name: userState.name,
                    level: userState.level,
                    gold: userState.gold,
                    exp: userState.exp,
                });

                log('系统', `登录成功: ${userState.name} (Lv${userState.level})`);

                console.warn('');
                console.warn('========== 登录成功 ==========');
                console.warn(`  GID:    ${userState.gid}`);
                console.warn(`  昵称:   ${userState.name}`);
                console.warn(`  等级:   ${userState.level}`);
                console.warn(`  金币:   ${userState.gold}`);
                if (reply.time_now_millis) {
                    syncServerTime(toNum(reply.time_now_millis));
                    console.warn(`  时间:   ${new Date(toNum(reply.time_now_millis)).toLocaleString()}`);
                }
                console.warn('===============================');
                console.warn('');
            }

            startHeartbeat();
            if (onLoginSuccess) onLoginSuccess();
        } catch (e) {
            log('登录', `解码失败: ${e.message}`);
        }
    });
}

// ============ 心跳 ============
let lastHeartbeatResponse = Date.now();
let heartbeatMissCount = 0;

function startHeartbeat() {
    networkScheduler.clear('heartbeat_interval');
    lastHeartbeatResponse = Date.now();
    heartbeatMissCount = 0;

    networkScheduler.setIntervalTask('heartbeat_interval', CONFIG.heartbeatInterval, () => {
        if (!userState.gid) return;

        // 检查上次心跳响应时间，超过 60 秒没响应说明连接有问题
        const timeSinceLastResponse = Date.now() - lastHeartbeatResponse;
        if (timeSinceLastResponse > 60000) {
            heartbeatMissCount++;
            logWarn('心跳', `连接可能已断开 (${Math.round(timeSinceLastResponse / 1000)}s 无响应, pending=${pendingCallbacks.size})`);
            if (heartbeatMissCount >= 2) {
                log('心跳', '尝试重连...');
                // 清理待处理的回调，避免堆积
                rejectAllPendingRequests('连接超时，已清理');
            }
        }

        const body = types.HeartbeatRequest.encode(types.HeartbeatRequest.create({
            gid: toLong(userState.gid),
            client_version: CONFIG.clientVersion,
        })).finish();
        sendMsg('gamepb.userpb.UserService', 'Heartbeat', body, (err, replyBody) => {
            if (err || !replyBody) return;
            lastHeartbeatResponse = Date.now();
            heartbeatMissCount = 0;
            try {
                const reply = types.HeartbeatReply.decode(replyBody);
                if (reply.server_time) syncServerTime(toNum(reply.server_time));
            } catch { }
        });
    });
}

// ============ WebSocket 连接 ============
let savedLoginCallback = null;
let savedCode = null;

function connect(code, onLoginSuccess) {
    savedLoginCallback = onLoginSuccess;
    if (code) savedCode = code;
    const url = `${CONFIG.serverUrl}?platform=${encodeURIComponent(CONFIG.platform)}&os=${encodeURIComponent(CONFIG.os)}&ver=${encodeURIComponent(CONFIG.clientVersion)}&code=${encodeURIComponent(savedCode)}&openID=`;

    ws = new WebSocket(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)',
            'Origin': 'https://gate-obt.nqf.qq.com',
        },
    });

    ws.binaryType = 'arraybuffer';

    ws.on('open', () => {
        sendLogin(onLoginSuccess);
    });

    ws.on('message', (data) => {
        handleMessage(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });

    ws.on('close', (code, _reason) => {
        console.warn(`[WS] 连接关闭 (code=${code})`);
        cleanup(`连接关闭(code=${code})`);
        // 自动重连：延迟 5s 后重试，复用已保存的登录回调
        if (savedLoginCallback) {
            networkScheduler.setTimeoutTask('auto_reconnect', 5000, () => {
                log('系统', '[WS] 尝试自动重连...');
                reconnect(null);
            });
        }
    });

    ws.on('error', (err) => {
        const message = err && err.message ? String(err.message) : '';
        logWarn('系统', `[WS] 错误: ${message}`);
        const match = message.match(/Unexpected server response:\s*(\d+)/i);
        if (match) {
            const code = Number.parseInt(match[1], 10) || 0;
            if (code) {
                setWsErrorState(code, message);
                networkEvents.emit('ws_error', { code, message });
            }
        }
    });
}

function cleanup(reason = '网络清理') {
    rejectAllPendingRequests(`请求已中断: ${reason}`);
    networkScheduler.clearAll();
}

function reconnect(newCode) {
    cleanup('主动重连');
    if (ws) {
        ws.removeAllListeners();
        ws.close();
        ws = null;
    }
    userState.gid = 0;
    connect(newCode || savedCode, savedLoginCallback);
}

function getWs() { return ws; }

module.exports = {
    connect, reconnect, cleanup, getWs,
    sendMsg, sendMsgAsync,
    getUserState,
    getWsErrorState,
    networkEvents,
};
