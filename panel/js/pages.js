
function renderLandCropImage(land) {
    if (!land || !land.seedImage || !land.plantName) return '';
    const alt = String(land.plantName).replace(/"/g, '&quot;');
    return `<img class="land-crop-image" src="${land.seedImage}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`;
}

let matureCountdownTimer = null;
function ensureMatureCountdownTimer() {
    if (matureCountdownTimer) return;
    matureCountdownTimer = setInterval(() => {
        document.querySelectorAll('.mature-countdown').forEach((el) => {
            const cur = Number(el.dataset.remain || 0);
            if (!Number.isFinite(cur) || cur <= 0) return;
            const next = Math.max(0, cur - 1);
            el.dataset.remain = String(next);
            el.textContent = next > 0 ? `${fmtRemainSec(next)}后成熟` : '即将成熟';
        });
    }, 1000);
}

function renderLandPhaseText(landLevel, land) {
    if (landLevel <= 0) return '未解锁';
    const base = String((land && land.phaseName) || '');
    const remain = Number((land && land.matureInSec) || 0);
    if (remain > 0) {
        return `${base} · <span class="mature-countdown" data-remain="${remain}">${fmtRemainSec(remain)}后成熟</span>`;
    }
    return base;
}

// 农场加载
async function loadFarm() {
    if (!currentAccountId) {
        clearFarmView('暂无账号，请先添加或选择账号');
        return;
    }
    const data = await api('/api/lands');
    const grid = $('farm-grid');
    const sum = $('farm-summary');
    
    if (!data || !data.lands) { 
        grid.innerHTML = '<div style="padding:20px;text-align:center;color:#666">无法获取数据，请确保账号已登录</div>'; 
        sum.textContent = ''; 
        return; 
    }

    const statusClass = { locked: 'locked', empty: 'empty', harvestable: 'harvestable', growing: 'growing', dead: 'dead', stealable: 'stealable', harvested: 'empty' };
    grid.innerHTML = data.lands.map(l => {
        let cls = statusClass[l.status] || 'empty';
        if (l.status === 'stealable') cls = 'harvestable'; // 复用样式
        const landLevel = Number(l.level || 0);
        const landLevelClass = `land-level-${Math.max(0, Math.min(4, landLevel))}`;
        const landTypeNameMap = {
            0: '未解锁',
            1: '黄土地',
            2: '红土地',
            3: '黑土地',
            4: '金土地'
        };
        const landTypeName = landTypeNameMap[Math.max(0, Math.min(4, landLevel))] || '土地';
        const phaseText = renderLandPhaseText(landLevel, l);
        
        let needs = [];
        if (l.needWater) needs.push('水');
        if (l.needWeed) needs.push('草');
        if (l.needBug) needs.push('虫');
        return `
            <div class="land-cell ${cls} ${landLevelClass}">
                <span class="id">#${l.id}</span>
                ${renderLandCropImage(l)}
                <span class="plant-name">${l.plantName || '-'}</span>
                <span class="phase-name">${phaseText}</span>
                <span class="land-meta">${landTypeName}</span>
                ${needs.length ? `<span class="needs">${needs.join(' ')}</span>` : ''}
            </div>`;
    }).join('');
    ensureMatureCountdownTimer();
    
    const s = data.summary || {};
    sum.textContent = `可收:${s.harvestable||0} 长:${s.growing||0} 空:${s.empty||0} 枯:${s.dead||0}`;
}

// 好友列表加载
async function loadFriends() {
    if (!currentAccountId) {
        clearFriendsView('暂无账号，请先添加或选择账号');
        return;
    }
    const list = await api('/api/friends');
    const wrap = $('friends-list');
    const summary = $('friend-summary');
    
    if (!list || !list.length) { 
        if (summary) summary.textContent = '共 0 名好友';
        wrap.innerHTML = '<div style="padding:20px;text-align:center;color:#666">暂无好友或数据加载失败</div>'; 
        return; 
    }

    if (summary) summary.textContent = `共 ${list.length} 名好友`;

    wrap.innerHTML = list.map(f => {
        const p = f.plant || {};
        const info = [];
        if (p.stealNum) info.push(`偷${p.stealNum}`);
        if (p.dryNum) info.push(`水${p.dryNum}`);
        if (p.weedNum) info.push(`草${p.weedNum}`);
        if (p.insectNum) info.push(`虫${p.insectNum}`);
        const preview = info.length ? info.join(' ') : '无操作';
        
        return `
            <div class="friend-item">
                <div class="friend-header" onclick="toggleFriend('${f.gid}')">
                    <span class="name">${f.name}</span>
                    <span class="preview ${info.length?'has-work':''}">${preview}</span>
                </div>
                <div class="friend-actions">
                    <button class="btn btn-sm" onclick="friendQuickOp(event, '${f.gid}', 'steal')">一键偷取</button>
                    <button class="btn btn-sm" onclick="friendQuickOp(event, '${f.gid}', 'water')">一键浇水</button>
                    <button class="btn btn-sm" onclick="friendQuickOp(event, '${f.gid}', 'weed')">一键除草</button>
                    <button class="btn btn-sm" onclick="friendQuickOp(event, '${f.gid}', 'bug')">一键除虫</button>
                    <button class="btn btn-sm" onclick="friendQuickOp(event, '${f.gid}', 'bad')">一键捣乱</button>
                </div>
                <div id="friend-lands-${f.gid}" class="friend-lands" style="display:none">
                    <div style="padding:10px;text-align:center;color:#888"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>
                </div>
            </div>
        `;
    }).join('');
}

window.toggleFriend = async (gid) => {
    const el = document.getElementById(`friend-lands-${gid}`);
    if (el.style.display === 'block') {
        el.style.display = 'none';
        return;
    }
    
    // 收起其他
    document.querySelectorAll('.friend-lands').forEach(e => e.style.display = 'none');
    
    el.style.display = 'block';
    
    const data = await api(`/api/friend/${gid}/lands`);
    if (!data || !data.lands) {
        el.innerHTML = '<div style="padding:10px;text-align:center;color:#F44336">加载失败</div>';
        return;
    }
    
    const statusClass = { empty: 'empty', locked: 'empty', stealable: 'harvestable', harvested: 'empty', dead: 'dead', growing: 'growing' };
    const landTypeNameMap = {
        0: '未解锁',
        1: '黄土地',
        2: '红土地',
        3: '黑土地',
        4: '金土地'
    };
    el.innerHTML = `
        <div class="farm-grid mini">
            ${data.lands.map(l => {
                let cls = statusClass[l.status] || 'empty';
                const landLevel = Number(l.level || 0);
                const landLevelClass = `land-level-${Math.max(0, Math.min(4, landLevel))}`;
                const landTypeName = landTypeNameMap[Math.max(0, Math.min(4, landLevel))] || '土地';
                const phaseText = renderLandPhaseText(landLevel, l);
                let needs = [];
                if (l.needWater) needs.push('水');
                if (l.needWeed) needs.push('草');
                if (l.needBug) needs.push('虫');
                return `
                    <div class="land-cell ${cls} ${landLevelClass}">
                        <span class="id">#${l.id}</span>
                        ${renderLandCropImage(l)}
                        <span class="plant-name">${l.plantName || '-'}</span>
                        <span class="phase-name">${phaseText}</span>
                        <span class="land-meta">${landTypeName}</span>
                         ${needs.length ? `<span class="needs">${needs.join(' ')}</span>` : ''}
                    </div>`;
            }).join('')}
        </div>
    `;
    ensureMatureCountdownTimer();
};

window.friendQuickOp = async (event, gid, opType) => {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    if (!currentAccountId) return;
    const opMap = { steal: '偷取', water: '浇水', weed: '除草', bug: '除虫', bad: '捣乱' };
    const btn = event && event.currentTarget ? event.currentTarget : null;
    if (btn) btn.disabled = true;
    try {
        const ret = await api(`/api/friend/${gid}/op`, 'POST', { opType });
        if (!ret) {
            alert(`一键${opMap[opType] || '操作'}失败`);
            return;
        }
        if (ret.message) alert(ret.message);
        const landsEl = document.getElementById(`friend-lands-${gid}`);
        if (landsEl && landsEl.style.display === 'block') {
            landsEl.innerHTML = '<div style="padding:10px;text-align:center;color:#888"><i class="fas fa-spinner fa-spin"></i> 刷新中...</div>';
            const data = await api(`/api/friend/${gid}/lands`);
            if (data && data.lands) {
                const statusClass = { empty: 'empty', locked: 'empty', stealable: 'harvestable', harvested: 'empty', dead: 'dead', growing: 'growing' };
                const landTypeNameMap = { 0: '未解锁', 1: '黄土地', 2: '红土地', 3: '黑土地', 4: '金土地' };
                landsEl.innerHTML = `
                    <div class="farm-grid mini">
                        ${data.lands.map(l => {
                            const cls = statusClass[l.status] || 'empty';
                            const landLevel = Number(l.level || 0);
                            const landLevelClass = `land-level-${Math.max(0, Math.min(4, landLevel))}`;
                            const landTypeName = landTypeNameMap[Math.max(0, Math.min(4, landLevel))] || '土地';
                            const phaseText = renderLandPhaseText(landLevel, l);
                            const needs = [];
                            if (l.needWater) needs.push('水');
                            if (l.needWeed) needs.push('草');
                            if (l.needBug) needs.push('虫');
                            return `
                                <div class="land-cell ${cls} ${landLevelClass}">
                                    <span class="id">#${l.id}</span>
                                    ${renderLandCropImage(l)}
                                    <span class="plant-name">${l.plantName || '-'}</span>
                                    <span class="phase-name">${phaseText}</span>
                                    <span class="land-meta">${landTypeName}</span>
                                    ${needs.length ? `<span class="needs">${needs.join(' ')}</span>` : ''}
                                </div>`;
                        }).join('')}
                    </div>
                `;
                ensureMatureCountdownTimer();
            }
        }
        loadFriends();
    } finally {
        if (btn) btn.disabled = false;
    }
};

// 种子加载
async function loadSeeds(preferredSeed) {
    if (seedLoadPromise) return seedLoadPromise;
    seedLoadPromise = (async () => {
    const list = await api('/api/seeds');
    const sel = $('seed-select');
    sel.innerHTML = '<option value="0">自动选择 (按策略)</option>';
    if (list && list.length) {
        list.forEach(s => {
            const o = document.createElement('option');
            o.value = s.seedId;
            const levelText = (s.requiredLevel === null || s.requiredLevel === undefined) ? 'Lv?' : `Lv${s.requiredLevel}`;
            const priceText = (s.price === null || s.price === undefined) ? '价格未知' : `${s.price}金`;
            let text = `${levelText} ${s.name} (${priceText})`;
            if (s.locked) {
                text += ' [未解锁]';
                o.disabled = true;
                o.style.color = '#666';
            } else if (s.soldOut) {
                text += ' [售罄]';
                o.disabled = true;
                o.style.color = '#666';
            }
            o.textContent = text;
            sel.appendChild(o);
        });
    }
    sel.dataset.loaded = '1';
    if (preferredSeed !== undefined && preferredSeed !== null) {
        const preferredVal = String(preferredSeed || 0);
        if (preferredVal !== '0' && !Array.from(sel.options).some(opt => opt.value === preferredVal)) {
            const fallbackOption = document.createElement('option');
            fallbackOption.value = preferredVal;
            fallbackOption.textContent = `种子${preferredVal} (当前不可购买/详情未知)`;
            sel.appendChild(fallbackOption);
        }
        sel.value = preferredVal;
    }
    })().finally(() => {
        seedLoadPromise = null;
    });
    return seedLoadPromise;
}

function getCurrentLevelFromUi() {
    const raw = String(($('level') && $('level').textContent) || '');
    const m = raw.match(/Lv\s*(\d+)/i);
    return m ? (parseInt(m[1], 10) || 0) : 0;
}

function getStrategySortKey(strategy) {
    const map = {
        max_exp: 'exp',
        max_fert_exp: 'fert',
        max_profit: 'profit',
        max_fert_profit: 'fert_profit',
    };
    return map[String(strategy || '')] || '';
}

function buildSeedOptionText(seed, seedId) {
    if (!seed) return `种子${seedId}`;
    const lv = (seed.requiredLevel === null || seed.requiredLevel === undefined) ? 'Lv?' : `Lv${seed.requiredLevel}`;
    const price = (seed.price === null || seed.price === undefined) ? '价格未知' : `${seed.price}金`;
    return `${lv} ${seed.name} (${price})`;
}

async function resolveStrategySeed(strategy) {
    const list = await api('/api/seeds');
    const seeds = Array.isArray(list) ? list : [];
    const available = seeds.filter(s => !s.locked && !s.soldOut);
    if (!available.length) return null;

    const availableById = new Map(available.map(s => [Number(s.seedId || 0), s]));

    if (strategy === 'level') {
        const sorted = [...available].sort((a, b) => {
            const av = Number(a.requiredLevel || 0);
            const bv = Number(b.requiredLevel || 0);
            if (bv !== av) return bv - av;
            return Number(a.seedId || 0) - Number(b.seedId || 0);
        });
        return sorted[0] || null;
    }

    const sortKey = getStrategySortKey(strategy);
    if (sortKey) {
        const level = getCurrentLevelFromUi();
        const analytics = await api(`/api/analytics?sort=${sortKey}`);
        const ranked = Array.isArray(analytics) ? analytics : [];
        for (const row of ranked) {
            const sid = Number(row && row.seedId) || 0;
            if (sid <= 0) continue;
            const reqLv = Number(row && row.level);
            if (Number.isFinite(reqLv) && reqLv > 0 && level > 0 && reqLv > level) continue;
            const found = availableById.get(sid);
            if (found) return found;
        }
    }

    const fallback = [...available].sort((a, b) => (Number(b.requiredLevel || 0) - Number(a.requiredLevel || 0)));
    return fallback[0] || null;
}

async function refreshSeedSelectByStrategy() {
    const strategy = String(($('strategy-select') && $('strategy-select').value) || 'preferred');
    const sel = $('seed-select');
    if (!sel) return;

    if (strategy === 'preferred') {
        sel.disabled = false;
        if (sel.dataset.loaded !== '1') {
            await loadSeeds(parseInt(sel.value, 10) || 0);
        }
        return;
    }

    sel.disabled = true;
    const matched = await resolveStrategySeed(strategy);
    if (!matched) {
        sel.innerHTML = '<option value="0">当前策略无可用种子</option>';
        sel.value = '0';
        sel.dataset.loaded = 'strategy';
        return;
    }
    const sid = Number(matched.seedId || 0);
    sel.innerHTML = `<option value="${sid}">${buildSeedOptionText(matched, sid)}</option>`;
    sel.value = String(sid);
    sel.dataset.loaded = 'strategy';
}

function markAutomationPending(key) {
    if (!key) return;
    pendingAutomationKeys.add(String(key));
}

// 绑定自动化开关（改为本地待保存，不即时提交）
$('fertilizer-select').addEventListener('change', async () => {
    if (!currentAccountId) return;
    markAutomationPending('fertilizer');
});

['auto-farm', 'auto-farm-push', 'auto-land-upgrade', 'auto-friend', 'auto-task', 'auto-sell', 'auto-friend-steal', 'auto-friend-help', 'auto-friend-bad'].forEach((id, i) => {
    // 这里原来的 id 是数组里的元素，key 需要处理
    // id: auto-farm -> key: farm
    // id: auto-friend-steal -> key: friend_steal
    const key = id.replace('auto-', '').replace(/-/g, '_');
    const el = document.getElementById(id);
    if(el) {
        el.addEventListener('change', async () => {
            if (id === 'auto-friend') {
                updateFriendSubControlsState();
            }
            if (!currentAccountId) return;
            markAutomationPending(key);
        });
    }
});
updateFriendSubControlsState();

$('strategy-select').addEventListener('change', async () => {
    await refreshSeedSelectByStrategy();
});

$('btn-save-settings').addEventListener('click', async () => {
    const strategy = $('strategy-select').value;
    let farmMin = parseInt($('interval-farm-min').value, 10);
    let farmMax = parseInt($('interval-farm-max').value, 10);
    let friendMin = parseInt($('interval-friend-min').value, 10);
    let friendMax = parseInt($('interval-friend-max').value, 10);
    const seedId = parseInt($('seed-select').value) || 0;
    const friendQuietEnabled = !!$('friend-quiet-enabled').checked;
    const friendQuietStart = $('friend-quiet-start').value || '23:00';
    const friendQuietEnd = $('friend-quiet-end').value || '07:00';

    farmMin = Math.max(1, Number.isFinite(farmMin) ? farmMin : 2);
    farmMax = Math.max(1, Number.isFinite(farmMax) ? farmMax : farmMin);
    if (farmMin > farmMax) {
        alert('农场巡查间隔：最大值不能小于最小值');
        $('interval-farm-max').focus();
        return;
    }

    friendMin = Math.max(1, Number.isFinite(friendMin) ? friendMin : 10);
    friendMax = Math.max(1, Number.isFinite(friendMax) ? friendMax : friendMin);
    if (friendMin > friendMax) {
        alert('好友巡查间隔：最大值不能小于最小值');
        $('interval-friend-max').focus();
        return;
    }

    $('interval-farm-min').value = String(farmMin);
    $('interval-farm-max').value = String(farmMax);
    $('interval-friend-min').value = String(friendMin);
    $('interval-friend-max').value = String(friendMax);
    
    const saveBtn = $('btn-save-settings');
    if (saveBtn) saveBtn.disabled = true;
    try {
        const settingsResp = await api('/api/settings/save', 'POST', {
            strategy,
            seedId,
            intervals: {
                farm: farmMin,
                friend: friendMin,
                farmMin,
                farmMax,
                friendMin,
                friendMax,
            },
            friendQuietHours: {
                enabled: friendQuietEnabled,
                start: friendQuietStart,
                end: friendQuietEnd,
            }
        });
        updateRevisionState(settingsResp);

        const automationResp = await api('/api/automation', 'POST', {
            farm: !!$('auto-farm').checked,
            farm_push: !!$('auto-farm-push').checked,
            land_upgrade: !!$('auto-land-upgrade').checked,
            friend: !!$('auto-friend').checked,
            task: !!$('auto-task').checked,
            sell: !!$('auto-sell').checked,
            fertilizer: $('fertilizer-select').value,
            friend_steal: !!$('auto-friend-steal').checked,
            friend_help: !!$('auto-friend-help').checked,
            friend_bad: !!$('auto-friend-bad').checked,
        });
        updateRevisionState(automationResp);
        pendingAutomationKeys.clear();

        await loadSettings();
        alert('设置已保存');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
});

const changeAdminPasswordBtn = document.getElementById('btn-change-admin-password');
if (changeAdminPasswordBtn) {
    changeAdminPasswordBtn.addEventListener('click', async () => {
        const oldPwdEl = $('admin-old-password');
        const newPwdEl = $('admin-new-password');
        const newPwd2El = $('admin-new-password2');
        const oldPwd = oldPwdEl ? oldPwdEl.value : '';
        const newPwd = newPwdEl ? newPwdEl.value : '';
        const newPwd2 = newPwd2El ? newPwd2El.value : '';
        if (!oldPwd) {
            alert('请输入当前管理密码');
            if (oldPwdEl) oldPwdEl.focus();
            return;
        }
        if (!newPwd) {
            alert('请输入新密码');
            if (newPwdEl) newPwdEl.focus();
            return;
        }
        if (newPwd.length < 4) {
            alert('新密码长度至少为 4 位');
            if (newPwdEl) newPwdEl.focus();
            return;
        }
        if (newPwd !== newPwd2) {
            alert('两次输入的新密码不一致');
            if (newPwd2El) newPwd2El.focus();
            return;
        }
        changeAdminPasswordBtn.disabled = true;
        try {
            const r = await fetch(API_ROOT + '/api/admin/change-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-token': adminToken,
                },
                body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
            });
            const j = await r.json().catch(() => null);
            if (!r.ok || !j || !j.ok) {
                const msg = (j && (j.error || j.message)) || '修改失败';
                alert(msg);
                return;
            }
            if (oldPwdEl) oldPwdEl.value = '';
            if (newPwdEl) newPwdEl.value = '';
            if (newPwd2El) newPwd2El.value = '';
            alert('管理密码已更新，请牢记新密码');
        } catch (e) {
            alert('修改失败');
        } finally {
            changeAdminPasswordBtn.disabled = false;
        }
    });
}

