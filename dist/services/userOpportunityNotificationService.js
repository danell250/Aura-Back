"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInviteToApplyNotification = void 0;
const notificationsController_1 = require("../controllers/notificationsController");
const openToWorkMetricsService_1 = require("./openToWorkMetricsService");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const createInviteToApplyNotification = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const candidateUserId = (0, inputSanitizers_1.readString)(params.candidateUserId, 120);
    const companyId = (0, inputSanitizers_1.readString)(params.companyId, 120);
    if (!candidateUserId || !companyId)
        return null;
    const notification = yield (0, notificationsController_1.createNotificationInDB)(candidateUserId, 'invite_to_apply', companyId, 'invited you to explore roles on Aura', undefined, undefined, {
        companyId,
        companyHandle: (0, inputSanitizers_1.readString)(params.companyHandle, 120),
        invitedByUserId: (0, inputSanitizers_1.readString)(params.invitedByUserId, 120) || undefined,
    }, undefined, 'user');
    yield (0, openToWorkMetricsService_1.recordOpenToWorkInviteMetric)({
        db: params.db,
        userId: candidateUserId,
    });
    return notification;
});
exports.createInviteToApplyNotification = createInviteToApplyNotification;
