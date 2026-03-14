/**
 * 配置校验模块
 * 解决配置热更新未验证的问题
 */

const { createModuleLogger } = require('./logger');

const logger = createModuleLogger('config-validator');
const INTERVAL_MAX_SEC = 86400;

// 校验规则定义
const VALIDATORS = {
    // 基础类型
    string: (value) => typeof value === 'string',
    number: (value) => typeof value === 'number' && !Number.isNaN(value),
    boolean: (value) => typeof value === 'boolean',
    array: (value) => Array.isArray(value),
    object: (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
    
    // 数字范围
    positiveNumber: (value) => typeof value === 'number' && value > 0 && !Number.isNaN(value),
    nonNegativeNumber: (value) => typeof value === 'number' && value >= 0 && !Number.isNaN(value),
    integer: (value) => Number.isInteger(value),
    
    // 字符串限制
    minLength: (min) => (value) => typeof value === 'string' && value.length >= min,
    maxLength: (max) => (value) => typeof value === 'string' && value.length <= max,
    pattern: (regex) => (value) => typeof value === 'string' && regex.test(value),
    
    // 数组限制
    minLengthArray: (min) => (value) => Array.isArray(value) && value.length >= min,
    maxLengthArray: (max) => (value) => Array.isArray(value) && value.length <= max,
    
    // 数字范围
    range: (min, max) => (value) => typeof value === 'number' && value >= min && value <= max,
    min: (min) => (value) => typeof value === 'number' && value >= min,
    max: (max) => (value) => typeof value === 'number' && value <= max,
    
    // 枚举
    oneOf: (choices) => (value) => choices.includes(value),
    
    // 自定义
    custom: (fn) => (value) => fn(value),
};

// 自动化配置Schema
const AUTOMATION_SCHEMA = {
    type: 'object',
    properties: {
        farm: { type: 'boolean', default: true },
        farm_manage: { type: 'boolean', default: true },
        farm_water: { type: 'boolean', default: true },
        farm_weed: { type: 'boolean', default: true },
        farm_bug: { type: 'boolean', default: true },
        farm_push: { type: 'boolean', default: true },
        land_upgrade: { type: 'boolean', default: true },
        friend: { type: 'boolean', default: true },
        friend_steal: { type: 'boolean', default: true },
        friend_steal_blacklist: { type: 'array', items: { type: 'number', min: 1 }, default: [] },
        friend_help: { type: 'boolean', default: true },
        friend_bad: { type: 'boolean', default: false },
        friend_help_exp_limit: { type: 'boolean', default: true },
        task: { type: 'boolean', default: true },
        email: { type: 'boolean', default: true },
        fertilizer_gift: { type: 'boolean', default: false },
        fertilizer_buy: { type: 'boolean', default: false },
        fertilizer_buy_type: { type: 'string', oneOf: ['organic', 'normal', 'both'], default: 'organic' },
        fertilizer_buy_max: { type: 'number', min: 1, max: 10, default: 10 },
        fertilizer_buy_mode: { type: 'string', oneOf: ['threshold', 'unlimited'], default: 'threshold' },
        fertilizer_buy_threshold: { type: 'number', min: 0, default: 100 },
        free_gifts: { type: 'boolean', default: true },
        share_reward: { type: 'boolean', default: true },
        vip_gift: { type: 'boolean', default: true },
        month_card: { type: 'boolean', default: true },
        open_server_gift: { type: 'boolean', default: true },
        sell: { type: 'boolean', default: false },
        fertilizer_multi_season: { type: 'boolean', default: false },
        fertilizer_land_types: {
            type: 'array',
            default: ['gold', 'black', 'red', 'normal'],
            items: { type: 'string', oneOf: ['gold', 'black', 'red', 'normal'] },
        },
        fertilizer: { 
            type: 'string', 
            oneOf: ['none', 'normal', 'organic', 'both'],
            default: 'none',
        },
    },
    additionalProperties: false,
};

// 间隔配置Schema
const INTERVALS_SCHEMA = {
    type: 'object',
    properties: {
        farm: { type: 'number', min: 1, max: INTERVAL_MAX_SEC, default: 2 },
        friend: { type: 'number', min: 1, max: INTERVAL_MAX_SEC, default: 10 },
        farmMin: { type: 'number', min: 1, max: INTERVAL_MAX_SEC, default: 2 },
        farmMax: { type: 'number', min: 1, max: INTERVAL_MAX_SEC, default: 2 },
        friendMin: { type: 'number', min: 1, max: INTERVAL_MAX_SEC, default: 10 },
        friendMax: { type: 'number', min: 1, max: INTERVAL_MAX_SEC, default: 10 },
    },
    additionalProperties: false,
};

//屏蔽等级配置Schema
const BLOCKLEVEL_SCHEMA = {
    type: 'object',
    properties: {
        enabled: { type: 'boolean', default: true },
        Level: { type: 'number', min: 1, max: 999, default: 1 },
    },
    additionalProperties: false,
};

// 静默时段配置Schema
const QUIET_HOURS_SCHEMA = {
    type: 'object',
    properties: {
        enabled: { type: 'boolean', default: false },
        start: { 
            type: 'string', 
            pattern: /^([01]?\d|2[0-3]):[0-5]\d$/,
            default: '23:00',
        },
        end: { 
            type: 'string', 
            pattern: /^([01]?\d|2[0-3]):[0-5]\d$/,
            default: '07:00',
        },
    },
    additionalProperties: false,
};

// 账号配置Schema
const ACCOUNT_CONFIG_SCHEMA = {
    type: 'object',
    properties: {
        automation: AUTOMATION_SCHEMA,
        intervals: INTERVALS_SCHEMA,
        plantingStrategy: {
            type: 'string',
            oneOf: ['preferred', 'level', 'max_exp', 'max_fert_exp', 'max_profit', 'max_fert_profit'],
            default: 'preferred',
        },
        preferredSeedId: { type: 'number', min: 0, default: 0 },
        friendBlockLevel: BLOCKLEVEL_SCHEMA,
        friendQuietHours: QUIET_HOURS_SCHEMA,
        friendBlacklist: { type: 'array', items: { type: 'number' }, default: [] },
    },
    additionalProperties: false,
};

// 离线提醒Schema
const OFFLINE_REMINDER_SCHEMA = {
    type: 'object',
    properties: {
        channel: {
            type: 'string',
            oneOf: ['webhook', 'qmsg', 'serverchan', 'pushplus', 'pushplushxtrip', 
                    'dingtalk', 'wecom', 'bark', 'gocqhttp', 'onebot', 'atri',
                    'pushdeer', 'igot', 'telegram', 'feishu', 'ifttt', 'wecombot',
                    'discord', 'wxpusher'],
            default: 'webhook',
        },
        reloginUrlMode: {
            type: 'string',
            oneOf: ['none', 'qq_link', 'qr_code', 'all'],
            default: 'none',
        },
        endpoint: { type: 'string', maxLength: 500, default: '' },
        token: { type: 'string', maxLength: 200, default: '' },
        title: { type: 'string', maxLength: 100, default: '账号下线提醒' },
        msg: { type: 'string', maxLength: 500, default: '账号下线' },
        offlineDeleteSec: { type: 'number', min: 1, max: 9999999999, default: 1 },
        offlineDeleteEnabled: { type: 'boolean', default: false },
    },
    required: ['channel'],
    additionalProperties: false,
};

// 配置校验器类
class ConfigValidator {
    constructor() {
        this.schemas = new Map();
        this.errors = [];
        
        // 注册默认Schema
        this.registerSchema('automation', AUTOMATION_SCHEMA);
        this.registerSchema('intervals', INTERVALS_SCHEMA);
        this.registerSchema('blockLevel', BLOCKLEVEL_SCHEMA);
        this.registerSchema('quietHours', QUIET_HOURS_SCHEMA);
        this.registerSchema('accountConfig', ACCOUNT_CONFIG_SCHEMA);
        this.registerSchema('offlineReminder', OFFLINE_REMINDER_SCHEMA);
    }

    // 注册Schema
    registerSchema(name, schema) {
        this.schemas.set(name, schema);
    }

    // 校验配置
    validate(name, config) {
        const schema = this.schemas.get(name);
        if (!schema) {
            logger.warn('未找到Schema', { name });
            return { valid: true, data: config, errors: [] };
        }

        this.errors = [];
        const result = this.validateObject(config, schema, name);
        
        return {
            valid: this.errors.length === 0,
            data: result,
            errors: [...this.errors],
        };
    }

    // 递归校验对象
    validateObject(value, schema, path = '') {
        if (!schema) return value;

        // 类型校验
        if (schema.type) {
            const validator = VALIDATORS[schema.type];
            if (validator && !validator(value)) {
                this.errors.push({
                    path,
                    message: `类型错误: 期望 ${schema.type}, 实际 ${typeof value}`,
                });
                return schema.default || null;
            }
        }

        // 处理数组
        if (Array.isArray(value) && schema.type === 'array') {
            const itemSchema = schema.items;
            if (itemSchema) {
                return value.map((item, index) => 
                    this.validateObject(item, itemSchema, `${path}[${index}]`)
                );
            }
            return value;
        }

        // 处理对象
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            const result = {};
            const properties = schema.properties || {};
            
            for (const [key, propSchema] of Object.entries(properties)) {
                const valuePath = path ? `${path}.${key}` : key;
                
                if (Object.prototype.hasOwnProperty.call(value, key)) {
                    result[key] = this.validateObject(value[key], propSchema, valuePath);
                } else if (propSchema.default !== undefined) {
                    result[key] = propSchema.default;
                }
            }
            
            return result;
        }

        // 枚举校验
        if (schema.oneOf) {
            if (!schema.oneOf.includes(value)) {
                this.errors.push({
                    path,
                    message: `值必须是以下之一: ${schema.oneOf.join(', ')}`,
                });
                return schema.default;
            }
        }

        // 范围校验
        if (schema.min !== undefined && typeof value === 'number' && value < schema.min) {
            this.errors.push({
                path,
                message: `值必须大于等于 ${schema.min}`,
            });
            return schema.default;
        }
        
        if (schema.max !== undefined && typeof value === 'number' && value > schema.max) {
            this.errors.push({
                path,
                message: `值必须小于等于 ${schema.max}`,
            });
            return schema.default;
        }

        // 模式校验
        if (schema.pattern && typeof value === 'string') {
            const regex = new RegExp(schema.pattern);
            if (!regex.test(value)) {
                this.errors.push({
                    path,
                    message: `值不符合模式: ${schema.pattern}`,
                });
                return schema.default;
            }
        }

        return value;
    }

    // 校验并应用默认值
    validateAndDefault(name, config) {
        const result = this.validate(name, config);
        
        if (!result.valid) {
            logger.warn('配置校验失败，使用默认值', { 
                name, 
                errors: result.errors 
            });
        }
        
        return result.data;
    }
}

