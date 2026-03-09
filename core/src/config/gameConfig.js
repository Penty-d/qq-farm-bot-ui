/**
 * 游戏配置数据模块
 * 从 gameConfig 目录加载配置数据
 */

const fs = require('node:fs');
const path = require('node:path');
const { getResourcePath } = require('./runtime-paths');

// ============ 等级经验表 ============
let roleLevelConfig = null;
let levelExpTable = null;  // 累计经验表，索引为等级

// ============ 植物配置 ============
let plantConfig = null;
const plantMap = new Map();  // id -> plant
const seedToPlant = new Map();  // seed_id -> plant
const fruitToPlant = new Map();  // fruit_id -> plant (果实ID -> 植物)
let itemInfoConfig = null;
const itemInfoMap = new Map();  // item_id -> item
const seedItemMap = new Map();  // seed_id -> item(type=5)
const seedImageMap = new Map(); // seed_id -> image url
const seedAssetImageMap = new Map(); // asset_name (Crop_xxx) -> image url

/**
 * 加载配置文件
 */
function loadConfigs() {
    const configDir = getResourcePath('gameConfig');
    
    // 加载等级经验配置
    try {
        const roleLevelPath = path.join(configDir, 'RoleLevel.json');
        if (fs.existsSync(roleLevelPath)) {
            roleLevelConfig = JSON.parse(fs.readFileSync(roleLevelPath, 'utf8'));
            // 构建累计经验表
            levelExpTable = [];
            for (const item of roleLevelConfig) {
                levelExpTable[item.level] = item.exp;
            }
            console.warn(`[配置] 已加载等级经验表 (${roleLevelConfig.length} 级)`);
        }
    } catch (e) {
        console.warn('[配置] 加载 RoleLevel.json 失败:', e.message);
    }
    
    // 加载植物配置
    try {
        const plantPath = path.join(configDir, 'Plant.json');
        if (fs.existsSync(plantPath)) {
            plantConfig = JSON.parse(fs.readFileSync(plantPath, 'utf8'));
            plantMap.clear();
            seedToPlant.clear();
            fruitToPlant.clear();
            for (const plant of plantConfig) {
                plantMap.set(plant.id, plant);
                if (plant.seed_id) {
                    seedToPlant.set(plant.seed_id, plant);
                }
                if (plant.fruit && plant.fruit.id) {
                    fruitToPlant.set(plant.fruit.id, plant);
                }
            }
            console.warn(`[配置] 已加载植物配置 (${plantConfig.length} 种)`);
        }
    } catch (e) {
        console.warn('[配置] 加载 Plant.json 失败:', e.message);
    }

    // 加载物品配置（含种子/果实价格）
    try {
        const itemInfoPath = path.join(configDir, 'ItemInfo.json');
        if (fs.existsSync(itemInfoPath)) {
            itemInfoConfig = JSON.parse(fs.readFileSync(itemInfoPath, 'utf8'));
            itemInfoMap.clear();
            seedItemMap.clear();
            for (const item of itemInfoConfig) {
                const id = Number(item && item.id) || 0;
                if (id <= 0) continue;
                itemInfoMap.set(id, item);
                if (Number(item.type) === 5) {
                    seedItemMap.set(id, item);
                }
            }
            console.warn(`[配置] 已加载物品配置 (${itemInfoConfig.length} 项)`);
        }
    } catch (e) {
        console.warn('[配置] 加载 ItemInfo.json 失败:', e.message);
    }

    // 加载种子图片映射（seed_images_named）
    try {
        const seedImageDir = path.join(configDir, 'seed_images_named');
        seedImageMap.clear();
        seedAssetImageMap.clear();
        if (fs.existsSync(seedImageDir)) {
            const files = fs.readdirSync(seedImageDir);
            for (const file of files) {
                const filename = String(file || '');
                const fileUrl = `/game-config/seed_images_named/${encodeURIComponent(file)}`;

                // 1) id_..._Seed.png 命名，按 id 建立映射
                const byId = filename.match(/^(\d+)_.*\.(?:png|jpg|jpeg|webp|gif)$/i);
                if (byId) {
                    const seedId = Number(byId[1]) || 0;
                    if (seedId > 0 && !seedImageMap.has(seedId)) {
                        seedImageMap.set(seedId, fileUrl);
                    }
                }

                // 2) ...Crop_xxx_Seed.png 命名，按 asset_name 建立映射
                const byAsset = filename.match(/(Crop_\d+)_Seed\.(?:png|jpg|jpeg|webp|gif)$/i);
                if (byAsset) {
                    const assetName = byAsset[1];
                    if (assetName && !seedAssetImageMap.has(assetName)) {
                        seedAssetImageMap.set(assetName, fileUrl);
                    }
                }
            }
            console.warn(`[配置] 已加载种子图片映射 (${seedImageMap.size} 项)`);
        }
    } catch (e) {
        console.warn('[配置] 加载 seed_images_named 失败:', e.message);
    }
}

// ============ 等级经验相关 ============

/**
 * 获取等级经验表
 */
function getLevelExpTable() {
    return levelExpTable;
}

/**
 * 计算当前等级的经验进度
 * @param {number} level - 当前等级
 * @param {number} totalExp - 累计总经验
 * @returns {{ current: number, needed: number }} 当前等级经验进度
 */
function getLevelExpProgress(level, totalExp) {
    if (!levelExpTable || level <= 0) return { current: 0, needed: 0 };
    
    const currentLevelStart = levelExpTable[level] || 0;
    const nextLevelStart = levelExpTable[level + 1] || (currentLevelStart + 100000);
    
    const currentExp = Math.max(0, totalExp - currentLevelStart);
    const neededExp = nextLevelStart - currentLevelStart;
    
    return { current: currentExp, needed: neededExp };
}

