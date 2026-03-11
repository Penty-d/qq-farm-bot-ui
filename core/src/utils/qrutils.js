/**
 * QR Login Utilities
 */

class CookieUtils {
    static #keyRegexCache = new Map();

    static parse(cookieStr) {
        if (!cookieStr) return {};
        return cookieStr.split(';').reduce((acc, curr) => {
            const [key, value] = curr.split('=');
            if (key) acc[key.trim()] = value ? value.trim() : '';
            return acc;
        }, {});
    }

    static getValue(cookies, key) {
        if (!cookies) return null;
        if (Array.isArray(cookies)) cookies = cookies.join('; ');
        let regex = this.#keyRegexCache.get(key);
        if (!regex) {
            regex = new RegExp(`(^|;\\s*)${key}=([^;]*)`);
            this.#keyRegexCache.set(key, regex);
        }
        const match = cookies.match(regex);
        return match ? match[2] : null;
    }

    static getUin(cookies) {
        const uin = this.getValue(cookies, 'wxuin') || this.getValue(cookies, 'uin') || this.getValue(cookies, 'ptui_loginuin');
        if (!uin) return null;
        return uin.replace(/^o0*/, '');
    }
}

class HashUtils {
    static #djb2(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return hash >>> 0;
    }

    static hash(str) {
        return this.#djb2(str) >>> 1;
    }

    static getGTk(pskey) {
        return this.#djb2(pskey) >>> 0;
    }
}

module.exports = { CookieUtils, HashUtils };
