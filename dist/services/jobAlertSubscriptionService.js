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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.unsubscribePublicJobAlertsByToken = exports.markPublicJobAlertWelcomeEmailSent = exports.subscribeToPublicJobAlerts = exports.isValidJobAlertEmail = void 0;
const crypto_1 = __importDefault(require("crypto"));
const inputSanitizers_1 = require("../utils/inputSanitizers");
const jobAlertCategoryService_1 = require("./jobAlertCategoryService");
const JOB_ALERT_SUBSCRIPTIONS_COLLECTION = 'job_alert_subscriptions';
const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const buildSubscriptionId = () => `jobalert-${Date.now()}-${crypto_1.default.randomBytes(4).toString('hex')}`;
const buildUnsubscribeToken = () => crypto_1.default.randomBytes(24).toString('hex');
const normalizeEmail = (value) => (0, inputSanitizers_1.readString)(value, 220).trim().toLowerCase();
const isValidJobAlertEmail = (value) => SIMPLE_EMAIL_REGEX.test(normalizeEmail(value));
exports.isValidJobAlertEmail = isValidJobAlertEmail;
const subscribeToPublicJobAlerts = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const email = normalizeEmail(params.email);
    const category = (0, jobAlertCategoryService_1.normalizeJobAlertCategory)(params.category);
    const nowIso = new Date().toISOString();
    const unsubscribeToken = buildUnsubscribeToken();
    const existing = yield params.db.collection(JOB_ALERT_SUBSCRIPTIONS_COLLECTION).findOne({ email }, {
        projection: {
            id: 1,
            email: 1,
            category: 1,
            isActive: 1,
        },
    });
    const updateResult = yield params.db.collection(JOB_ALERT_SUBSCRIPTIONS_COLLECTION).updateOne({ email }, {
        $set: {
            category,
            cadence: 'weekly',
            isActive: true,
            updatedAt: nowIso,
            unsubscribeToken,
        },
        $setOnInsert: {
            id: buildSubscriptionId(),
            type: 'public_capture',
            createdAt: nowIso,
            lastDigestSentAt: null,
            welcomeEmailSentAt: null,
        },
    }, {
        upsert: true,
    });
    const created = !existing && Number(updateResult.upsertedCount || 0) > 0;
    const reactivated = (existing === null || existing === void 0 ? void 0 : existing.isActive) === false && Number(updateResult.matchedCount || 0) > 0;
    const status = created
        ? 'created'
        : reactivated
            ? 'reactivated'
            : 'updated';
    return {
        status,
        created,
        reactivated,
        email,
        category,
        unsubscribeToken,
    };
});
exports.subscribeToPublicJobAlerts = subscribeToPublicJobAlerts;
const markPublicJobAlertWelcomeEmailSent = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const email = normalizeEmail(params.email);
    if (!email)
        return;
    yield params.db.collection(JOB_ALERT_SUBSCRIPTIONS_COLLECTION).updateOne({ email }, {
        $set: {
            welcomeEmailSentAt: params.sentAtIso,
            updatedAt: params.sentAtIso,
        },
    });
});
exports.markPublicJobAlertWelcomeEmailSent = markPublicJobAlertWelcomeEmailSent;
const unsubscribePublicJobAlertsByToken = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const token = (0, inputSanitizers_1.readString)(params.token, 240);
    if (!token)
        return false;
    const nowIso = new Date().toISOString();
    const result = yield params.db.collection(JOB_ALERT_SUBSCRIPTIONS_COLLECTION).updateOne({
        unsubscribeToken: token,
        isActive: true,
    }, {
        $set: {
            isActive: false,
            updatedAt: nowIso,
            unsubscribedAt: nowIso,
            unsubscribeToken: buildUnsubscribeToken(),
            unsubscribeTokenRotatedAt: nowIso,
        },
    });
    return Number(result.matchedCount || 0) > 0;
});
exports.unsubscribePublicJobAlertsByToken = unsubscribePublicJobAlertsByToken;