// 加载额外设置
async function loadSettings() {
    const data = await api('/api/settings');
    if (data) {
        if (data.strategy) $('strategy-select').value = data.strategy;
        if (data.intervals) {
            const farmBase = Number(data.intervals.farm || 2);
            const friendBase = Number(data.intervals.friend || 10);
            const farmMin = Number(data.intervals.farmMin || farmBase || 2);
            const farmMax = Number(data.intervals.farmMax || farmMin || 2);
            const friendMin = Number(data.intervals.friendMin || friendBase || 10);
            const friendMax = Number(data.intervals.friendMax || friendMin || 10);
            $('interval-farm-min').value = String(farmMin);
            $('interval-farm-max').value = String(farmMax);
            $('interval-friend-min').value = String(friendMin);
            $('interval-friend-max').value = String(friendMax);
        }
        if (data.preferredSeed !== undefined) {
            const sel = $('seed-select');
            if (currentAccountId && sel.dataset.loaded !== '1') {
                await loadSeeds(data.preferredSeed);
            } else {
                sel.value = String(data.preferredSeed || 0);
            }
        }
        if (data.automation && typeof data.automation === 'object') {
            const auto = data.automation;
            $('auto-farm').checked = !!auto.farm;
            $('auto-farm-push').checked = !!auto.farm_push;
            $('auto-land-upgrade').checked = !!auto.land_upgrade;
            $('auto-friend').checked = !!auto.friend;
            $('auto-task').checked = !!auto.task;
            $('auto-sell').checked = !!auto.sell;
            $('auto-friend-steal').checked = !!auto.friend_steal;
            $('auto-friend-help').checked = !!auto.friend_help;
            $('auto-friend-bad').checked = !!auto.friend_bad;
            if (auto.fertilizer) $('fertilizer-select').value = auto.fertilizer;
            updateFriendSubControlsState();
        }
        await refreshSeedSelectByStrategy();
        if (data.friendQuietHours) {
            $('friend-quiet-enabled').checked = !!data.friendQuietHours.enabled;
            $('friend-quiet-start').value = data.friendQuietHours.start || '23:00';
            $('friend-quiet-end').value = data.friendQuietHours.end || '07:00';
        }
        if (data.ui && (data.ui.theme === 'light' || data.ui.theme === 'dark')) {
            localStorage.setItem(THEME_STORAGE_KEY, data.ui.theme);
            applyTheme(data.ui.theme);
        }
        const enabled = !!$('friend-quiet-enabled').checked;
        $('friend-quiet-start').disabled = !enabled;
        $('friend-quiet-end').disabled = !enabled;
    }
}

