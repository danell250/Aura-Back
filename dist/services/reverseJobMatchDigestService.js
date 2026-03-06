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
exports.sendDailyReverseJobMatchDigests = void 0;
const emailService_1 = require("./emailService");
const reverseJobMatchService_1 = require("./reverseJobMatchService");
const jobRecommendationService_1 = require("./jobRecommendationService");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const USERS_COLLECTION = 'users';
const REVERSE_MATCH_ALERTS_COLLECTION = 'job_reverse_match_alerts';
const REVERSE_MATCH_EMAIL_WINDOW_HOURS = Number.isFinite(Number(process.env.REVERSE_MATCH_EMAIL_WINDOW_HOURS))
    ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_EMAIL_WINDOW_HOURS)))
    : 24;
const REVERSE_MATCH_EMAIL_MAX_USERS_PER_RUN = Number.isFinite(Number(process.env.REVERSE_MATCH_EMAIL_MAX_USERS_PER_RUN))
    ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_EMAIL_MAX_USERS_PER_RUN)))
    : 200;
const REVERSE_MATCH_EMAIL_MAX_ALERTS_SCAN = Number.isFinite(Number(process.env.REVERSE_MATCH_EMAIL_MAX_ALERTS_SCAN))
    ? Math.max(100, Math.round(Number(process.env.REVERSE_MATCH_EMAIL_MAX_ALERTS_SCAN)))
    : 4000;
const REVERSE_MATCH_DIGEST_MIN_INTERVAL_MS = Number.isFinite(Number(process.env.REVERSE_MATCH_DIGEST_MIN_INTERVAL_HOURS))
    ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_DIGEST_MIN_INTERVAL_HOURS))) * 60 * 60 * 1000
    : 20 * 60 * 60 * 1000;
const REVERSE_MATCH_DIGEST_USER_BATCH_SIZE = Number.isFinite(Number(process.env.REVERSE_MATCH_DIGEST_USER_BATCH_SIZE))
    ? Math.max(1, Math.round(Number(process.env.REVERSE_MATCH_DIGEST_USER_BATCH_SIZE)))
    : 16;
const REVERSE_MATCH_DIGEST_BULK_WRITE_CHUNK_SIZE = Number.isFinite(Number(process.env.REVERSE_MATCH_DIGEST_BULK_WRITE_CHUNK_SIZE))
    ? Math.max(50, Math.round(Number(process.env.REVERSE_MATCH_DIGEST_BULK_WRITE_CHUNK_SIZE)))
    : 500;
const APP_BASE_URL = ((0, inputSanitizers_1.readString)(process.env.FRONTEND_URL, 400)
    || (0, inputSanitizers_1.readString)(process.env.VITE_FRONTEND_URL, 400)
    || 'https://aura.social').replace(/\/+$/, '');
const normalizeHandle = (value) => {
    const raw = (0, inputSanitizers_1.readString)(value, 120).toLowerCase();
    if (!raw)
        return '';
    return raw.startsWith('@') ? raw : `@${raw}`;
};
const buildJobUrl = (job) => {
    const slug = (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.jobSlug, 220) || (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.slug, 220);
    const jobId = (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.jobId, 140) || (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.id, 140);
    if (slug)
        return `${APP_BASE_URL}/jobs/${encodeURIComponent(slug)}`;
    if (jobId)
        return `${APP_BASE_URL}/jobs/${encodeURIComponent(jobId)}`;
    return `${APP_BASE_URL}/jobs`;
};
const dedupeAlertsByJob = (alerts) => {
    const seen = new Set();
    const next = [];
    for (const alert of alerts) {
        const jobId = (0, inputSanitizers_1.readString)(alert === null || alert === void 0 ? void 0 : alert.jobId, 120);
        if (!jobId || seen.has(jobId))
            continue;
        seen.add(jobId);
        next.push(alert);
    }
    return next;
};
const resolveAlertIds = (alerts) => alerts
    .map((alert) => (0, inputSanitizers_1.readString)(alert === null || alert === void 0 ? void 0 : alert.id, 160))
    .filter((id) => id.length > 0);
