const process = require('node:process');
/**
 * 配置常量与枚举定义
 */

const CONFIG = {
    serverUrl: 'wss://gate-obt.nqf.qq.com/prod/ws',
    clientVersion: '1.7.0.6_20260313',
    platform: 'qq',              // 平台: qq 或 wx (可通过 --wx 切换为微信)
    os: 'iOS',
    heartbeatInterval: 25000,    // 心跳间隔 25秒
    farmCheckInterval: 2000,      // 兼容旧逻辑：自己农场固定巡查间隔(ms)
    friendCheckInterval: 10000,   // 兼容旧逻辑：好友固定巡查间隔(ms)
    farmCheckIntervalMin: 2000,   // 新逻辑：农场巡查间隔最小值(ms)
    farmCheckIntervalMax: 2000,   // 新逻辑：农场巡查间隔最大值(ms)
    friendCheckIntervalMin: 10000,// 新逻辑：好友巡查间隔最小值(ms)
    friendCheckIntervalMax: 10000,// 新逻辑：好友巡查间隔最大值(ms)
    adminPort: Number(process.env.ADMIN_PORT || 3000), // 管理面板 HTTP 端口
    adminPassword: process.env.ADMIN_PASSWORD || 'admin',
    device_info: {
        client_version: "1.7.0.6_20260313",
        sys_software: 'iOS 26.2.1',
        network: 'wifi',
        memory: '7672',
        device_id: 'iPhone X<iPhone18,3>',
    }
};

// 生长阶段枚举
const PlantPhase = {
    UNKNOWN: 0,
    SEED: 1,
    GERMINATION: 2,
    SMALL_LEAVES: 3,
    LARGE_LEAVES: 4,
    BLOOMING: 5,
    MATURE: 6,
    DEAD: 7,
};

const PHASE_NAMES = ['未知', '种子', '发芽', '小叶', '大叶', '开花', '成熟', '枯死'];

module.exports = { CONFIG, PlantPhase, PHASE_NAMES };