const friendQuietEnabledEl = document.getElementById('friend-quiet-enabled');
if (friendQuietEnabledEl) {
    friendQuietEnabledEl.addEventListener('change', () => {
        const enabled = !!friendQuietEnabledEl.checked;
        $('friend-quiet-start').disabled = !enabled;
        $('friend-quiet-end').disabled = !enabled;
    });
}

async function loadBag() {
    const listEl = $('bag-list');
    const sumEl = $('bag-summary');
    if (!listEl || !sumEl) return;
    if (!currentAccountId) {
        sumEl.textContent = '请选择账号';
        listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#666">请选择账号后查看背包</div>';
        return;
    }
    sumEl.textContent = '加载中...';
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#888"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
    const data = await api('/api/bag');
    const items = data && Array.isArray(data.items) ? data.items : [];
    // 概览已展示的数据型物品：金币/点券/经验/化肥容器/收藏点
    const hiddenIds = new Set([1, 1001, 1002, 1101, 1011, 1012, 3001, 3002]);
    const displayItems = items.filter(it => !hiddenIds.has(Number(it.id || 0)));

    sumEl.textContent = `共 ${displayItems.length} 种物品`;
    if (!displayItems.length) {
        listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#666">无可展示物品</div>';
        return;
    }
    listEl.innerHTML = displayItems.map(it => `
      <div class="bag-item">
        <div class="thumb-wrap ${it.image ? '' : 'fallback'}">
          ${it.image
            ? `<img class="bag-thumb" src="${escapeHtml(String(it.image))}" alt="${escapeHtml(String(it.name || '物品'))}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'; this.closest('.thumb-wrap').classList.add('fallback')">`
            : ''}
          <span class="bag-thumb-fallback">${escapeHtml(String((it.name || '物').slice(0, 1)))}</span>
        </div>
        <div class="name">${escapeHtml(String(it.name || ('物品' + (it.id || ''))))}</div>
        <div class="meta">ID: ${Number(it.id || 0)}${it.uid ? ` · UID: ${Number(it.uid)}` : ''}</div>
        <div class="meta">类型: ${Number(it.itemType || 0)}${Number(it.level || 0) > 0 ? ` · 等级: ${Number(it.level)}` : ''}${Number(it.price || 0) > 0 ? ` · 价格: ${Number(it.price)}` : ''}</div>
        ${it.hoursText
            ? `<div class="count" style="color:var(--primary)">${escapeHtml(String(it.hoursText))}</div>`
            : `<div class="count">x${Number(it.count || 0)}</div>`}
      </div>
    `).join('');
}

