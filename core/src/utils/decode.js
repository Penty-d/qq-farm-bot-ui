/**
 * 解码/验证工具模式
 */

const { Buffer } = require('node:buffer')
const Long = require('long')
const protobuf = require('protobufjs')
const { PHASE_NAMES } = require('../config/config')
const { types, getRoot } = require('./proto')
const { toNum } = require('./utils')

// ============ 辅助函数 ============

/** JSON.stringify replacer, 处理 Long 和 Buffer */
function longReplacer(key, value) {
  if (value && typeof value === 'object' && value.low !== undefined && value.high !== undefined) {
    return Long.fromBits(value.low, value.high, value.unsigned).toString()
  }
  if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
    return `<${value.data.length} bytes>`
  }
  return value
}

/** 尝试将 bytes 解码为 UTF-8 字符串 */
function tryDecodeString(bytes) {
  try {
    const str = Buffer.from(bytes).toString('utf8')
    const printable = str.split('').filter(c => c.charCodeAt(0) >= 32 || c === '\n' || c === '\r' || c === '\t').length
    if (printable > str.length * 0.8 && str.length > 0)
      return str
  }
  catch (e) { }
  return null
}

/** 通用 protobuf 解码 (无 schema, 显示原始字段) */
function tryGenericDecode(buf) {
  console.log('=== 通用 protobuf 解码 (无schema) ===')
  try {
    const reader = protobuf.Reader.create(buf)
    while (reader.pos < reader.len) {
      const tag = reader.uint32()
      const fieldNum = tag >>> 3
      const wireType = tag & 7
      let value
      switch (wireType) {
        case 0: value = reader.int64().toString(); console.log(`  field ${fieldNum} (varint): ${value}`); break
        case 1: value = reader.fixed64().toString(); console.log(`  field ${fieldNum} (fixed64): ${value}`); break
        case 2: {
          const bytes = reader.bytes()
          const str = tryDecodeString(bytes)
          if (str !== null) {
            console.log(`  field ${fieldNum} (bytes/${bytes.length}): "${str}"`)
          }
          else {
            console.log(`  field ${fieldNum} (bytes/${bytes.length}): ${Buffer.from(bytes).toString('hex')}`)
          }
          break
        }
        case 5: value = reader.float(); console.log(`  field ${fieldNum} (float): ${value}`); break
        default: console.log(`  field ${fieldNum} (wire ${wireType}): <skip>`); reader.skipType(wireType); break
      }
    }
  }
  catch (e) {
    console.log(`  解码中断: ${e.message}`)
  }
}

// ============ 验证模式 ============

