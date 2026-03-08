/**
 * Proto 加载与消息类型管理
 */

const protobuf = require('protobufjs');
const fs = require('node:fs');
const path = require('node:path');
const { log } = require('./utils');

let root = null;
const types = {};

// Proto 文件所在目录
const PROTO_DIR = path.dirname(require.resolve('../proto/game.proto'));

const typeMappings = [
    // 网关
    ['GateMessage', 'gatepb.Message'],
    ['GateMeta', 'gatepb.Meta'],
    ['EventMessage', 'gatepb.EventMessage'],
    // 用户
    ['LoginRequest', 'gamepb.userpb.LoginRequest'],
    ['LoginReply', 'gamepb.userpb.LoginReply'],
    ['HeartbeatRequest', 'gamepb.userpb.HeartbeatRequest'],
    ['HeartbeatReply', 'gamepb.userpb.HeartbeatReply'],
    ['ReportArkClickRequest', 'gamepb.userpb.ReportArkClickRequest'],
    ['ReportArkClickReply', 'gamepb.userpb.ReportArkClickReply'],
    ['BasicNotify', 'gamepb.userpb.BasicNotify'],
    // 农场
    ['AllLandsRequest', 'gamepb.plantpb.AllLandsRequest'],
    ['AllLandsReply', 'gamepb.plantpb.AllLandsReply'],
    ['HarvestRequest', 'gamepb.plantpb.HarvestRequest'],
    ['HarvestReply', 'gamepb.plantpb.HarvestReply'],
    ['WaterLandRequest', 'gamepb.plantpb.WaterLandRequest'],
    ['WaterLandReply', 'gamepb.plantpb.WaterLandReply'],
    ['WeedOutRequest', 'gamepb.plantpb.WeedOutRequest'],
    ['WeedOutReply', 'gamepb.plantpb.WeedOutReply'],
    ['InsecticideRequest', 'gamepb.plantpb.InsecticideRequest'],
    ['InsecticideReply', 'gamepb.plantpb.InsecticideReply'],
    ['RemovePlantRequest', 'gamepb.plantpb.RemovePlantRequest'],
    ['RemovePlantReply', 'gamepb.plantpb.RemovePlantReply'],
    ['PutInsectsRequest', 'gamepb.plantpb.PutInsectsRequest'],
    ['PutInsectsReply', 'gamepb.plantpb.PutInsectsReply'],
    ['PutWeedsRequest', 'gamepb.plantpb.PutWeedsRequest'],
    ['PutWeedsReply', 'gamepb.plantpb.PutWeedsReply'],
    ['UpgradeLandRequest', 'gamepb.plantpb.UpgradeLandRequest'],
    ['UpgradeLandReply', 'gamepb.plantpb.UpgradeLandReply'],
    ['UnlockLandRequest', 'gamepb.plantpb.UnlockLandRequest'],
    ['UnlockLandReply', 'gamepb.plantpb.UnlockLandReply'],
    ['CheckCanOperateRequest', 'gamepb.plantpb.CheckCanOperateRequest'],
    ['CheckCanOperateReply', 'gamepb.plantpb.CheckCanOperateReply'],
    ['FertilizeRequest', 'gamepb.plantpb.FertilizeRequest'],
    ['FertilizeReply', 'gamepb.plantpb.FertilizeReply'],
    ['PlantRequest', 'gamepb.plantpb.PlantRequest'],
    ['PlantReply', 'gamepb.plantpb.PlantReply'],
    ['LandsNotify', 'gamepb.plantpb.LandsNotify'],
    // 背包/仓库
    ['BagRequest', 'gamepb.itempb.BagRequest'],
    ['BagReply', 'gamepb.itempb.BagReply'],
    ['SellRequest', 'gamepb.itempb.SellRequest'],
    ['SellReply', 'gamepb.itempb.SellReply'],
    ['UseRequest', 'gamepb.itempb.UseRequest'],
    ['UseReply', 'gamepb.itempb.UseReply'],
    ['BatchUseRequest', 'gamepb.itempb.BatchUseRequest'],
    ['BatchUseReply', 'gamepb.itempb.BatchUseReply'],
    ['ItemNotify', 'gamepb.itempb.ItemNotify'],
    // 商店
    ['ShopProfilesRequest', 'gamepb.shoppb.ShopProfilesRequest'],
    ['ShopProfilesReply', 'gamepb.shoppb.ShopProfilesReply'],
    ['ShopInfoRequest', 'gamepb.shoppb.ShopInfoRequest'],
    ['ShopInfoReply', 'gamepb.shoppb.ShopInfoReply'],
    ['BuyGoodsRequest', 'gamepb.shoppb.BuyGoodsRequest'],
    ['BuyGoodsReply', 'gamepb.shoppb.BuyGoodsReply'],
    ['GoodsUnlockNotify', 'gamepb.shoppb.GoodsUnlockNotify'],
    // 商城
    ['GetMonthCardInfosRequest', 'gamepb.mallpb.GetMonthCardInfosRequest'],
    ['GetMonthCardInfosReply', 'gamepb.mallpb.GetMonthCardInfosReply'],
    ['ClaimMonthCardRewardRequest', 'gamepb.mallpb.ClaimMonthCardRewardRequest'],
    ['ClaimMonthCardRewardReply', 'gamepb.mallpb.ClaimMonthCardRewardReply'],
    ['GetTodayClaimStatusRequest', 'gamepb.redpacketpb.GetTodayClaimStatusRequest'],
    ['GetTodayClaimStatusReply', 'gamepb.redpacketpb.GetTodayClaimStatusReply'],
    ['ClaimRedPacketRequest', 'gamepb.redpacketpb.ClaimRedPacketRequest'],
    ['ClaimRedPacketReply', 'gamepb.redpacketpb.ClaimRedPacketReply'],
    ['GetMallListBySlotTypeRequest', 'gamepb.mallpb.GetMallListBySlotTypeRequest'],
    ['GetMallListBySlotTypeResponse', 'gamepb.mallpb.GetMallListBySlotTypeResponse'],
    ['MallGoods', 'gamepb.mallpb.MallGoods'],
    ['PurchaseRequest', 'gamepb.mallpb.PurchaseRequest'],
    ['PurchaseResponse', 'gamepb.mallpb.PurchaseResponse'],
    // QQ会员
    ['GetDailyGiftStatusRequest', 'gamepb.qqvippb.GetDailyGiftStatusRequest'],
    ['GetDailyGiftStatusReply', 'gamepb.qqvippb.GetDailyGiftStatusReply'],
    ['ClaimDailyGiftRequest', 'gamepb.qqvippb.ClaimDailyGiftRequest'],
    ['ClaimDailyGiftReply', 'gamepb.qqvippb.ClaimDailyGiftReply'],
    // 分享
    ['CheckCanShareRequest', 'gamepb.sharepb.CheckCanShareRequest'],
    ['CheckCanShareReply', 'gamepb.sharepb.CheckCanShareReply'],
    ['ReportShareRequest', 'gamepb.sharepb.ReportShareRequest'],
    ['ReportShareReply', 'gamepb.sharepb.ReportShareReply'],
    ['ClaimShareRewardRequest', 'gamepb.sharepb.ClaimShareRewardRequest'],
    ['ClaimShareRewardReply', 'gamepb.sharepb.ClaimShareRewardReply'],
    // 图鉴
    ['GetIllustratedListV2Request', 'gamepb.illustratedpb.GetIllustratedListV2Request'],
    ['GetIllustratedListV2Reply', 'gamepb.illustratedpb.GetIllustratedListV2Reply'],
    ['ClaimAllRewardsV2Request', 'gamepb.illustratedpb.ClaimAllRewardsV2Request'],
    ['ClaimAllRewardsV2Reply', 'gamepb.illustratedpb.ClaimAllRewardsV2Reply'],
    // 好友
    ['GetAllFriendsRequest', 'gamepb.friendpb.GetAllRequest'],
    ['GetAllFriendsReply', 'gamepb.friendpb.GetAllReply'],
    ['SyncAllRequest', 'gamepb.friendpb.SyncAllRequest'],
    ['SyncAllReply', 'gamepb.friendpb.SyncAllReply'],
    ['SyncAllFriendsRequest', 'gamepb.friendpb.SyncAllRequest'],
    ['SyncAllFriendsReply', 'gamepb.friendpb.SyncAllReply'],
    ['GetApplicationsRequest', 'gamepb.friendpb.GetApplicationsRequest'],
    ['GetApplicationsReply', 'gamepb.friendpb.GetApplicationsReply'],
    ['AcceptFriendsRequest', 'gamepb.friendpb.AcceptFriendsRequest'],
    ['AcceptFriendsReply', 'gamepb.friendpb.AcceptFriendsReply'],
    ['FriendApplicationReceivedNotify', 'gamepb.friendpb.FriendApplicationReceivedNotify'],
    ['FriendAddedNotify', 'gamepb.friendpb.FriendAddedNotify'],
    ['InteractRecordsRequest', 'gamepb.interactpb.InteractRecordsRequest'],
    ['InteractRecordsReply', 'gamepb.interactpb.InteractRecordsReply'],
    // 访问
    ['VisitEnterRequest', 'gamepb.visitpb.EnterRequest'],
    ['VisitEnterReply', 'gamepb.visitpb.EnterReply'],
    ['VisitLeaveRequest', 'gamepb.visitpb.LeaveRequest'],
    ['VisitLeaveReply', 'gamepb.visitpb.LeaveReply'],
    // 任务
    ['TaskInfoRequest', 'gamepb.taskpb.TaskInfoRequest'],
    ['TaskInfoReply', 'gamepb.taskpb.TaskInfoReply'],
    ['ClaimTaskRewardRequest', 'gamepb.taskpb.ClaimTaskRewardRequest'],
    ['ClaimTaskRewardReply', 'gamepb.taskpb.ClaimTaskRewardReply'],
    ['BatchClaimTaskRewardRequest', 'gamepb.taskpb.BatchClaimTaskRewardRequest'],
    ['BatchClaimTaskRewardReply', 'gamepb.taskpb.BatchClaimTaskRewardReply'],
    ['ClaimDailyRewardRequest', 'gamepb.taskpb.ClaimDailyRewardRequest'],
    ['ClaimDailyRewardReply', 'gamepb.taskpb.ClaimDailyRewardReply'],
    ['TaskInfoNotify', 'gamepb.taskpb.TaskInfoNotify'],
    // 邮箱
    ['GetEmailListRequest', 'gamepb.emailpb.GetEmailListRequest'],
    ['GetEmailListReply', 'gamepb.emailpb.GetEmailListReply'],
    ['ClaimEmailRequest', 'gamepb.emailpb.ClaimEmailRequest'],
    ['ClaimEmailReply', 'gamepb.emailpb.ClaimEmailReply'],
    ['BatchClaimEmailRequest', 'gamepb.emailpb.BatchClaimEmailRequest'],
    ['BatchClaimEmailReply', 'gamepb.emailpb.BatchClaimEmailReply'],
    // 其他
    ['KickoutNotify', 'gatepb.KickoutNotify'],
];

async function loadProto() {
    log('系统', '正在加载 Protobuf 定义...');
    root = new protobuf.Root();

    const protoFiles = fs.readdirSync(PROTO_DIR)
        .filter(f => f.endsWith('.proto'))
        .map(f => path.join(PROTO_DIR, f));

    await root.load(protoFiles, { keepCase: true });

    for (const [typeName, fullName] of typeMappings) {
        types[typeName] = root.lookupType(fullName);
    }

    // Proto 加载完成
    log('系统', 'Protobuf 定义加载完成');
}

function getRoot() {
    return root;
}

module.exports = { loadProto, types, getRoot };