// ============ UI 交互 ============
// 导航切换
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
        e.preventDefault();
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        item.classList.add('active');
        const pageId = 'page-' + item.dataset.page;
        const page = document.getElementById(pageId);
        if (page) page.classList.add('active');
        
        $('page-title').textContent = item.textContent.trim();
        if (item.dataset.page === 'dashboard') renderOpsList(lastOperationsData);
        
        if (item.dataset.page === 'farm') loadFarm();
        if (item.dataset.page === 'bag') loadBag();
        if (item.dataset.page === 'friends') loadFriends();
        if (item.dataset.page === 'analytics') loadAnalytics();
        if (item.dataset.page === 'settings') loadSettings();
        if (item.dataset.page === 'accounts') {
            renderAccountManager();
            pollAccountLogs();
        }
    });
});

// 数据分析
async function loadAnalytics() {
    const container = $('analytics-list');
    if (!container) return;
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#888"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
    
    const sort = $('analytics-sort').value;
    const list = await api(`/api/analytics?sort=${sort}`);
    
    if (!list || !list.length) {
        container.innerHTML = '<div style="padding:24px;text-align:center;color:#666;font-size:16px">暂无数据</div>';
        return;
    }

    // 前端兜底：始终按当前指标倒序显示
    const metricMap = {
        exp: 'expPerHour',
        fert: 'normalFertilizerExpPerHour',
        profit: 'profitPerHour',
        fert_profit: 'normalFertilizerProfitPerHour',
        level: 'level',
    };
    const metric = metricMap[sort];
    if (metric) {
        list.sort((a, b) => {
            const av = Number(a && a[metric]);
            const bv = Number(b && b[metric]);
            if (!Number.isFinite(av) && !Number.isFinite(bv)) return 0;
            if (!Number.isFinite(av)) return 1;
            if (!Number.isFinite(bv)) return -1;
            return bv - av;
        });
    }
    
    // 表格头
    let html = `
    <table style="width:100%;border-collapse:collapse;color:var(--text-main)">
        <thead>
            <tr style="border-bottom:1px solid var(--border);text-align:left;color:var(--text-sub)">
                <th>作物 (Lv)</th>
                <th>时间</th>
                <th>经验/时</th>
                <th>普通肥经验/时</th>
                <th>净利润/时</th>
                <th>普通肥净利润/时</th>
            </tr>
        </thead>
        <tbody>
    `;
    
    list.forEach((item, index) => {
        const lvText = (item.level === null || item.level === undefined || item.level === '' || Number(item.level) < 0)
            ? '未知'
            : String(item.level);
        html += `
            <tr style="border-bottom:1px solid var(--border);">
                <td>
                    <div>${item.name}</div>
                    <div style="font-size:13px;color:var(--text-sub)">Lv${lvText}</div>
                </td>
                <td>${item.growTimeStr}</td>
                <td style="font-weight:bold;color:var(--accent)">${item.expPerHour}</td>
                <td style="font-weight:bold;color:var(--primary)">${item.normalFertilizerExpPerHour ?? '-'}</td>
                <td style="font-weight:bold;color:#f0b84f">${item.profitPerHour ?? '-'}</td>
                <td style="font-weight:bold;color:#74d39a">${item.normalFertilizerProfitPerHour ?? '-'}</td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

$('analytics-sort').addEventListener('change', loadAnalytics);

// 农场操作
window.doFarmOp = async (type) => {
    if (!currentAccountId) return;
    if (confirm('确定执行此操作吗?')) {
        await api('/api/farm/operate', 'POST', { opType: type });
        loadFarm(); // 刷新
    }
};

// 任务列表相关代码已删除

// 账号管理页面
function renderAccountManager() {
    const wrap = $('accounts-list');
    const summary = $('account-summary');
    if (summary) summary.textContent = `共 ${accounts.length} 个账号`;
    wrap.innerHTML = accounts.map(a => `
        <div class="acc-item">
            <div class="name">${a.name}</div>
            <div class="acc-actions">
                ${a.running 
                    ? `<button class="btn acc-btn acc-btn-stop" onclick="stopAccount('${a.id}')">停止</button>`
                    : `<button class="btn btn-primary acc-btn" onclick="startAccount('${a.id}')">启动</button>`
                }
                <button class="btn btn-primary acc-btn" onclick="editAccount('${a.id}')">编辑</button>
                <button class="btn acc-btn acc-btn-danger" onclick="deleteAccount('${a.id}')">删除</button>
            </div>
        </div>
    `).join('');
}

async function pollAccountLogs() {
    return runDedupedRequest('pollAccountLogs', async () => {
        const wrap = $('account-logs-list');
        if (!wrap) return;
        const list = await api('/api/account-logs?limit=100');
        const normalized = Array.isArray(list) ? list : [];
        if (!normalized.length) {
            lastAccountLogsRenderKey = '';
            wrap.innerHTML = '<div class="log-row">暂无账号日志</div>';
            return;
        }
        const renderKey = JSON.stringify(normalized.map(l => [l.time, l.action, l.msg, l.reason || '']));
        if (renderKey === lastAccountLogsRenderKey) return;
        lastAccountLogsRenderKey = renderKey;
        wrap.innerHTML = normalized.slice().reverse().map(l => {
            const actionMap = {
                add: '添加',
                update: '更新',
                delete: '删除',
                kickout_delete: '踢下线删除',
            };
            const action = actionMap[l.action] || l.action || '操作';
            const timeStr = ((l.time || '').split(' ')[1] || (l.time || ''));
            const reason = l.reason ? ` (原因: ${escapeHtml(String(l.reason))})` : '';
            return `<div class="log-row">
                <span class="log-time">${escapeHtml(timeStr)}</span>
                <span class="log-tag">[${action}]</span>
                <span class="log-msg">${escapeHtml(l.msg || '')}${reason}</span>
            </div>`;
        }).join('');
    });
}

window.startAccount = async (id) => {
    await api(`/api/accounts/${id}/start`, 'POST');
    loadAccounts();
    pollAccountLogs();
    setTimeout(loadAccounts, 1000);
};

window.stopAccount = async (id) => {
    await api(`/api/accounts/${id}/stop`, 'POST');
    loadAccounts();
    pollAccountLogs();
    setTimeout(loadAccounts, 1000);
};

// 模态框逻辑
const modal = $('modal-add-acc');