async function verifyMode() {
  console.log('\n====== 验证模式 ======\n')

  // Login Request
  const loginB64 = 'CigKGWdhbWVwYi51c2VycGIuVXNlclNlcnZpY2USBUxvZ2luGAEgASgAEmEYACIAKjwKEDEuNi4wLjhfMjAyNTEyMjQSE1dpbmRvd3MgVW5rbm93biB4NjQqBHdpZmlQzL0BagltaWNyb3NvZnQwADoEMTI1NkIVCgASABoAIgAqBW90aGVyMAI6AEIA'
  try {
    const msg = types.GateMessage.decode(Buffer.from(loginB64, 'base64'))
    console.log(`[OK] Login Request: ${msg.meta.service_name}.${msg.meta.method_name} seq=${msg.meta.client_seq}`)
    const req = types.LoginRequest.decode(msg.body)
    console.log(`     device=${req.device_info?.client_version} scene=${req.scene_id}`)
  }
  catch (e) { console.log(`[FAIL] Login Request: ${e.message}`) }

  // AllLands Response
  const allLandsB64 = 'ClwKG2dhbWVwYi5wbGFudHBiLlBsYW50U2VydmljZRIIQWxsTGFuZHMYAiAEKARCLQoJeC10cmFjZWlkEiBhOWZhNmZhZmYwZmI0ZDU5ZjQ5ZDJiZTJlYTY2NGU3NBK7BwpMCAEQARgBIARCDQgSEBwaBwjpBxDAmgxKAFIuCOOgPhIJ6IOh6JCd5Y2cIgoIBhCNu5rMBhgTKAFQw7gCWAp4eIABAYgBAZABCoABAQpMCAIQARgBIARCDQgSEB0aBwjpBxCQoQ9KAFIuCOOgPhIJ6IOh6JCd5Y2cIgoIBhCOu5rMBhgTKAFQw7gCWAp4eIABAYgBAZABCoABAQpMCAMQARgBIARCDQgSEB4aBwjpBxDgpxJKAFIuCOOgPhIJ6IOh6JCd5Y2cIgoIBhCOu5rMBhgTKAFQw7gCWAp4eIABAYgBAZABCoABAQpMCAQQARgBIARCDQgSEB8aBwjpBxCwrhVKAFIuCOOgPhIJ6IOh6JCd5Y2cIgoIBhCOu5rMBhgTKAFQw7gCWAp4eIABAYgBAZABCoABAQpMCAUQARgBIARCDQgSECAaBwjpBxCAtRhKAFIuCOOgPhIJ6IOh6JCd5Y2cIgoIBhCNu5rMBhgTKAFQw7gCWAp4eIABAYgBAZABCoABAQpMCAYQARgBIARCDQgSECEaBwjpBxCgwh5KAFIuCOOgPhIJ6IOh6JCd5Y2cIgoIBhCOu5rMBhgTKAFQw7gCWAp4eIABAYgBAZABCoABAQoPCAcgBDoHCAYQBRiIJ2ABCg8ICCAEOgcIBxAHGJBOYAEKEAgJIAQ6CAgIEAkYoJwBYAEKDggKIAQ6CAgJEAsYsOoBCg4ICyAEOggIChANGMC4AgoOCAwgBDoICAsQDxjg1AMKDggNIAQ6CAgMEBEYgPEECg4IDiAEOggIDRATGKCNBgoOCA8gBDoICA4QFRjAqQcKDggQIAQ6CAgPEBcY4MUICg4IESAEOggIEBAZGIDiCQoOCBIgBDoICBEQGxig/goKDggTIAQ6CAgSEB0YwJoMCg4IFCAEOggIExAfGOC2DQoOCBUgBDoICBQQIRiA0w4KDggWIAQ6CAgVECMYoO8PCg4IFyAEOggIFhAlGMCLEQoOCBggBDoICBcQJxjgpxISCQicThj/k+vcAxIJCJ1OGP+T69wDEgkInk4Y/5Pr3AMSCwiRThAJGP+T69wDEg0IlE4YZCCTTihkOJNOEhAIlU4QBxj/k+vcAygXOJVOEhAIlk4QCxj/k+vcAygLOJVOEhAIl04QBRj/k+vcAygFOJVOEgkImE4Y/5Pr3AMSDQiZThAMGP+T69wDKAwSCwiaThABGP+T69wDEg0Ikk4QCRj/k+vcAygJEg0Ik04YZCCTTihkOJNOEgkIm04Y/5Pr3AM='
  try {
    const msg = types.GateMessage.decode(Buffer.from(allLandsB64, 'base64'))
    const reply = types.AllLandsReply.decode(msg.body)
    console.log(`[OK] AllLands Reply: ${reply.lands.length} 块土地`)
    for (const land of reply.lands.slice(0, 3)) {
      const id = toNum(land.id)
      const unlocked = land.unlocked
      const plantName = land.plant?.name || '空'
      const phases = land.plant?.phases || []
      const lastPhase = phases.length > 0 ? phases[phases.length - 1].phase : -1
      console.log(`     土地#${id}: ${unlocked ? '已解锁' : '未解锁'} 植物=${plantName} 阶段=${PHASE_NAMES[lastPhase] || lastPhase}`)
    }
    if (reply.lands.length > 3)
      console.log(`     ... 还有 ${reply.lands.length - 3} 块`)
  }
  catch (e) { console.log(`[FAIL] AllLands Reply: ${e.message}`) }

  // Harvest Request
  const harvestB64 = 'CiwKG2dhbWVwYi5wbGFudHBiLlBsYW50U2VydmljZRIHSGFydmVzdBgBIBsoGhIQCgYBAgMEBQYQyOHR8gMYAQ=='
  try {
    const msg = types.GateMessage.decode(Buffer.from(harvestB64, 'base64'))
    const req = types.HarvestRequest.decode(msg.body)
    console.log(`[OK] Harvest Request: land_ids=[${req.land_ids.join(',')}] host_gid=${req.host_gid} is_all=${req.is_all}`)
  }
  catch (e) { console.log(`[FAIL] Harvest Request: ${e.message}`) }

  console.log('\n====== 验证完成 ======\n')
}

// ============ 解码模式 ============