const runBulkWriteInChunks = (collection, operations, chunkSize) => __awaiter(void 0, void 0, void 0, function* () {
    if (operations.length === 0)
        return;
    for (let index = 0; index < operations.length; index += chunkSize) {
        const batch = operations.slice(index, index + chunkSize);
        yield collection.bulkWrite(batch, { ordered: false });
    }
});
const buildDigestOutcomeForUser = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const { userId, user, alertsByUser, nowMs } = params;
    const lastDigestAtRaw = (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.lastReverseJobDigestAt, 80);
    const lastDigestAtMs = lastDigestAtRaw ? new Date(lastDigestAtRaw).getTime() : 0;
    if (Number.isFinite(lastDigestAtMs) && (nowMs - lastDigestAtMs) < REVERSE_MATCH_DIGEST_MIN_INTERVAL_MS) {
        return null;
    }
    const userAlerts = dedupeAlertsByJob((alertsByUser.get(userId) || []).sort((left, right) => {
        const rightScore = Number((right === null || right === void 0 ? void 0 : right.score) || 0);
        const leftScore = Number((left === null || left === void 0 ? void 0 : left.score) || 0);
        return rightScore - leftScore;
    })).slice(0, 10);
    if (userAlerts.length === 0)
        return null;
    const alertIds = resolveAlertIds(userAlerts);
    if (alertIds.length === 0)
        return null;
    const sentAtIso = new Date(nowMs).toISOString();
    const email = (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.email, 220).toLowerCase();
    if (!email) {
        return {
            userId,
            alertIds,
            sentAtIso,
            skippedReason: 'missing_email',
            updateUserDigestAt: true,
        };
    }
    const recipientName = (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.firstName, 120)
        || (0, inputSanitizers_1.readString)(user === null || user === void 0 ? void 0 : user.name, 160)
        || 'there';
    const handle = normalizeHandle(user === null || user === void 0 ? void 0 : user.handle);
    const shareUrl = handle ? `${APP_BASE_URL}/jobs/${encodeURIComponent(handle)}` : '';
    const jobsPayload = userAlerts.map((alert) => {
        const score = Math.max(0, Math.round(Number((alert === null || alert === void 0 ? void 0 : alert.score) || 0)));
        return {
            title: (0, inputSanitizers_1.readString)(alert === null || alert === void 0 ? void 0 : alert.title, 140) || 'Job opportunity',
            companyName: (0, inputSanitizers_1.readString)(alert === null || alert === void 0 ? void 0 : alert.companyName, 140) || 'Hiring Team',
            locationText: (0, inputSanitizers_1.readString)(alert === null || alert === void 0 ? void 0 : alert.locationText, 160),
            score,
            url: buildJobUrl(alert),
            matchTier: (0, jobRecommendationService_1.resolveRecommendationMatchTier)(score),
        };
    });
    try {
        yield (0, emailService_1.sendReverseJobMatchDigestEmail)(email, {
            recipientName,
            jobs: jobsPayload,
            shareUrl,
        });
        return {
            userId,
            alertIds,
            sentAtIso,
            updateUserDigestAt: true,
        };
    }
    catch (error) {
        console.error('Reverse match digest email dispatch error:', error);
        return null;
    }
});
const sendDailyReverseJobMatchDigests = (db) => __awaiter(void 0, void 0, void 0, function* () {
    if (!db)
        return;
    try {
        yield (0, reverseJobMatchService_1.ensureReverseMatchIndexes)(db);
    }
    catch (error) {
        console.error('Reverse match digest index ensure error:', error);
        return;
    }
    const windowSinceIso = new Date(Date.now() - (REVERSE_MATCH_EMAIL_WINDOW_HOURS * 60 * 60 * 1000)).toISOString();
    const alerts = yield db.collection(REVERSE_MATCH_ALERTS_COLLECTION)
        .find({
        createdAt: { $gte: windowSinceIso },
        emailDigestSentAt: { $exists: false },
    })
        .sort({ score: -1, createdAt: -1 })
        .limit(REVERSE_MATCH_EMAIL_MAX_ALERTS_SCAN)
        .toArray();
    if (alerts.length === 0)
        return;
    const alertsByUser = new Map();
    for (const alert of alerts) {
        const userId = (0, inputSanitizers_1.readString)(alert === null || alert === void 0 ? void 0 : alert.userId, 120);
        if (!userId)
            continue;
        const bucket = alertsByUser.get(userId) || [];
        bucket.push(alert);
        alertsByUser.set(userId, bucket);
    }
    if (alertsByUser.size === 0)
        return;
    const userIds = Array.from(alertsByUser.keys()).slice(0, REVERSE_MATCH_EMAIL_MAX_USERS_PER_RUN);
    const users = yield db.collection(USERS_COLLECTION).find({ id: { $in: userIds } }, {
        projection: {
            id: 1,
            email: 1,
            handle: 1,
            firstName: 1,
            name: 1,
            lastReverseJobDigestAt: 1,
        },
    }).toArray();
    const usersById = new Map(users.map((user) => [String(user.id), user]));
    const nowMs = Date.now();
    const outcomes = [];
    for (let start = 0; start < userIds.length; start += REVERSE_MATCH_DIGEST_USER_BATCH_SIZE) {
        const userBatch = userIds.slice(start, start + REVERSE_MATCH_DIGEST_USER_BATCH_SIZE);
        const settled = yield Promise.allSettled(userBatch.map((userId) => {
            const user = usersById.get(userId);
            if (!user)
                return Promise.resolve(null);
            return buildDigestOutcomeForUser({
                userId,
                user,
                alertsByUser,
                nowMs,
            });
        }));
        for (const result of settled) {
            if (result.status !== 'fulfilled')
                continue;
            if (!result.value)
                continue;
            outcomes.push(result.value);
        }
        yield new Promise((resolve) => setImmediate(resolve));
    }
    if (outcomes.length === 0)
        return;
    const alertBulkOps = [];
    const userBulkOps = [];
    for (const outcome of outcomes) {
        const alertUpdate = outcome.skippedReason
            ? {
                $set: {
                    emailDigestSentAt: outcome.sentAtIso,
                    emailDigestSkippedReason: outcome.skippedReason,
                },
            }
            : {
                $set: {
                    emailDigestSentAt: outcome.sentAtIso,
                },
                $unset: {
                    emailDigestSkippedReason: '',
                },
            };
        alertBulkOps.push({
            updateMany: {
                filter: { id: { $in: outcome.alertIds } },
                update: alertUpdate,
            },
        });
        if (outcome.updateUserDigestAt) {
            userBulkOps.push({
                updateOne: {
                    filter: { id: outcome.userId },
                    update: { $set: { lastReverseJobDigestAt: outcome.sentAtIso } },
                },
            });
        }
    }
    yield runBulkWriteInChunks(db.collection(REVERSE_MATCH_ALERTS_COLLECTION), alertBulkOps, REVERSE_MATCH_DIGEST_BULK_WRITE_CHUNK_SIZE);
    yield runBulkWriteInChunks(db.collection(USERS_COLLECTION), userBulkOps, REVERSE_MATCH_DIGEST_BULK_WRITE_CHUNK_SIZE);
});
exports.sendDailyReverseJobMatchDigests = sendDailyReverseJobMatchDigests;
