/**
 * 推送接口封装（基于 pushoo / 自定义 JSON）
 */

const axios = require('axios');
const pushoo = require('pushoo').default;

function assertRequiredText(name, value) {
    const text = String(value || '').trim();
    if (!text) {
        throw new Error(`${name} 不能为空`);
    }
    return text;
}

/**
 * 发送推送
 * @param {object} payload
 * @param {string} payload.channel 必填 推送渠道（pushoo 平台名，如 webhook）
 * @param {string} [payload.endpoint] webhook 接口地址（channel=webhook 时使用）
 * @param {string} payload.token 必填 推送 token
 * @param {string} payload.title 必填 推送标题
 * @param {string} payload.content 必填 推送内容
 * @param {string} [payload.custom_headers] 自定义请求头（仅 custom_request 使用）
 * @param {string} [payload.custom_body] 自定义请求体（仅 custom_request 使用）
 * @returns {Promise<{ok: boolean, code: string, msg: string, raw: any}>} 推送结果
 */
async function sendPushooMessage(payload = {}) {
    const channelRaw = String(payload.channel || '').trim().toLowerCase();
    if (channelRaw === 'custom_request') {
        return await _sendCustomJsonMessage(payload);
    }

    const channel = assertRequiredText('channel', payload.channel);
    const endpoint = String(payload.endpoint || '').trim();
    const rawToken = String(payload.token || '').trim();
    const token = channel === 'webhook' ? rawToken : assertRequiredText('token', rawToken);
    const title = assertRequiredText('title', payload.title);
    const content = assertRequiredText('content', payload.content);

    const options = {};
    if (channel === 'webhook') {
        const url = assertRequiredText('endpoint', endpoint);
        options.webhook = { url, method: 'POST' };
    }

    const request = { title, content };
    if (token) request.token = token;
    if (channel === 'webhook') request.options = options;

    const result = await pushoo(channel, request);

    const raw = (result && typeof result === 'object') ? result : { data: result };
    const hasError = !!(raw && raw.error);
    const code = String(raw.code || raw.errcode || (hasError ? 'error' : 'ok'));
    const message = String(raw.msg || raw.message || (hasError ? (raw.error.message || 'push failed') : 'ok'));
    const ok = !hasError && (code === 'ok' || code === '0' || code === '' || String(raw.status || '').toLowerCase() === 'success');

    return {
        ok,
        code,
        msg: message,
        raw,
    };
}

/**
 * 递归替换对象中的占位符
 */
function _recursiveReplace(obj, title, content) {
    if (typeof obj === 'string') {
        return obj.replace(/\{\{title\}\}/g, title).replace(/\{\{content\}\}/g, content);
    }
    if (Array.isArray(obj)) {
        return obj.map(item => _recursiveReplace(item, title, content));
    }
    if (obj !== null && typeof obj === 'object') {
        const newObj = {};
        for (const key in obj) {
            newObj[key] = _recursiveReplace(obj[key], title, content);
        }
        return newObj;
    }
    return obj;
}

/**
 * 发送自定义 JSON 推送
 */
async function _sendCustomJsonMessage(payload) {
    try {
        const endpoint = assertRequiredText('endpoint', payload.endpoint);
        const title = payload.title || '';
        const content = payload.content || '';

        // 解析 Headers
        const headers = JSON.parse(payload.custom_headers || '{}');
        if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
            return {
                ok: false,
                code: 'invalid_headers',
                msg: '自定义 JSON 推送失败: Headers 必须是一个 JSON 对象',
            };
        }

        // 解析 Body
        const bodyTemplate = JSON.parse(payload.custom_body || '{}');
        const body = _recursiveReplace(bodyTemplate, title, content);

        const response = await axios.post(endpoint, body, {
            headers,
        });

        return { ok: true, code: 'ok', msg: 'success', raw: response.data };
    } catch (e) {
        return {
            ok: false,
            code: e.code || 'error',
            msg: `自定义 JSON 推送失败: ${e.message}`,
            raw: e,
        };
    }
}

module.exports = {
    sendPushooMessage,
};
