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
exports.listUserBadges = exports.awardStatusDrivenBadge = exports.awardApplicationMilestoneBadges = exports.awardBadgeToUser = void 0;
const crypto_1 = __importDefault(require("crypto"));
const badgeCatalog_1 = require("../config/badgeCatalog");
const USER_BADGES_COLLECTION = 'user_badges';
const INTERVIEW_STATUSES = new Set(['in_review', 'shortlisted']);
const readString = (value, maxLength = 200) => {
    if (typeof value !== 'string')
        return '';
    const normalized = value.trim();
    if (!normalized)
        return '';
    return normalized.slice(0, maxLength);
};
const isBadgeKey = (value) => Object.prototype.hasOwnProperty.call(badgeCatalog_1.BADGE_CATALOG, value);
const readBadgeAwardedAt = (userBadge) => readString(userBadge === null || userBadge === void 0 ? void 0 : userBadge.awardedAt, 80) || readString(userBadge === null || userBadge === void 0 ? void 0 : userBadge.createdAt, 80) || null;
const readBadgeSortOrder = (definition) => Number.isFinite(definition === null || definition === void 0 ? void 0 : definition.sortOrder) ? Number(definition.sortOrder) : 999;
const readBadgeIcon = (definition) => readString(definition === null || definition === void 0 ? void 0 : definition.icon, 8) || '🏅';
const readBadgeCategory = (definition) => readString(definition === null || definition === void 0 ? void 0 : definition.category, 40) || 'jobs';
const readBadgeName = (definition, key) => readString(definition === null || definition === void 0 ? void 0 : definition.name, 120) || key;
const readBadgeDescription = (definition) => readString(definition === null || definition === void 0 ? void 0 : definition.description, 300) || '';
const getBadgeDefinitionByKey = (key) => isBadgeKey(key) ? badgeCatalog_1.BADGE_CATALOG[key] : null;
const normalizeBadgeResponse = (userBadge, definition) => {
    const key = readString(userBadge === null || userBadge === void 0 ? void 0 : userBadge.badgeKey, 80);
    return {
        id: readString(userBadge === null || userBadge === void 0 ? void 0 : userBadge.id, 160) || `user-badge-${key}`,
        key,
        name: readBadgeName(definition, key),
        description: readBadgeDescription(definition),
        icon: readBadgeIcon(definition),
        category: readBadgeCategory(definition),
        sortOrder: readBadgeSortOrder(definition),
        awardedAt: readBadgeAwardedAt(userBadge),
    };
};
const mapUserBadgeRowsToResponse = (rows) => rows
    .map((row) => {
    const key = readString(row === null || row === void 0 ? void 0 : row.badgeKey, 80);
    const definition = getBadgeDefinitionByKey(key);
    if (!definition)
        return null;
    return normalizeBadgeResponse(row, definition);
})
    .filter((row) => Boolean(row));
const awardBadgeToUser = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = readString(params.userId, 120);
    if (!userId)
        return { awarded: false, badgeKey: params.badgeKey };
    const nowIso = new Date().toISOString();
    const metadata = params.metadata && typeof params.metadata === 'object' && !Array.isArray(params.metadata)
        ? params.metadata
        : null;
    const result = yield params.db.collection(USER_BADGES_COLLECTION).updateOne({ userId, badgeKey: params.badgeKey }, {
        $setOnInsert: {
            id: `userbadge-${Date.now()}-${crypto_1.default.randomBytes(4).toString('hex')}`,
            userId,
            badgeKey: params.badgeKey,
            source: readString(params.source, 80) || 'system',
            metadata,
            createdAt: nowIso,
            awardedAt: nowIso,
            awardedAtDate: new Date(nowIso),
        },
        $set: {
            updatedAt: nowIso,
        },
    }, { upsert: true });
    return {
        awarded: Boolean((result === null || result === void 0 ? void 0 : result.matchedCount) || (result === null || result === void 0 ? void 0 : result.upsertedCount)),
        badgeKey: params.badgeKey,
    };
});
exports.awardBadgeToUser = awardBadgeToUser;
const awardApplicationMilestoneBadges = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = readString(params.userId, 120);
    if (!userId)
        return;
    const applicationCountCandidate = Number(params.applicationCount);
    if (!Number.isFinite(applicationCountCandidate) || applicationCountCandidate < 0) {
        return;
    }
    const applicationCount = applicationCountCandidate;
    const milestoneBadgeKey = applicationCount === 1
        ? 'first_application'
        : applicationCount === 10
            ? 'ten_applications'
            : null;
    if (!milestoneBadgeKey)
        return;
    yield (0, exports.awardBadgeToUser)({
        db: params.db,
        userId,
        badgeKey: milestoneBadgeKey,
        source: 'job_application_submitted',
        metadata: {
            applicationId: readString(params.applicationId, 160) || null,
            applicationsSubmitted: applicationCount,
        },
    });
});
exports.awardApplicationMilestoneBadges = awardApplicationMilestoneBadges;
const awardStatusDrivenBadge = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = readString(params.userId, 120);
    const nextStatus = readString(params.nextStatus, 40).toLowerCase();
    const applicationId = readString(params.applicationId, 160);
    if (!userId || !nextStatus || !applicationId)
        return;
    if (INTERVIEW_STATUSES.has(nextStatus)) {
        yield (0, exports.awardBadgeToUser)({
            db: params.db,
            userId,
            badgeKey: 'interview_stage',
            source: 'job_application_status_update',
            metadata: {
                applicationId,
                status: nextStatus,
            },
        });
    }
    if (nextStatus === 'hired') {
        yield (0, exports.awardBadgeToUser)({
            db: params.db,
            userId,
            badgeKey: 'hired',
            source: 'job_application_status_update',
            metadata: {
                applicationId,
                status: nextStatus,
            },
        });
    }
});
exports.awardStatusDrivenBadge = awardStatusDrivenBadge;
const listUserBadges = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = readString(params.userId, 120);
    if (!userId)
        return [];
    const limit = Number.isFinite(params.limit) ? Math.min(100, Math.max(1, Number(params.limit))) : 40;
    const rows = yield params.db.collection(USER_BADGES_COLLECTION)
        .find({ userId }, {
        projection: {
            id: 1,
            userId: 1,
            badgeKey: 1,
            awardedAt: 1,
            createdAt: 1,
        },
    })
        .sort({ awardedAtDate: -1, awardedAt: -1, createdAt: -1 })
        .limit(limit)
        .toArray();
    if (!rows.length)
        return [];
    return mapUserBadgeRowsToResponse(rows);
});
exports.listUserBadges = listUserBadges;
