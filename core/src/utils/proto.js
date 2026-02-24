/**
 * Proto 加载与消息类型管理
 */

const protobuf = require('protobufjs')
const { getResourcePath } = require('../config/runtime-paths')
const { log } = require('./utils')

// Proto 根对象与所有消息类型
let root = null
const types = {}

async function loadProto() {
  log('系统', '正在加载 Protobuf 定义...')
  root = new protobuf.Root()
  await root.load([
    getResourcePath('proto', 'game.proto'),
    getResourcePath('proto', 'userpb.proto'),
    getResourcePath('proto', 'plantpb.proto'),
    getResourcePath('proto', 'corepb.proto'),
    getResourcePath('proto', 'shoppb.proto'),
    getResourcePath('proto', 'friendpb.proto'),
    getResourcePath('proto', 'visitpb.proto'),
    getResourcePath('proto', 'notifypb.proto'),
    getResourcePath('proto', 'taskpb.proto'),
    getResourcePath('proto', 'itempb.proto'),
    getResourcePath('proto', 'emailpb.proto'),
    getResourcePath('proto', 'mallpb.proto'),
    getResourcePath('proto', 'qqvippb.proto'),
    getResourcePath('proto', 'sharepb.proto'),
    getResourcePath('proto', 'illustratedpb.proto'),
  ], { keepCase: true })

  // 网关
  types.GateMessage = root.lookupType('gatepb.Message')
  types.GateMeta = root.lookupType('gatepb.Meta')
  types.EventMessage = root.lookupType('gatepb.EventMessage')

  // 用户
  types.LoginRequest = root.lookupType('gamepb.userpb.LoginRequest')
  types.LoginReply = root.lookupType('gamepb.userpb.LoginReply')
  types.HeartbeatRequest = root.lookupType('gamepb.userpb.HeartbeatRequest')
  types.HeartbeatReply = root.lookupType('gamepb.userpb.HeartbeatReply')
  types.ReportArkClickRequest = root.lookupType('gamepb.userpb.ReportArkClickRequest')
  types.ReportArkClickReply = root.lookupType('gamepb.userpb.ReportArkClickReply')

  // 农场
  types.AllLandsRequest = root.lookupType('gamepb.plantpb.AllLandsRequest')
  types.AllLandsReply = root.lookupType('gamepb.plantpb.AllLandsReply')
  types.HarvestRequest = root.lookupType('gamepb.plantpb.HarvestRequest')
  types.HarvestReply = root.lookupType('gamepb.plantpb.HarvestReply')
  types.WaterLandRequest = root.lookupType('gamepb.plantpb.WaterLandRequest')
  types.WaterLandReply = root.lookupType('gamepb.plantpb.WaterLandReply')
  types.WeedOutRequest = root.lookupType('gamepb.plantpb.WeedOutRequest')
  types.WeedOutReply = root.lookupType('gamepb.plantpb.WeedOutReply')
  types.InsecticideRequest = root.lookupType('gamepb.plantpb.InsecticideRequest')
  types.InsecticideReply = root.lookupType('gamepb.plantpb.InsecticideReply')
  types.RemovePlantRequest = root.lookupType('gamepb.plantpb.RemovePlantRequest')
  types.RemovePlantReply = root.lookupType('gamepb.plantpb.RemovePlantReply')
  types.PutInsectsRequest = root.lookupType('gamepb.plantpb.PutInsectsRequest')
  types.PutInsectsReply = root.lookupType('gamepb.plantpb.PutInsectsReply')
  types.PutWeedsRequest = root.lookupType('gamepb.plantpb.PutWeedsRequest')
  types.PutWeedsReply = root.lookupType('gamepb.plantpb.PutWeedsReply')
  types.UpgradeLandRequest = root.lookupType('gamepb.plantpb.UpgradeLandRequest')
  types.UpgradeLandReply = root.lookupType('gamepb.plantpb.UpgradeLandReply')
  types.UnlockLandRequest = root.lookupType('gamepb.plantpb.UnlockLandRequest')
  types.UnlockLandReply = root.lookupType('gamepb.plantpb.UnlockLandReply')
  types.CheckCanOperateRequest = root.lookupType('gamepb.plantpb.CheckCanOperateRequest')
  types.CheckCanOperateReply = root.lookupType('gamepb.plantpb.CheckCanOperateReply')
  types.FertilizeRequest = root.lookupType('gamepb.plantpb.FertilizeRequest')
  types.FertilizeReply = root.lookupType('gamepb.plantpb.FertilizeReply')

  // 背包/仓库
  types.BagRequest = root.lookupType('gamepb.itempb.BagRequest')
  types.BagReply = root.lookupType('gamepb.itempb.BagReply')
  types.SellRequest = root.lookupType('gamepb.itempb.SellRequest')
  types.SellReply = root.lookupType('gamepb.itempb.SellReply')
  types.UseRequest = root.lookupType('gamepb.itempb.UseRequest')
  types.UseReply = root.lookupType('gamepb.itempb.UseReply')
  types.BatchUseRequest = root.lookupType('gamepb.itempb.BatchUseRequest')
  types.BatchUseReply = root.lookupType('gamepb.itempb.BatchUseReply')
  types.PlantRequest = root.lookupType('gamepb.plantpb.PlantRequest')
  types.PlantReply = root.lookupType('gamepb.plantpb.PlantReply')

  // 商店
  types.ShopProfilesRequest = root.lookupType('gamepb.shoppb.ShopProfilesRequest')
  types.ShopProfilesReply = root.lookupType('gamepb.shoppb.ShopProfilesReply')
  types.ShopInfoRequest = root.lookupType('gamepb.shoppb.ShopInfoRequest')
  types.ShopInfoReply = root.lookupType('gamepb.shoppb.ShopInfoReply')
  types.BuyGoodsRequest = root.lookupType('gamepb.shoppb.BuyGoodsRequest')
  types.BuyGoodsReply = root.lookupType('gamepb.shoppb.BuyGoodsReply')
  types.GetMonthCardInfosRequest = root.lookupType('gamepb.mallpb.GetMonthCardInfosRequest')
  types.GetMonthCardInfosReply = root.lookupType('gamepb.mallpb.GetMonthCardInfosReply')
  types.ClaimMonthCardRewardRequest = root.lookupType('gamepb.mallpb.ClaimMonthCardRewardRequest')
  types.ClaimMonthCardRewardReply = root.lookupType('gamepb.mallpb.ClaimMonthCardRewardReply')
  types.GetMallListBySlotTypeRequest = root.lookupType('gamepb.mallpb.GetMallListBySlotTypeRequest')
  types.GetMallListBySlotTypeResponse = root.lookupType('gamepb.mallpb.GetMallListBySlotTypeResponse')
  types.MallGoods = root.lookupType('gamepb.mallpb.MallGoods')
  types.PurchaseRequest = root.lookupType('gamepb.mallpb.PurchaseRequest')
  types.PurchaseResponse = root.lookupType('gamepb.mallpb.PurchaseResponse')
  types.GetDailyGiftStatusRequest = root.lookupType('gamepb.qqvippb.GetDailyGiftStatusRequest')
  types.GetDailyGiftStatusReply = root.lookupType('gamepb.qqvippb.GetDailyGiftStatusReply')
  types.ClaimDailyGiftRequest = root.lookupType('gamepb.qqvippb.ClaimDailyGiftRequest')
  types.ClaimDailyGiftReply = root.lookupType('gamepb.qqvippb.ClaimDailyGiftReply')
  types.CheckCanShareRequest = root.lookupType('gamepb.sharepb.CheckCanShareRequest')
  types.CheckCanShareReply = root.lookupType('gamepb.sharepb.CheckCanShareReply')
  types.ReportShareRequest = root.lookupType('gamepb.sharepb.ReportShareRequest')
  types.ReportShareReply = root.lookupType('gamepb.sharepb.ReportShareReply')
  types.ClaimShareRewardRequest = root.lookupType('gamepb.sharepb.ClaimShareRewardRequest')
  types.ClaimShareRewardReply = root.lookupType('gamepb.sharepb.ClaimShareRewardReply')
  types.GetIllustratedListV2Request = root.lookupType('gamepb.illustratedpb.GetIllustratedListV2Request')
  types.GetIllustratedListV2Reply = root.lookupType('gamepb.illustratedpb.GetIllustratedListV2Reply')
  types.ClaimAllRewardsV2Request = root.lookupType('gamepb.illustratedpb.ClaimAllRewardsV2Request')
  types.ClaimAllRewardsV2Reply = root.lookupType('gamepb.illustratedpb.ClaimAllRewardsV2Reply')

  // 好友
  types.GetAllFriendsRequest = root.lookupType('gamepb.friendpb.GetAllRequest')
  types.GetAllFriendsReply = root.lookupType('gamepb.friendpb.GetAllReply')
  types.GetApplicationsRequest = root.lookupType('gamepb.friendpb.GetApplicationsRequest')
  types.GetApplicationsReply = root.lookupType('gamepb.friendpb.GetApplicationsReply')
  types.AcceptFriendsRequest = root.lookupType('gamepb.friendpb.AcceptFriendsRequest')
  types.AcceptFriendsReply = root.lookupType('gamepb.friendpb.AcceptFriendsReply')

  // 访问
  types.VisitEnterRequest = root.lookupType('gamepb.visitpb.EnterRequest')
  types.VisitEnterReply = root.lookupType('gamepb.visitpb.EnterReply')
  types.VisitLeaveRequest = root.lookupType('gamepb.visitpb.LeaveRequest')
  types.VisitLeaveReply = root.lookupType('gamepb.visitpb.LeaveReply')

  // 任务
  types.TaskInfoRequest = root.lookupType('gamepb.taskpb.TaskInfoRequest')
  types.TaskInfoReply = root.lookupType('gamepb.taskpb.TaskInfoReply')
  types.ClaimTaskRewardRequest = root.lookupType('gamepb.taskpb.ClaimTaskRewardRequest')
  types.ClaimTaskRewardReply = root.lookupType('gamepb.taskpb.ClaimTaskRewardReply')
  types.BatchClaimTaskRewardRequest = root.lookupType('gamepb.taskpb.BatchClaimTaskRewardRequest')
  types.BatchClaimTaskRewardReply = root.lookupType('gamepb.taskpb.BatchClaimTaskRewardReply')
  types.ClaimDailyRewardRequest = root.lookupType('gamepb.taskpb.ClaimDailyRewardRequest')
  types.ClaimDailyRewardReply = root.lookupType('gamepb.taskpb.ClaimDailyRewardReply')

  // 邮箱
  types.GetEmailListRequest = root.lookupType('gamepb.emailpb.GetEmailListRequest')
  types.GetEmailListReply = root.lookupType('gamepb.emailpb.GetEmailListReply')
  types.ClaimEmailRequest = root.lookupType('gamepb.emailpb.ClaimEmailRequest')
  types.ClaimEmailReply = root.lookupType('gamepb.emailpb.ClaimEmailReply')
  types.BatchClaimEmailRequest = root.lookupType('gamepb.emailpb.BatchClaimEmailRequest')
  types.BatchClaimEmailReply = root.lookupType('gamepb.emailpb.BatchClaimEmailReply')

  // 服务器推送通知
  types.LandsNotify = root.lookupType('gamepb.plantpb.LandsNotify')
  types.BasicNotify = root.lookupType('gamepb.userpb.BasicNotify')
  types.KickoutNotify = root.lookupType('gatepb.KickoutNotify')
  types.FriendApplicationReceivedNotify = root.lookupType('gamepb.friendpb.FriendApplicationReceivedNotify')
  types.FriendAddedNotify = root.lookupType('gamepb.friendpb.FriendAddedNotify')
  types.ItemNotify = root.lookupType('gamepb.itempb.ItemNotify')
  types.GoodsUnlockNotify = root.lookupType('gamepb.shoppb.GoodsUnlockNotify')
  types.TaskInfoNotify = root.lookupType('gamepb.taskpb.TaskInfoNotify')

  // Proto 加载完成
  log('系统', 'Protobuf 定义加载完成')
}

function getRoot() {
  return root
}

module.exports = { loadProto, types, getRoot }
