/**
 * QR Login Utilities
 */

class CookieUtils {
  static parse(cookieStr) {
    if (!cookieStr)
      return {}
    return cookieStr.split(';').reduce((acc, curr) => {
      const [key, value] = curr.split('=')
      if (key)
        acc[key.trim()] = value ? value.trim() : ''
      return acc
    }, {})
  }

  static getValue(cookies, key) {
    if (!cookies)
      return null
    if (Array.isArray(cookies))
      cookies = cookies.join('; ')
    const match = cookies.match(new RegExp(`(^|;\\s*)${key}=([^;]*)`))
    return match ? match[2] : null
  }

  static getUin(cookies) {
    const uin = this.getValue(cookies, 'wxuin') || this.getValue(cookies, 'uin') || this.getValue(cookies, 'ptui_loginuin')
    if (!uin)
      return null
    return uin.replace(/^o0*/, '')
  }
}

class HashUtils {
  static hash(str) {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash += (hash << 5) + str.charCodeAt(i)
    }
    return 2147483647 & hash
  }

  static getGTk(pskey) {
    let gtk = 5381
    for (let i = 0; i < pskey.length; i++) {
      gtk += (gtk << 5) + pskey.charCodeAt(i)
    }
    return gtk & 0x7FFFFFFF
  }
}

module.exports = { CookieUtils, HashUtils }
