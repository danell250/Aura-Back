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
exports.startReportScheduleWorker = exports.processDueReportSchedules = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const authMiddleware_1 = require("../middleware/authMiddleware");
const emailService_1 = require("../services/emailService");
const identityUtils_1 = require("../utils/identityUtils");
const adPlanAccess_1 = require("../utils/adPlanAccess");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const router = (0, express_1.Router)();
const REPORT_SCHEDULES_COLLECTION = 'reportSchedules';
const REPORT_PREVIEW_AUDIT_COLLECTION = 'reportPreviewAudit';
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REPORT_RUNNER_INTERVAL_MS = 60 * 1000;
const REPORT_RUNNER_BATCH_LIMIT = 20;
const REPORT_PREVIEW_DAILY_LIMIT = 30;
const REPORT_CAMPAIGN_DATA_MAX_ROWS = 10000;
const WEEKDAY_TO_INDEX = {
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5
};
const toBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean')
        return value;
    return fallback;
};
const clampMonthlyDay = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num))
        return 1;
    return Math.max(1, Math.min(28, Math.floor(num)));
};
const normalizeTime = (value) => {
    if (typeof value !== 'string')
        return '08:00';
    const trimmed = value.trim();
    if (!/^\d{2}:\d{2}$/.test(trimmed))
        return '08:00';
    const [hRaw, mRaw] = trimmed.split(':');
    const hours = Math.max(0, Math.min(23, Number(hRaw)));
    const minutes = Math.max(0, Math.min(59, Number(mRaw)));
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};
const normalizeRecipients = (value) => {
    if (!Array.isArray(value))
        return [];
    return Array.from(new Set(value
        .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
        .filter((entry) => entry.length > 0)
        .filter((entry) => emailRegex.test(entry)))).slice(0, 5);
};
const getOwnerFromRequest = (req) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const actor = req === null || req === void 0 ? void 0 : req.user;
    if (!(actor === null || actor === void 0 ? void 0 : actor.id))
        return null;
    const requestedOwnerType = typeof ((_a = req.body) === null || _a === void 0 ? void 0 : _a.ownerType) === 'string'
        ? req.body.ownerType
        : (typeof ((_b = req.query) === null || _b === void 0 ? void 0 : _b.ownerType) === 'string' ? req.query.ownerType : undefined);
    const requestedOwnerId = typeof ((_c = req.body) === null || _c === void 0 ? void 0 : _c.ownerId) === 'string'
        ? req.body.ownerId
        : (typeof ((_d = req.query) === null || _d === void 0 ? void 0 : _d.ownerId) === 'string' ? req.query.ownerId : undefined);
    const resolved = yield (0, identityUtils_1.resolveIdentityActor)(actor.id, { ownerType: requestedOwnerType, ownerId: requestedOwnerId }, req.headers);
    if (!resolved)
        return null;
    return { ownerId: resolved.id, ownerType: resolved.type };
});
const resolveOwnerReportEntitlements = (owner) => __awaiter(void 0, void 0, void 0, function* () {
    const db = (0, db_1.getDB)();
    const planAccess = yield (0, adPlanAccess_1.resolveOwnerPlanAccess)(db, owner.ownerId, owner.ownerType, Date.now());
    return { packageId: planAccess.packageId, entitlements: planAccess.entitlements };
});
const normalizeEmail = (value) => {
    if (typeof value !== 'string')
        return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized || !emailRegex.test(normalized))
        return null;
    return normalized;
};
const collectAllowedPreviewRecipients = (owner, actorId) => __awaiter(void 0, void 0, void 0, function* () {
    const db = (0, db_1.getDB)();
    const allowed = new Set();
    const pushEmail = (value) => {
        const normalized = normalizeEmail(value);
        if (normalized) {
            allowed.add(normalized);
        }
    };
    const actor = yield db.collection('users').findOne({ id: actorId }, { projection: { email: 1 } });
    pushEmail(actor === null || actor === void 0 ? void 0 : actor.email);
    if (owner.ownerType === 'user') {
        if (owner.ownerId !== actorId) {
            const ownerUser = yield db.collection('users').findOne({ id: owner.ownerId }, { projection: { email: 1 } });
            pushEmail(ownerUser === null || ownerUser === void 0 ? void 0 : ownerUser.email);
        }
        return allowed;
    }
    const [company, memberships] = yield Promise.all([
        db.collection('companies').findOne({ id: owner.ownerId, legacyArchived: { $ne: true } }, { projection: { email: 1 } }),
        db.collection('company_members')
            .find({ companyId: owner.ownerId }, { projection: { userId: 1 } })
            .toArray()
    ]);
    pushEmail(company === null || company === void 0 ? void 0 : company.email);
    const memberIds = Array.from(new Set(memberships
        .map((membership) => (typeof (membership === null || membership === void 0 ? void 0 : membership.userId) === 'string' ? membership.userId : ''))
        .filter((memberId) => memberId.length > 0)));
    if (memberIds.length > 0) {
        const members = yield db.collection('users')
            .find({ id: { $in: memberIds } }, { projection: { email: 1 } })
            .toArray();
        for (const member of members) {
            pushEmail(member === null || member === void 0 ? void 0 : member.email);
        }
    }
    return allowed;
});
const reportPreviewRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 10 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many report preview requests',
        message: 'Please wait before sending another report preview.'
    }
});
const computeNextRunAt = (schedule, fromMs = Date.now()) => {
    var _a;
    const [hourPart, minutePart] = normalizeTime(schedule.time).split(':');
    const targetHours = Number(hourPart);
    const targetMinutes = Number(minutePart);
    const now = new Date(fromMs);
    const candidate = new Date(fromMs);
    candidate.setSeconds(0, 0);
    candidate.setHours(targetHours, targetMinutes, 0, 0);
    if (schedule.frequency === 'daily') {
        if (candidate.getTime() <= now.getTime()) {
            candidate.setDate(candidate.getDate() + 1);
        }
        return candidate.getTime();
    }
    if (schedule.frequency === 'weekly') {
        const targetDay = (_a = WEEKDAY_TO_INDEX[schedule.weeklyDay]) !== null && _a !== void 0 ? _a : now.getDay();
        let diff = targetDay - candidate.getDay();
        if (diff < 0 || (diff === 0 && candidate.getTime() <= now.getTime())) {
            diff += 7;
        }
        candidate.setDate(candidate.getDate() + diff);
        return candidate.getTime();
    }
    const monthlyDay = clampMonthlyDay(schedule.monthlyDay);
    candidate.setDate(monthlyDay);
    if (candidate.getTime() <= now.getTime()) {
        candidate.setMonth(candidate.getMonth() + 1);
        candidate.setDate(monthlyDay);
    }
    return candidate.getTime();
};
const buildOwnerAnalyticsMatch = (ownerId, ownerType) => {
    if (ownerType === 'company') {
        return {
            $or: [
                { ownerId, ownerType: 'company' },
                { userId: ownerId, ownerType: 'company' }
            ]
        };
    }
    return {
        $or: [
            { ownerId, ownerType: 'user' },
            { ownerId, ownerType: { $exists: false } },
            { userId: ownerId }
        ]
    };
};
const aggregateAnalyticsTotals = (rows) => rows.reduce((acc, row) => {
    acc.impressions += Number((row === null || row === void 0 ? void 0 : row.impressions) || 0);
    acc.clicks += Number((row === null || row === void 0 ? void 0 : row.clicks) || 0);
    acc.engagement += Number((row === null || row === void 0 ? void 0 : row.engagement) || 0);
    acc.reach += Number((row === null || row === void 0 ? void 0 : row.reach) || 0);
    acc.conversions += Number((row === null || row === void 0 ? void 0 : row.conversions) || 0);
    return acc;
}, { impressions: 0, clicks: 0, engagement: 0, reach: 0, conversions: 0 });
const mapCampaignDataRows = (rows, adMetaMap) => rows.map((row) => {
    const impressions = Number((row === null || row === void 0 ? void 0 : row.impressions) || 0);
    const clicks = Number((row === null || row === void 0 ? void 0 : row.clicks) || 0);
    const adMeta = adMetaMap.get(String((row === null || row === void 0 ? void 0 : row.adId) || ''));
    return {
        id: String((row === null || row === void 0 ? void 0 : row.adId) || ''),
        name: (adMeta === null || adMeta === void 0 ? void 0 : adMeta.name) || String((row === null || row === void 0 ? void 0 : row.adId) || 'Untitled Signal'),
        status: (adMeta === null || adMeta === void 0 ? void 0 : adMeta.status) || 'active',
        impressions,
        reach: Number((row === null || row === void 0 ? void 0 : row.reach) || 0),
        clicks,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        conversions: Number((row === null || row === void 0 ? void 0 : row.conversions) || 0),
        lastUpdated: (adMeta === null || adMeta === void 0 ? void 0 : adMeta.lastUpdated) || Date.now()
    };
});
const buildTopSignals = (campaignData) => campaignData.slice(0, 5).map((row) => ({
    name: row.name,
    ctr: row.ctr,
    reach: row.reach
}));
const buildRecommendations = (ctr, totals, topSignals) => {
    var _a;
    const recommendations = [];
    if (ctr < 1.5) {
        recommendations.push('Refresh creative and CTA on your lowest-performing signals.');
    }
    else {
        recommendations.push('Scale distribution behind top-performing creative in the next cycle.');
    }
    if (totals.conversions < Math.max(1, totals.clicks * 0.02)) {
        recommendations.push('Improve landing-page relevance to increase conversion quality.');
    }
    else {
        recommendations.push('Replicate winning conversion paths to adjacent audience segments.');
    }
    if ((_a = topSignals[0]) === null || _a === void 0 ? void 0 : _a.name) {
        recommendations.push(`Prioritize delivery behind "${topSignals[0].name}" until next report cycle.`);
    }
    else {
        recommendations.push('Launch one additional signal to improve trend and optimization depth.');
    }
    return recommendations;
};
const buildScheduledSummaryPayload = (schedule) => __awaiter(void 0, void 0, void 0, function* () {
    const db = (0, db_1.getDB)();
    const match = buildOwnerAnalyticsMatch(schedule.ownerId, schedule.ownerType);
    const rows = yield db.collection('adAnalytics')
        .find(match)
        .project({
        adId: 1,
        impressions: 1,
        clicks: 1,
        engagement: 1,
        reach: 1,
        conversions: 1
    })
        .sort({ impressions: -1, clicks: -1 })
        .limit(REPORT_CAMPAIGN_DATA_MAX_ROWS)
        .toArray();
    const totals = aggregateAnalyticsTotals(rows);
    const adIds = Array.from(new Set(rows.map((row) => row === null || row === void 0 ? void 0 : row.adId).filter((id) => typeof id === 'string' && id.length > 0)));
    const ads = adIds.length
        ? yield db.collection('ads').find({ id: { $in: adIds } }).project({ id: 1, headline: 1, status: 1, lastUpdated: 1 }).toArray()
        : [];
    const adMetaMap = new Map(ads.map((ad) => [
        String(ad.id),
        {
            name: String(ad.headline || 'Untitled Signal'),
            status: String(ad.status || 'active'),
            lastUpdated: Number(ad.lastUpdated || 0) || undefined
        }
    ]));
    const campaignData = mapCampaignDataRows(rows, adMetaMap);
    const topSignals = buildTopSignals(campaignData);
    const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    const conversionRate = totals.clicks > 0 ? (totals.conversions / totals.clicks) * 100 : 0;
    const auraEfficiency = Number(((ctr * 0.65) + (conversionRate * 0.35)).toFixed(2));
    const recommendations = buildRecommendations(ctr, totals, topSignals);
    return {
        periodLabel: schedule.frequency === 'daily'
            ? 'Last 24 hours'
            : schedule.frequency === 'weekly'
                ? 'Last 7 days'
                : 'Last 30 days',
        scope: schedule.scope,
        campaignName: schedule.campaignName,
        metrics: {
            reach: totals.reach,
            ctr,
            clicks: totals.clicks,
            conversions: totals.conversions,
            auraEfficiency
        },
        campaignData,
        topSignals,
        recommendations
    };
});
const mapScheduleToResponse = (doc) => ({
    id: doc.id,
    frequency: doc.frequency,
    scope: doc.scope,
    recipients: doc.recipients,
    deliveryEmail: doc.recipients.length > 0,
    deliveryPdf: doc.deliveryMode === 'pdf_attachment',
    deliveryMode: doc.deliveryMode,
    includeKPIs: doc.includeKPIs,
    includeTrends: doc.includeTrends,
    includeTopPosts: doc.includeTopPosts,
    includeEfficiency: doc.includeEfficiency,
    weeklyDay: doc.weeklyDay,
    monthlyDay: doc.monthlyDay,
    time: doc.time,
    campaignName: doc.campaignName,
    status: doc.status,
    nextRunAt: doc.nextRunAt,
    lastRunAt: doc.lastRunAt,
    lastRunStatus: doc.lastRunStatus,
    lastError: doc.lastError
});
const processDueReportSchedules = () => __awaiter(void 0, void 0, void 0, function* () {
    if (!(0, db_1.isDBConnected)())
        return;
    if (!(0, emailService_1.isEmailDeliveryConfigured)())
        return;
    const db = (0, db_1.getDB)();
    const now = Date.now();
    const dueSchedules = yield db.collection(REPORT_SCHEDULES_COLLECTION)
        .find({
        status: 'active',
        nextRunAt: { $lte: now },
        processing: { $ne: true }
    })
        .sort({ nextRunAt: 1 })
        .limit(REPORT_RUNNER_BATCH_LIMIT)
        .toArray();
    for (const schedule of dueSchedules) {
        const lockResult = yield db.collection(REPORT_SCHEDULES_COLLECTION).updateOne({ id: schedule.id, status: 'active', nextRunAt: schedule.nextRunAt, processing: { $ne: true } }, { $set: { processing: true, updatedAt: new Date().toISOString() } });
        if (lockResult.modifiedCount === 0)
            continue;
        try {
            const planAccess = yield resolveOwnerReportEntitlements({
                ownerId: schedule.ownerId,
                ownerType: schedule.ownerType
            });
            if (!planAccess.entitlements.canScheduleReports) {
                yield db.collection(REPORT_SCHEDULES_COLLECTION).updateOne({ id: schedule.id }, {
                    $set: {
                        processing: false,
                        status: 'paused',
                        lastRunAt: Date.now(),
                        lastRunStatus: 'failed',
                        lastError: 'Paused automatically because scheduled reports are not available for the current plan.',
                        updatedAt: new Date().toISOString()
                    }
                });
                continue;
            }
            const payload = yield buildScheduledSummaryPayload(schedule);
            const results = yield Promise.all(schedule.recipients.map((recipient) => (0, emailService_1.sendReportPreviewEmail)(recipient, payload)));
            const deliveredCount = results.filter((result) => result.delivered).length;
            const nextRunAt = computeNextRunAt(schedule, Date.now() + 30000);
            yield db.collection(REPORT_SCHEDULES_COLLECTION).updateOne({ id: schedule.id }, {
                $set: {
                    processing: false,
                    lastRunAt: Date.now(),
                    lastRunStatus: deliveredCount > 0 ? 'success' : 'failed',
                    lastError: deliveredCount > 0 ? null : 'Email delivery unavailable',
                    nextRunAt,
                    updatedAt: new Date().toISOString()
                }
            });
        }
        catch (error) {
            yield db.collection(REPORT_SCHEDULES_COLLECTION).updateOne({ id: schedule.id }, {
                $set: {
                    processing: false,
                    lastRunAt: Date.now(),
                    lastRunStatus: 'failed',
                    lastError: (error === null || error === void 0 ? void 0 : error.message) || 'Failed to send scheduled report',
                    nextRunAt: Date.now() + 15 * 60 * 1000,
                    updatedAt: new Date().toISOString()
                }
            });
        }
    }
});
exports.processDueReportSchedules = processDueReportSchedules;
let reportSchedulerTimer = null;
const startReportScheduleWorker = () => {
    if (reportSchedulerTimer)
        return;
    reportSchedulerTimer = setInterval(() => {
        (0, exports.processDueReportSchedules)().catch((error) => {
            console.error('Scheduled report worker failed:', error);
        });
    }, REPORT_RUNNER_INTERVAL_MS);
    // Warmup run after startup.
    setTimeout(() => {
        (0, exports.processDueReportSchedules)().catch((error) => {
            console.error('Scheduled report warmup run failed:', error);
        });
    }, 10000);
};
exports.startReportScheduleWorker = startReportScheduleWorker;
router.post('/preview-email', authMiddleware_1.requireAuth, reportPreviewRateLimiter, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        const actor = req.user;
        if (!(actor === null || actor === void 0 ? void 0 : actor.id)) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const owner = yield getOwnerFromRequest(req);
        if (!owner) {
            return res.status(403).json({ success: false, error: 'Unauthorized identity context' });
        }
        const planAccess = yield resolveOwnerReportEntitlements(owner);
        if (!planAccess.entitlements.canScheduleReports) {
            return res.status(403).json({
                success: false,
                error: 'Report scheduling is not available for this plan',
                message: 'Scheduled report delivery is available on Universal Signal.'
            });
        }
        if (!(0, emailService_1.isEmailDeliveryConfigured)()) {
            return res.status(503).json({
                success: false,
                error: 'Email delivery is not configured. Add SENDGRID_API_KEY and sender settings on the backend.'
            });
        }
        const recipients = normalizeRecipients((_a = req.body) === null || _a === void 0 ? void 0 : _a.recipients);
        if (recipients.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one valid recipient is required' });
        }
        const db = (0, db_1.getDB)();
        const nowMs = Date.now();
        const last24h = nowMs - 24 * 60 * 60 * 1000;
        const sentInLast24h = yield db.collection(REPORT_PREVIEW_AUDIT_COLLECTION).countDocuments({
            ownerId: owner.ownerId,
            ownerType: owner.ownerType,
            createdAtMs: { $gte: last24h }
        });
        if (sentInLast24h >= REPORT_PREVIEW_DAILY_LIMIT) {
            return res.status(429).json({
                success: false,
                error: 'Daily report preview limit reached',
                message: 'Report preview quota exceeded for the last 24 hours.'
            });
        }
        const allowedRecipients = yield collectAllowedPreviewRecipients(owner, actor.id);
        const forbiddenRecipients = recipients.filter((recipient) => !allowedRecipients.has(recipient));
        if (forbiddenRecipients.length > 0) {
            return res.status(403).json({
                success: false,
                error: 'Recipient not allowed',
                message: 'Report previews can only be sent to verified owner/team email recipients.',
                recipients: forbiddenRecipients
            });
        }
        const summary = typeof ((_b = req.body) === null || _b === void 0 ? void 0 : _b.summary) === 'object' && ((_c = req.body) === null || _c === void 0 ? void 0 : _c.summary) ? req.body.summary : {};
        const deliveryMode = ((_d = req.body) === null || _d === void 0 ? void 0 : _d.deliveryMode) === 'pdf_attachment' ? 'pdf_attachment' : 'inline_email';
        if (deliveryMode === 'pdf_attachment' && !planAccess.entitlements.canExportPdf) {
            return res.status(403).json({
                success: false,
                error: 'PDF report delivery is not available for this plan'
            });
        }
        let pdfAttachment;
        const rawAttachment = (_e = req.body) === null || _e === void 0 ? void 0 : _e.pdfAttachment;
        if (rawAttachment && typeof rawAttachment === 'object') {
            const filename = typeof rawAttachment.filename === 'string' ? rawAttachment.filename.trim() : '';
            const contentBase64 = typeof rawAttachment.contentBase64 === 'string' ? rawAttachment.contentBase64.trim() : '';
            if (contentBase64.length > 0) {
                const normalizedBase64 = contentBase64.replace(/^data:application\/pdf;base64,/, '');
                if (normalizedBase64.length > 8000000) {
                    return res.status(400).json({ success: false, error: 'PDF attachment is too large' });
                }
                pdfAttachment = {
                    filename: filename || 'aura-scheduled-report.pdf',
                    contentBase64: normalizedBase64
                };
            }
        }
        const payload = Object.assign(Object.assign(Object.assign({}, summary), { deliveryMode }), (pdfAttachment ? { pdfAttachment } : {}));
        const results = yield Promise.all(recipients.map((recipient) => (0, emailService_1.sendReportPreviewEmail)(recipient, payload)));
        const sentTo = results.filter((result) => result.delivered).length;
        if (sentTo === 0) {
            return res.status(503).json({
                success: false,
                error: ((_f = results[0]) === null || _f === void 0 ? void 0 : _f.reason) || 'No report emails were delivered'
            });
        }
        yield db.collection(REPORT_PREVIEW_AUDIT_COLLECTION).insertOne({
            id: `report-preview-${nowMs}-${Math.random().toString(36).slice(2, 9)}`,
            ownerId: owner.ownerId,
            ownerType: owner.ownerType,
            requestedByUserId: actor.id,
            recipients,
            sentTo,
            createdAtMs: nowMs,
            createdAt: new Date(nowMs).toISOString()
        });
        return res.json({
            success: true,
            sentTo
        });
    }
    catch (error) {
        console.error('Error sending report preview email:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to send report preview email'
        });
    }
}));
router.get('/schedules', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const actor = req.user;
        if (!(actor === null || actor === void 0 ? void 0 : actor.id)) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const owner = yield getOwnerFromRequest(req);
        if (!owner) {
            return res.status(403).json({ success: false, error: 'Unauthorized identity context' });
        }
        const planAccess = yield resolveOwnerReportEntitlements(owner);
        if (!planAccess.entitlements.canScheduleReports) {
            return res.json({
                success: true,
                data: []
            });
        }
        const db = (0, db_1.getDB)();
        const docs = yield db.collection(REPORT_SCHEDULES_COLLECTION)
            .find({ ownerId: owner.ownerId, ownerType: owner.ownerType, status: { $ne: 'paused' } })
            .sort({ createdAt: -1 })
            .toArray();
        return res.json({
            success: true,
            data: docs.map(mapScheduleToResponse)
        });
    }
    catch (error) {
        console.error('Error listing report schedules:', error);
        return res.status(500).json({ success: false, error: 'Failed to load report schedules' });
    }
}));
router.post('/schedules', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
    try {
        const actor = req.user;
        if (!(actor === null || actor === void 0 ? void 0 : actor.id)) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const owner = yield getOwnerFromRequest(req);
        if (!owner) {
            return res.status(403).json({ success: false, error: 'Unauthorized identity context' });
        }
        const planAccess = yield resolveOwnerReportEntitlements(owner);
        if (!planAccess.entitlements.canScheduleReports) {
            return res.status(403).json({
                success: false,
                error: 'Report scheduling is not available for this plan',
                message: 'Scheduled reports are available on Universal Signal.'
            });
        }
        const recipients = normalizeRecipients((_a = req.body) === null || _a === void 0 ? void 0 : _a.recipients);
        if (recipients.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one valid recipient is required' });
        }
        if (!(0, emailService_1.isEmailDeliveryConfigured)()) {
            return res.status(503).json({
                success: false,
                error: 'Email delivery is not configured. Add SENDGRID_API_KEY and sender settings on the backend.'
            });
        }
        const frequency = ((_b = req.body) === null || _b === void 0 ? void 0 : _b.frequency) === 'daily' || ((_c = req.body) === null || _c === void 0 ? void 0 : _c.frequency) === 'weekly' || ((_d = req.body) === null || _d === void 0 ? void 0 : _d.frequency) === 'monthly'
            ? req.body.frequency
            : 'weekly';
        const scope = ((_e = req.body) === null || _e === void 0 ? void 0 : _e.scope) === 'company_signals' || ((_f = req.body) === null || _f === void 0 ? void 0 : _f.scope) === 'specific_campaign' || ((_g = req.body) === null || _g === void 0 ? void 0 : _g.scope) === 'all_signals'
            ? req.body.scope
            : 'all_signals';
        const deliveryMode = ((_h = req.body) === null || _h === void 0 ? void 0 : _h.deliveryMode) === 'pdf_attachment' ? 'pdf_attachment' : 'inline_email';
        if (deliveryMode === 'pdf_attachment' && !planAccess.entitlements.canExportPdf) {
            return res.status(403).json({
                success: false,
                error: 'PDF report delivery is not available for this plan'
            });
        }
        const weeklyDay = ((_j = req.body) === null || _j === void 0 ? void 0 : _j.weeklyDay) && WEEKDAY_TO_INDEX[req.body.weeklyDay]
            ? req.body.weeklyDay
            : 'Monday';
        const monthlyDay = clampMonthlyDay((_k = req.body) === null || _k === void 0 ? void 0 : _k.monthlyDay);
        const time = normalizeTime((_l = req.body) === null || _l === void 0 ? void 0 : _l.time);
        const campaignName = typeof ((_m = req.body) === null || _m === void 0 ? void 0 : _m.campaignName) === 'string' ? req.body.campaignName.trim().slice(0, 120) : '';
        const nowIso = new Date().toISOString();
        const schedule = {
            id: `report-schedule-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            ownerId: owner.ownerId,
            ownerType: owner.ownerType,
            createdByUserId: actor.id,
            frequency,
            scope,
            recipients,
            deliveryMode,
            includeKPIs: toBoolean((_o = req.body) === null || _o === void 0 ? void 0 : _o.includeKPIs, true),
            includeTrends: toBoolean((_p = req.body) === null || _p === void 0 ? void 0 : _p.includeTrends, true),
            includeTopPosts: toBoolean((_q = req.body) === null || _q === void 0 ? void 0 : _q.includeTopPosts, true),
            includeEfficiency: toBoolean((_r = req.body) === null || _r === void 0 ? void 0 : _r.includeEfficiency, true),
            weeklyDay,
            monthlyDay,
            time,
            campaignName,
            timezone: typeof ((_s = req.body) === null || _s === void 0 ? void 0 : _s.timezone) === 'string' ? req.body.timezone.trim().slice(0, 80) : undefined,
            status: 'active',
            nextRunAt: computeNextRunAt({ frequency, weeklyDay, monthlyDay, time }),
            createdAt: nowIso,
            updatedAt: nowIso
        };
        const db = (0, db_1.getDB)();
        const existingCount = yield db.collection(REPORT_SCHEDULES_COLLECTION).countDocuments({
            ownerId: owner.ownerId,
            ownerType: owner.ownerType,
            status: 'active'
        });
        if (existingCount >= 20) {
            return res.status(400).json({ success: false, error: 'Maximum of 20 active schedules reached' });
        }
        yield db.collection(REPORT_SCHEDULES_COLLECTION).insertOne(schedule);
        return res.status(201).json({
            success: true,
            data: mapScheduleToResponse(schedule)
        });
    }
    catch (error) {
        console.error('Error creating report schedule:', error);
        return res.status(500).json({ success: false, error: 'Failed to create report schedule' });
    }
}));
router.delete('/schedules/:id', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const actor = req.user;
        const scheduleId = req.params.id;
        if (!(actor === null || actor === void 0 ? void 0 : actor.id)) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        if (!scheduleId) {
            return res.status(400).json({ success: false, error: 'Schedule id is required' });
        }
        const db = (0, db_1.getDB)();
        const schedule = yield db.collection(REPORT_SCHEDULES_COLLECTION).findOne({ id: scheduleId });
        if (!schedule) {
            return res.status(404).json({ success: false, error: 'Schedule not found' });
        }
        if (schedule.ownerType === 'user') {
            if (schedule.ownerId !== actor.id) {
                return res.status(403).json({ success: false, error: 'Unauthorized' });
            }
        }
        else {
            const hasAccess = yield (0, identityUtils_1.validateIdentityAccess)(actor.id, schedule.ownerId);
            if (!hasAccess) {
                return res.status(403).json({ success: false, error: 'Unauthorized' });
            }
        }
        yield db.collection(REPORT_SCHEDULES_COLLECTION).deleteOne({ id: scheduleId });
        return res.json({ success: true });
    }
    catch (error) {
        console.error('Error deleting report schedule:', error);
        return res.status(500).json({ success: false, error: 'Failed to delete report schedule' });
    }
}));
exports.default = router;