async function decodeMode(args) {
  let inputData = ''
  let typeName = ''
  let isHex = false
  let isGateWrapped = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--decode')
      continue
    if (args[i] === '--type' && args[i + 1]) { typeName = args[++i]; continue }
    if (args[i] === '--hex') { isHex = true; continue }
    if (args[i] === '--gate') { isGateWrapped = true; continue }
    if (!inputData)
      inputData = args[i]
  }

  if (!inputData) {
    console.log(`
PB数据解码工具
==============

用法:
  node client.js --decode <base64数据>
  node client.js --decode <hex数据> --hex
  node client.js --decode <base64数据> --type <消息类型>
  node client.js --decode <base64数据> --gate

参数:
  <数据>       base64编码的pb数据 (默认), 或hex编码 (配合 --hex)
  --hex       输入数据为hex编码
  --gate      外层是 gatepb.Message 包装, 自动解析 meta + body
  --type      指定消息类型, 如: gatepb.Message, gamepb.plantpb.AllLandsReply 等

可用类型:
  gatepb.Message / gatepb.Meta
  gamepb.userpb.LoginRequest / LoginReply / HeartbeatRequest / HeartbeatReply
  gamepb.plantpb.AllLandsRequest / AllLandsReply / HarvestRequest / HarvestReply
  gamepb.plantpb.WaterLandRequest / WeedOutRequest / InsecticideRequest
  gamepb.plantpb.PlantRequest / PlantReply / RemovePlantRequest / RemovePlantReply
  gamepb.shoppb.ShopInfoRequest / ShopInfoReply / BuyGoodsRequest / BuyGoodsReply
  gamepb.friendpb.GetAllRequest / GetAllReply / GameFriend

示例:
  node client.js --decode CigKGWdhbWVwYi... --gate
  node client.js --decode 0a1c0a19... --hex --type gatepb.Message
`)
    return
  }

  const root = getRoot()
  let buf
  try {
    buf = isHex ? Buffer.from(inputData, 'hex') : Buffer.from(inputData, 'base64')
  }
  catch (e) {
    console.error(`输入数据解码失败: ${e.message}`)
    return
  }
  console.log(`数据长度: ${buf.length} 字节\n`)

  // --gate: 先解析外层 gatepb.Message
  if (isGateWrapped) {
    try {
      const msg = types.GateMessage.decode(buf)
      const meta = msg.meta
      console.log('=== gatepb.Message (外层) ===')
      console.log(`  service:     ${meta.service_name}`)
      console.log(`  method:      ${meta.method_name}`)
      console.log(`  type:        ${meta.message_type} (${meta.message_type === 1 ? 'Request' : meta.message_type === 2 ? 'Response' : 'Notify'})`)
      console.log(`  client_seq:  ${meta.client_seq}`)
      console.log(`  server_seq:  ${meta.server_seq}`)
      if (toNum(meta.error_code) !== 0) {
        console.log(`  error_code:  ${meta.error_code}`)
        console.log(`  error_msg:   ${meta.error_message}`)
      }
      console.log('')

      if (msg.body && msg.body.length > 0) {
        const svc = meta.service_name || ''
        const mtd = meta.method_name || ''
        const isReq = meta.message_type === 1
        const suffix = isReq ? 'Request' : 'Reply'
        const autoType = `${svc.replace('Service', '')}.${mtd}${suffix}`

        let bodyType = null
        try { bodyType = root.lookupType(autoType) }
        catch (e) { }
        if (!bodyType) {
          const parts = svc.split('.')
          if (parts.length >= 2) {
            const ns = parts.slice(0, parts.length - 1).join('.')
            try { bodyType = root.lookupType(`${ns}.${mtd}${suffix}`) }
            catch (e) { }
          }
        }

        if (bodyType) {
          console.log(`=== ${bodyType.fullName} (body 自动推断) ===`)
          const decoded = bodyType.decode(msg.body)
          console.log(JSON.stringify(decoded.toJSON(), longReplacer, 2))
        }
        else {
          console.log(`=== body (未能自动推断类型, 用 --type 手动指定 body 类型) ===`)
          console.log(`  hex: ${Buffer.from(msg.body).toString('hex')}`)
          console.log(`  base64: ${Buffer.from(msg.body).toString('base64')}`)
          tryGenericDecode(msg.body)
        }
      }
    }
    catch (e) {
      console.error(`gatepb.Message 解码失败: ${e.message}`)
    }
    return
  }

  // --type: 指定类型解码
  if (typeName) {
    try {
      const msgType = root.lookupType(typeName)
      const decoded = msgType.decode(buf)
      console.log(`=== ${typeName} ===`)
      console.log(JSON.stringify(decoded.toJSON(), longReplacer, 2))
    }
    catch (e) {
      console.error(`解码失败 (${typeName}): ${e.message}`)
    }
    return
  }

  // 未指定类型，自动尝试
  console.log('未指定类型，自动尝试...\n')
  try {
    const msg = types.GateMessage.decode(buf)
    if (msg.meta && (msg.meta.service_name || msg.meta.method_name)) {
      console.log('=== 检测为 gatepb.Message ===')
      console.log(JSON.stringify(msg.toJSON(), longReplacer, 2))
      return
    }
  }
  catch (e) { }

  tryGenericDecode(buf)
}

module.exports = { verifyMode, decodeMode }
