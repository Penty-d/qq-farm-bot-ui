const { Buffer } = require('node:buffer');
/**
 * QR Code Login Module - 从 QRLib 集成
 */
const axios = require('axios');
const QRCode = require('qrcode');
const { CookieUtils, HashUtils } = require('../utils/qrutils');

const ChromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

class QRLoginSession {
    static Presets = {
        vip: {
            name: 'QQ会员 (VIP)',
            description: 'QQ会员官网',
            aid: '8000201',
            daid: '18',
            redirectUri: 'https://vip.qq.com/loginsuccess.html',
            referrer: 'https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=8000201&style=20&s_url=https%3A%2F%2Fvip.qq.com%2Floginsuccess.html&maskOpacity=60&daid=18&target=self',
        },
        qzone: {
            name: 'QQ空间 (QZone)',
            description: 'QQ空间网页版',
            aid: '549000912',
            daid: '5',
            redirectUri: 'https://qzs.qzone.qq.com/qzone/v5/loginsucc.html?para=izone',
            referrer: 'https://qzone.qq.com/',
        },
    };

    static async requestQRCode(presetKey = 'vip') {
        const config = this.Presets[presetKey] || this.Presets.vip;

        const params = new URLSearchParams({
            appid: config.aid,
            e: '2',
            l: 'M',
            s: '3',
            d: '72',
            v: '4',
            t: String(Math.random()),
            daid: config.daid,
        });

        params.set('u1', config.redirectUri);

        const url = `https://ssl.ptlogin2.qq.com/ptqrshow?${params.toString()}`;

        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                headers: {
                    'Referer': config.referrer || `https://xui.ptlogin2.qq.com/`,
                    'User-Agent': ChromeUA,
                }
            });

            const setCookie = response.headers['set-cookie'];
            const qrsig = CookieUtils.getValue(setCookie, 'qrsig');
            const qrcodeBase64 = Buffer.from(response.data).toString('base64');

            return { qrsig, qrcode: `data:image/png;base64,${qrcodeBase64}`, url };
        } catch (error) {
            console.error('Request QRCode Error:', error.message);
            throw error;
        }
    }

    static async checkStatus(qrsig, presetKey = 'vip') {
        const config = this.Presets[presetKey] || this.Presets.vip;
        const ptqrtoken = HashUtils.hash(qrsig);

        const params = new URLSearchParams({
            ptqrtoken: String(ptqrtoken),
            from_ui: '1',
            aid: config.aid,
            daid: config.daid,
            action: `0-0-${Date.now()}`,
            pt_uistyle: '40',
            js_ver: '21020514',
            js_type: '1'
        });

        params.set('u1', config.redirectUri);

        const api = `https://ssl.ptlogin2.qq.com/ptqrlogin?${params.toString()}`;

        try {
            const response = await axios.get(api, {
                headers: {
                    'Cookie': `qrsig=${qrsig}`,
                    'Referer': config.referrer || 'https://xui.ptlogin2.qq.com/',
                    'User-Agent': ChromeUA,
                },
            });

            const text = response.data;
            const matcher = /ptuiCB\((.+)\)/;
            const match = text.match(matcher);

            if (!match) {
                throw new Error('Invalid response format');
            }

            const args = [];
            const argMatcher = /'([^']*)'/g;
            for (let argMatch = argMatcher.exec(match[1]); argMatch !== null; argMatch = argMatcher.exec(match[1])) {
                args.push(argMatch[1]);
            }

            const [ret, , jumpUrl, , msg, nickname] = args;

            return {
                ret,
                msg,
                nickname,
                jumpUrl,
                cookie: response.headers['set-cookie']
            };
        } catch (error) {
            console.error('Check Status Error:', error.message);
            throw error;
        }
    }
}

class MiniProgramLoginSession {
    static QUA = 'V1_HT5_QDT_0.70.2209190_x64_0_DEV_D';

    static Presets = {
        farm: {
            name: 'QQ经典农场 (Farm)',
            description: 'QQ经典农场小程序',
            appid: '1112386029'
        }
    };

    static DEFAULT_API_DOMAIN = 'q.qq.com';

    static normalizeApiDomain(input) {
        const raw = String(input || '').trim();
        if (!raw) return this.DEFAULT_API_DOMAIN;
        const normalized = /^https?:\/\//i.test(raw) ? raw : (`https://${raw}`);
        try {
            const parsed = new URL(normalized);
            return String(parsed.host || '').trim() || this.DEFAULT_API_DOMAIN;
        } catch {
            return this.DEFAULT_API_DOMAIN;
        }
    }

    static resolveApiConfig(options = {}) {
        const domain = this.normalizeApiDomain(options.apiDomain);
        return {
            apiDomain: domain,
            apiOrigin: `https://${domain}`,
        };
    }

    static getHeaders(apiDomain = MiniProgramLoginSession.DEFAULT_API_DOMAIN) {
        return {
            'qua': MiniProgramLoginSession.QUA,
            'host': apiDomain,
            'accept': 'application/json',
            'content-type': 'application/json',
            'user-agent': ChromeUA
        };
    }

    static async requestLoginCode(options = {}) {
        try {
            const api = this.resolveApiConfig(options);
            const response = await axios.get(`${api.apiOrigin}/ide/devtoolAuth/GetLoginCode`, {
                headers: this.getHeaders(api.apiDomain)
            });

            const { code, data } = response.data;

            if (+code !== 0) {
                throw new Error('获取登录码失败');
            }

            const loginCode = data.code || '';
            const loginUrl = `https://h5.qzone.qq.com/qqq/code/${loginCode}?_proxy=1&from=ide`;
            const image = await QRCode.toDataURL(loginUrl, {
                width: 300,
                margin: 1,
                errorCorrectionLevel: 'M',
            });

            return {
                code: loginCode,
                url: loginUrl,
                image,
            };
        } catch (error) {
            console.error('MP Request Login Code Error:', error.message);
            throw error;
        }
    }

    static async queryStatus(code, options = {}) {
        try {
            const api = this.resolveApiConfig(options);
            const response = await axios.get(`${api.apiOrigin}/ide/devtoolAuth/syncScanSateGetTicket?code=${code}`, {
                headers: this.getHeaders(api.apiDomain)
            });

            if (response.status !== 200) {
                return { status: 'Error' };
            }

            const { code: resCode, data } = response.data;

            if (+resCode === 0) {
                if (+data.ok !== 1) return { status: 'Wait' };
                // 这里的 data.nick 字段可能存在，需要确认返回结构
                return { status: 'OK', ticket: data.ticket, uin: data.uin, nickname: data.nick || '' };
            }

            if (+resCode === -10003) return { status: 'Used' };

            return { status: 'Error', msg: `Code: ${resCode}` };
        } catch (error) {
            console.error('MP Query Status Error:', error.message);
            throw error;
        }
    }

    static async getAuthCode(ticket, appid = '1112386029', options = {}) {
        try {
            const api = this.resolveApiConfig(options);
            const response = await axios.post(`${api.apiOrigin}/ide/login`, {
                appid,
                ticket
            }, {
                headers: this.getHeaders(api.apiDomain)
            });

            if (response.status !== 200) return '';

            const { code } = response.data;
            return code || '';
        } catch (error) {
            console.error('MP Get Auth Code Error:', error.message);
            return '';
        }
    }
}

module.exports = { QRLoginSession, MiniProgramLoginSession };

