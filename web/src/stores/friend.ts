import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export const useFriendStore = defineStore('friend', () => {
  const friends = ref<any[]>([])
  const loading = ref(false)
  const friendLands = ref<Record<string, any[]>>({})
  const friendLandsLoading = ref<Record<string, boolean>>({})
  const blacklist = ref<number[]>([])
  const interactRecords = ref<any[]>([])
  const interactLoading = ref(false)
  const interactError = ref('')

  function buildPlantSummaryFromDetail(lands: any[], summary: any) {
    let stealNum = 0
    let dryNum = 0
    let weedNum = 0
    let insectNum = 0

    const detailLands = Array.isArray(lands) ? lands : []
    if (detailLands.length > 0) {
      for (const land of detailLands) {
        if (!land || !land.unlocked)
          continue
        if (land.status === 'stealable')
          stealNum++
        if (land.needWater)
          dryNum++
        if (land.needWeed)
          weedNum++
        if (land.needBug)
          insectNum++
      }
    }
    else {
      stealNum = Array.isArray(summary?.stealable) ? summary.stealable.length : 0
      dryNum = Array.isArray(summary?.needWater) ? summary.needWater.length : 0
      weedNum = Array.isArray(summary?.needWeed) ? summary.needWeed.length : 0
      insectNum = Array.isArray(summary?.needBug) ? summary.needBug.length : 0
    }

    return {
      stealNum: Number(stealNum) || 0,
      dryNum: Number(dryNum) || 0,
      weedNum: Number(weedNum) || 0,
      insectNum: Number(insectNum) || 0,
    }
  }

  function syncFriendPlantSummary(friendId: string, lands: any[], summary: any) {
    const key = String(friendId)
    const idx = friends.value.findIndex(f => String(f?.gid || '') === key)
    if (idx < 0)
      return

    const nextPlant = buildPlantSummaryFromDetail(lands, summary)
    friends.value[idx] = {
      ...friends.value[idx],
      plant: nextPlant,
    }
  }

  async function fetchFriends(accountId: string) {
    if (!accountId)
      return
    loading.value = true
    try {
      const res = await api.get('/api/friends', {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        friends.value = res.data.data || []
      }
    }
    finally {
      loading.value = false
    }
  }

  async function fetchBlacklist(accountId: string) {
    if (!accountId)
      return
    try {
      const res = await api.get('/api/friend-blacklist', {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        blacklist.value = res.data.data || []
      }
    }
    catch { /* ignore */ }
  }

  async function toggleBlacklist(accountId: string, gid: number) {
    if (!accountId || !gid)
      return
    const res = await api.post('/api/friend-blacklist/toggle', { gid }, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data.ok) {
      blacklist.value = res.data.data || []
    }
  }

  async function fetchInteractRecords(accountId: string) {
    if (!accountId)
      return
    interactLoading.value = true
    interactError.value = ''
    interactRecords.value = []

    try {
      const res = await api.get('/api/interact-records', {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        interactRecords.value = Array.isArray(res.data.data) ? res.data.data : []
      }
      else {
        interactError.value = res.data.error || '加载访客记录失败'
      }
    }
    catch (error: any) {
      interactError.value = error?.response?.data?.error || error?.message || '加载访客记录失败'
    }
    finally {
      interactLoading.value = false
    }
  }

  async function fetchFriendLands(accountId: string, friendId: string) {
    if (!accountId || !friendId)
      return
    friendLandsLoading.value[friendId] = true
    try {
      const res = await api.get(`/api/friend/${friendId}/lands`, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        const lands = res.data.data.lands || []
        const summary = res.data.data.summary || null
        friendLands.value[friendId] = lands
        syncFriendPlantSummary(friendId, lands, summary)
      }
    }
    finally {
      friendLandsLoading.value[friendId] = false
    }
  }

  async function operate(accountId: string, friendId: string, opType: string) {
    if (!accountId || !friendId)
      return
    const targetFriendId = String(friendId)
    await api.post(`/api/friend/${friendId}/op`, { opType }, {
      headers: { 'x-account-id': accountId },
    })
    await fetchFriends(accountId)
    await fetchFriendLands(accountId, targetFriendId)
  }

  return {
    friends,
    loading,
    friendLands,
    friendLandsLoading,
    blacklist,
    interactRecords,
    interactLoading,
    interactError,
    fetchFriends,
    fetchBlacklist,
    toggleBlacklist,
    fetchInteractRecords,
    fetchFriendLands,
    operate,
  }
})