// ============ 植物配置相关 ============

/**
 * 根据植物ID获取植物信息
 * @param {number} plantId - 植物ID
 */
function getPlantById(plantId) {
    return plantMap.get(plantId);
}

/**
 * 根据种子ID获取植物信息
 * @param {number} seedId - 种子ID
 */
function getPlantBySeedId(seedId) {
    return seedToPlant.get(seedId);
}

/**
 * 获取植物名称
 * @param {number} plantId - 植物ID
 */
function getPlantName(plantId) {
    const plant = plantMap.get(plantId);
    return plant ? plant.name : `植物${plantId}`;
}

/**
 * 根据种子ID获取植物名称
 * @param {number} seedId - 种子ID
 */
function getPlantNameBySeedId(seedId) {
    const plant = seedToPlant.get(seedId);
    return plant ? plant.name : `种子${seedId}`;
}

/**
 * 获取植物的生长时间（秒）
 * @param {number} plantId - 植物ID
 */
function getPlantGrowTime(plantId) {
    const plant = plantMap.get(plantId);
    if (!plant || !plant.grow_phases) return 0;
    
    // 解析 "种子:30;发芽:30;成熟:0;" 格式
    const phases = plant.grow_phases.split(';').filter(p => p);
    let totalSeconds = 0;
    for (const phase of phases) {
        const match = phase.match(/:(\d+)/);
        if (match) {
            totalSeconds += Number.parseInt(match[1]);
        }
    }
    return totalSeconds;
}

/**
 * 格式化时间
 * @param {number} seconds - 秒数
 */
function formatGrowTime(seconds) {
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}小时${mins}分` : `${hours}小时`;
}

/**
 * 获取植物的收获经验
 * @param {number} plantId - 植物ID
 */
function getPlantExp(plantId) {
    const plant = plantMap.get(plantId);
    return plant ? plant.exp : 0;
}

/**
 * 根据果实ID获取植物名称
 * @param {number} fruitId - 果实ID
 */
function getFruitName(fruitId) {
    const plant = fruitToPlant.get(fruitId);
    return plant ? plant.name : `果实${fruitId}`;
}

/**
 * 根据果实ID获取植物信息
 * @param {number} fruitId - 果实ID
 */
function getPlantByFruitId(fruitId) {
    return fruitToPlant.get(fruitId);
}

/**
 * 获取所有种子信息（用于备选）
 */
function getAllSeeds() {
    return Array.from(seedToPlant.values()).map(p => ({
        plantId: Number(p.id) || 0,
        seedId: p.seed_id,
        name: p.name,
        requiredLevel: Number(p.land_level_need) || 0,
        price: getSeedPrice(p.seed_id),
        image: getSeedImageBySeedId(p.seed_id),
    }));
}

function getMappedSeedImage(targetId) {
    const id = Number(targetId) || 0;
    if (id <= 0) return '';

    const direct = seedImageMap.get(id);
    if (direct) return direct;

    const item = itemInfoMap.get(id);
    const assetName = item && item.asset_name ? String(item.asset_name).trim() : '';
    if (!assetName) return '';

    return seedAssetImageMap.get(assetName) || '';
}

function getSeedImageBySeedId(seedId) {
    return getMappedSeedImage(seedId);
}

function getItemImageById(itemId) {
    const id = Number(itemId) || 0;
    if (id <= 0) return '';

    // 内部函数：根据 ID 获取图片
    const getImg = (targetId) => {
        // 1. 优先按物品ID命中（如 20003_胡萝卜_Crop_3_Seed.png）
        const direct = seedImageMap.get(targetId);
        if (direct) return direct;

        // 2. 其次按 ItemInfo.asset_name 命中（如 Crop_3_Seed.png）
        const item = itemInfoMap.get(targetId);
        const assetName = item && item.asset_name ? String(item.asset_name) : '';
        if (assetName) {
            const byAsset = seedAssetImageMap.get(assetName);
            if (byAsset) return byAsset;
        }
        return '';
    };

    // 1. 尝试直接获取
    let img = getImg(id);
    if (img) return img;

    // 2. 如果是果实，尝试获取对应的种子图片
    const plant = getPlantByFruitId(id);
    if (plant && plant.seed_id) {
        img = getImg(plant.seed_id);
        if (img) return img;
    }

    return '';
}

function getItemById(itemId) {
    return itemInfoMap.get(Number(itemId) || 0);
}

function getSeedPrice(seedId) {
    const item = seedItemMap.get(Number(seedId) || 0);
    return item ? (Number(item.price) || 0) : 0;
}

function getFruitPrice(fruitId) {
    const item = itemInfoMap.get(Number(fruitId) || 0);
    return item ? (Number(item.price) || 0) : 0;
}

function getAllPlants() {
    return Array.from(plantMap.values());
}

// 启动时加载配置
loadConfigs();

module.exports = {
    loadConfigs,
    getAllPlants,
    getAllSeeds,
    // 等级经验
    getLevelExpTable,
    getLevelExpProgress,
    // 植物配置
    getPlantById,
    getPlantBySeedId,
    getPlantName,
    getPlantNameBySeedId,
    getPlantGrowTime,
    getPlantExp,
    formatGrowTime,
    // 果实配置
    getFruitName,
    getPlantByFruitId,
    getItemById,
    getItemImageById,
    getSeedPrice,
    getFruitPrice,
    getSeedImageBySeedId,
};