// 创建全局校验器
const globalValidator = new ConfigValidator();

// 便捷校验函数
function validateAutomation(config) {
    return globalValidator.validateAndDefault('automation', config);
}

function validateIntervals(config) {
    return globalValidator.validateAndDefault('intervals', config);
}

function validateAccountConfig(config) {
    return globalValidator.validateAndDefault('accountConfig', config);
}

function validateOfflineReminder(config) {
    return globalValidator.validateAndDefault('offlineReminder', config);
}

function validateBlockLevel(config) {
    return globalValidator.validateAndDefault('blockLevel', config);
}

function validateQuietHours(config) {
    return globalValidator.validateAndDefault('quietHours', config);
}

// 批量校验
function validateConfig(configs) {
    const results = {};
    
    for (const [name, config] of Object.entries(configs)) {
        results[name] = globalValidator.validate(name, config);
    }
    
    const allValid = Object.values(results).every(r => r.valid);
    
    return {
        valid: allValid,
        results,
    };
}

module.exports = {
    ConfigValidator,
    globalValidator,
    VALIDATORS,
    validateAutomation,
    validateIntervals,
    validateAccountConfig,
    validateOfflineReminder,
    validateBlockLevel,
    validateQuietHours,
    validateConfig,
    // Schema
    AUTOMATION_SCHEMA,
    INTERVALS_SCHEMA,
    BLOCKLEVEL_SCHEMA,
    QUIET_HOURS_SCHEMA,
    ACCOUNT_CONFIG_SCHEMA,
    OFFLINE_REMINDER_SCHEMA,
};
