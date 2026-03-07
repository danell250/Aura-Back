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
exports.sendScheduledJobAlertDigests = void 0;
const emailService_1 = require("./emailService");
const publicJobAlertDigestService_1 = require("./publicJobAlertDigestService");
const userJobAlertDigestService_1 = require("./userJobAlertDigestService");
const sendScheduledJobAlertDigests = (db) => __awaiter(void 0, void 0, void 0, function* () {
    if (!db)
        return;
    if (!(0, emailService_1.isEmailDeliveryConfigured)()) {
        console.warn('⚠️ Skipping scheduled job alert digests because SendGrid is not configured.');
        return;
    }
    yield (0, userJobAlertDigestService_1.sendEveryOtherDayUserJobAlertDigests)(db);
    yield (0, publicJobAlertDigestService_1.sendWeeklyPublicJobAlertDigests)(db);
});
exports.sendScheduledJobAlertDigests = sendScheduledJobAlertDigests;
