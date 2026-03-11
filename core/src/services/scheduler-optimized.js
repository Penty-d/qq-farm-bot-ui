/**
 * 定时任务调度器 - 优化版
 * 使用时间轮算法提高大量任务的调度效率
 */

const { createModuleLogger } = require('./logger');

const logger = createModuleLogger('scheduler-optimized');

// 默认配置
const DEFAULT_CONFIG = {
    tickMs: 100,          // 时钟滴答间隔 (ms)
    wheelSize: 60,        // 时间轮大小
    maxDelay: 86400000,   // 最大延迟 (24小时)
    enableStats: true,    // 启用统计
};

// 时间轮任务节点
class TimerNode {
    constructor(taskName, delayMs, taskFn, options = {}) {
        this.taskName = taskName;
        this.delayMs = delayMs;
        this.taskFn = taskFn;
        this.options = {
            preventOverlap: options.preventOverlap !== false,
            runImmediately: options.runImmediately || false,
            ...options,
        };
        
        this.executeAt = Date.now() + delayMs;
        this.runCount = 0;
        this.lastRunAt = 0;
        this.running = false;
        this.next = null;
    }
}

// 时间轮
class TimeWheel {
    constructor(size) {
        this.size = size;
        this.buckets = Array.from({ length: size }, () => []);
        this.currentIndex = 0;
    }

    // 添加任务
    add(node) {
        const index = this.calculateIndex(node.executeAt);
        this.buckets[index].push(node);
    }

    // 计算索引
    calculateIndex(executeAt) {
        const tick = Math.floor(executeAt / 100) % this.size;
        return tick;
    }

    // 获取当前时间轮槽中的任务
    getCurrentTasks() {
        const tasks = this.buckets[this.currentIndex];
        this.buckets[this.currentIndex] = [];
        return tasks;
    }

    // 推进时间轮
    tick() {
        this.currentIndex = (this.currentIndex + 1) % this.size;
    }

    // 获取等待任务数
    getPendingCount() {
        return this.buckets.reduce((sum, bucket) => sum + bucket.length, 0);
    }
}

// 优化调度器
class OptimizedScheduler {
    constructor(namespace = 'default', config = {}) {
        this.name = namespace;
        this.config = { ...DEFAULT_CONFIG, ...config };
        
        this.timers = new Map();           // 命名定时器
        this.timeWheel = new TimeWheel(this.config.wheelSize);
        
        this.tickTimer = null;
        this.running = false;
        
        // 统计
        this.stats = {
            totalTasksRun: 0,
            totalTasksAdded: 0,
            totalTasksCancelled: 0,
            lastTickAt: 0,
            maxPendingTasks: 0,
        };
    }

    // 启动调度器
    start() {
        if (this.running) return;
        
        this.running = true;
        this.tickTimer = setInterval(() => this.tick(), this.config.tickMs);
        logger.info('优化调度器已启动', { namespace: this.name, tickMs: this.config.tickMs });
    }

    // 停止调度器
    stop() {
        if (!this.running) return;
        
        this.running = false;
        if (this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
        
        // 清除所有任务
        this.timers.clear();
        
        logger.info('优化调度器已停止', { namespace: this.name });
    }

    // 时钟滴答
    tick() {
        if (!this.running) return;
        
        this.stats.lastTickAt = Date.now();
        
        // 执行当前时间槽的任务
        const tasks = this.timeWheel.getCurrentTasks();
        
        for (const node of tasks) {
            this.executeTask(node);
        }
        
        // 推进时间轮
        this.timeWheel.tick();
        
        // 更新统计
        const pending = this.timeWheel.getPendingCount();
        if (pending > this.stats.maxPendingTasks) {
            this.stats.maxPendingTasks = pending;
        }
    }

    // 执行任务
    async executeTask(node) {
        const { taskName, taskFn, options } = node;
        
        // 防重入检查
        if (options.preventOverlap && node.running) {
            logger.debug('任务正在运行，跳过', { taskName });
            // 重新调度
            this.scheduleTask(node);
            return;
        }

        node.running = true;
        node.runCount++;
        node.lastRunAt = Date.now();
        
        try {
            await taskFn();
            this.stats.totalTasksRun++;
        } catch (error) {
            logger.error(`[${this.name}] 任务执行失败: ${taskName}`, { 
                error: error.message,
                runCount: node.runCount,
            });
        } finally {
            node.running = false;
        }
    }

    // 调度任务
    scheduleTask(node) {
        const now = Date.now();
        const remaining = node.executeAt - now;
        
        if (remaining <= 0) {
            // 立即执行
            this.executeTask(node);
        } else if (remaining <= this.config.maxDelay) {
            // 加入时间轮
            node.executeAt = now + remaining;
            this.timeWheel.add(node);
        } else {
            // 延迟过长，使用setTimeout
            this.scheduleLongDelayTask(node);
        }
    }

    // 调度长延迟任务
    scheduleLongDelayTask(node) {
        const delay = node.delayMs;
        
        const timer = setTimeout(() => {
            this.timers.delete(node.taskName);
            this.executeTask(node);
        }, delay);
        
        this.timers.set(node.taskName, timer);
    }

    // 设置延时任务
    setTimeoutTask(taskName, delayMs, taskFn, options = {}) {
        this.clear(taskName);
        
        if (delayMs <= 0) {
            // 立即执行
            this.executeTask(new TimerNode(taskName, 0, taskFn, options));
            return;
        }
        
        const node = new TimerNode(taskName, delayMs, taskFn, options);
        this.stats.totalTasksAdded++;
        
        if (delayMs <= this.config.maxDelay) {
            this.timeWheel.add(node);
        } else {
            this.scheduleLongDelayTask(node);
        }
        
        return node;
    }

    // 设置间隔任务
    setIntervalTask(taskName, intervalMs, taskFn, options = {}) {
        const { runImmediately } = options;
        
        // 立即执行
        if (runImmediately) {
            Promise.resolve().then(taskFn).catch(() => null);
        }
        
        // 创建循环执行的任务
        const intervalTask = () => {
            const wrapper = async () => {
                await taskFn();
                
                // 重新调度
                if (this.running) {
                    this.setIntervalTask(taskName, intervalMs, taskFn, { 
                        ...options, 
                        runImmediately: false 
                    });
                }
            };
            
            this.setTimeoutTask(taskName, intervalMs, wrapper, {
                ...options,
                runImmediately: false,
            });
        };
        
        return this.setTimeoutTask(taskName, intervalMs, intervalTask, options);
    }

    // 清除任务
    clear(taskName) {
        const timer = this.timers.get(taskName);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(taskName);
            this.stats.totalTasksCancelled++;
        }
        
        // 从时间轮中移除 (需要遍历)
        for (const bucket of this.timeWheel.buckets) {
            const index = bucket.findIndex(n => n.taskName === taskName);
            if (index !== -1) {
                bucket.splice(index, 1);
                this.stats.totalTasksCancelled++;
                break;
            }
        }
    }

    // 清除所有任务
    clearAll() {
        // 清除setTimeout任务
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        
        // 清空时间轮
        for (let i = 0; i < this.timeWheel.size; i++) {
            this.timeWheel.buckets[i] = [];
        }
        
        this.stats.totalTasksCancelled += this.timeWheel.getPendingCount();
    }

    // 检查任务是否存在
    has(taskName) {
        if (this.timers.has(taskName)) return true;
        
        for (const bucket of this.timeWheel.buckets) {
            if (bucket.some(n => n.taskName === taskName)) {
                return true;
            }
        }
        
        return false;
    }

    // 获取任务名称列表
    getTaskNames() {
        const names = [...this.timers.keys()];
        
        for (const bucket of this.timeWheel.buckets) {
            for (const node of bucket) {
                names.push(node.taskName);
            }
        }
        
        return names;
    }

    // 获取快照
    getSnapshot() {
        return {
            namespace: this.name,
            running: this.running,
            pendingCount: this.timeWheel.getPendingCount(),
            timerCount: this.timers.size,
            stats: { ...this.stats },
            tasks: this.getTaskNames().slice(0, 20), // 只返回前20个
        };
    }

    // 获取统计信息
    getStats() {
        return {
            ...this.stats,
            pendingTasks: this.timeWheel.getPendingCount(),
            activeTimers: this.timers.size,
        };
    }
}

// 全局调度器缓存
const schedulerCache = new Map();

/**
 * 创建优化调度器
 */
function createOptimizedScheduler(namespace, config) {
    if (schedulerCache.has(namespace)) {
        return schedulerCache.get(namespace);
    }
    
    const scheduler = new OptimizedScheduler(namespace, config);
    scheduler.start();
    schedulerCache.set(namespace, scheduler);
    
    return scheduler;
}

/**
 * 获取优化调度器
 */
function getOptimizedScheduler(namespace) {
    return schedulerCache.get(namespace);
}

/**
 * 停止所有优化调度器
 */
function stopAllOptimizedSchedulers() {
    for (const scheduler of schedulerCache.values()) {
        scheduler.stop();
    }
    schedulerCache.clear();
}

// 导出
module.exports = {
    OptimizedScheduler,
    TimeWheel,
    TimerNode,
    createOptimizedScheduler,
    getOptimizedScheduler,
    stopAllOptimizedSchedulers,
    DEFAULT_CONFIG,
};
