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
exports.scheduleJobApplicationPostCreateEffects = exports.incrementApplicantApplicationCount = exports.listOwnerAdminCompanyIdsForUser = exports.canReadJobApplication = exports.resolveOwnerAdminCompanyAccess = void 0;
const db_1 = require("../db");
const roomNames_1 = require("../realtime/roomNames");
const jobApplicationReviewService_1 = require("./jobApplicationReviewService");
const resumeEnrichmentQueueService_1 = require("./resumeEnrichmentQueueService");
const resumeParsingService_1 = require("./resumeParsingService");
const userBadgeService_1 = require("./userBadgeService");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const COMPANIES_COLLECTION = 'companies';
const COMPANY_MEMBERS_COLLECTION = 'company_members';
const USERS_COLLECTION = 'users';
const resolveOwnerAdminCompanyAccess = (companyId, authenticatedUserId) => __awaiter(void 0, void 0, void 0, function* () {
    const db = (0, db_1.getDB)();
    const company = yield db.collection(COMPANIES_COLLECTION).findOne({
        id: companyId,
        legacyArchived: { $ne: true },
    });
    if (!company) {
        return { allowed: false, status: 404, error: 'Company not found' };
    }
    if (company.ownerId === authenticatedUserId) {
        return { allowed: true, status: 200, company };
    }
    const membership = yield db.collection(COMPANY_MEMBERS_COLLECTION).findOne({
        companyId,
        userId: authenticatedUserId,
        role: { $in: ['owner', 'admin'] },
    });
    if (!membership) {
        return { allowed: false, status: 403, error: 'Only company owner/admin can perform this action' };
    }
    return { allowed: true, status: 200, company };
});
exports.resolveOwnerAdminCompanyAccess = resolveOwnerAdminCompanyAccess;
const canReadJobApplication = (application, authenticatedUserId) => __awaiter(void 0, void 0, void 0, function* () {
    if (!application)
        return false;
    const applicantUserId = (0, inputSanitizers_1.readString)(application === null || application === void 0 ? void 0 : application.applicantUserId, 120);
    if (applicantUserId && applicantUserId === authenticatedUserId)
        return true;
    const companyId = (0, inputSanitizers_1.readString)(application === null || application === void 0 ? void 0 : application.companyId, 120);
    if (!companyId)
        return false;
    const access = yield (0, exports.resolveOwnerAdminCompanyAccess)(companyId, authenticatedUserId);
    return access.allowed;
});
exports.canReadJobApplication = canReadJobApplication;
const listOwnerAdminCompanyIdsForUser = (authenticatedUserId) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = (0, inputSanitizers_1.readString)(authenticatedUserId, 120);
    if (!userId)
        return [];
    const db = (0, db_1.getDB)();
    const [ownedCompanies, memberships] = yield Promise.all([
        db.collection(COMPANIES_COLLECTION).find({
            ownerId: userId,
            legacyArchived: { $ne: true },
        }, { projection: { id: 1 } }).toArray(),
        db.collection(COMPANY_MEMBERS_COLLECTION).find({
            userId,
            role: { $in: ['owner', 'admin'] },
        }, { projection: { companyId: 1 } }).toArray(),
    ]);
    return Array.from(new Set([
        ...ownedCompanies.map((company) => (0, inputSanitizers_1.readString)(company === null || company === void 0 ? void 0 : company.id, 120)),
        ...memberships.map((membership) => (0, inputSanitizers_1.readString)(membership === null || membership === void 0 ? void 0 : membership.companyId, 120)),
    ].filter((companyId) => companyId.length > 0)));
});
exports.listOwnerAdminCompanyIdsForUser = listOwnerAdminCompanyIdsForUser;
const incrementApplicantApplicationCount = (db, userId, nowIso) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const updateResult = yield db.collection(USERS_COLLECTION).findOneAndUpdate({ id: userId }, {
            $inc: { jobApplicationsCount: 1 },
            $set: { updatedAt: nowIso },
        }, {
            returnDocument: 'after',
            projection: { jobApplicationsCount: 1 },
        });
        const updatedUser = (_a = updateResult === null || updateResult === void 0 ? void 0 : updateResult.value) !== null && _a !== void 0 ? _a : updateResult;
        const parsedCount = Number(updatedUser === null || updatedUser === void 0 ? void 0 : updatedUser.jobApplicationsCount);
        return Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : null;
    }
    catch (counterError) {
        console.error('Increment user jobApplicationsCount error:', counterError);
        return null;
    }
});
exports.incrementApplicantApplicationCount = incrementApplicantApplicationCount;
const emitNewApplicationEvent = (req, params) => {
    const io = req.app.get('io');
    const targetCompanyId = (0, inputSanitizers_1.readString)(params.companyId, 120);
    if (!io || !targetCompanyId)
        return;
    io.to((0, roomNames_1.getCompanyApplicationRoom)(targetCompanyId)).emit('new_application', {
        applicationId: params.applicationId,
        jobTitle: params.jobTitle,
        applicantName: params.applicantName,
        companyId: targetCompanyId,
        createdAt: params.createdAt,
    });
};
const scheduleJobApplicationPostCreateEffects = (params) => {
    var _a;
    void (0, userBadgeService_1.awardApplicationMilestoneBadges)({
        db: params.db,
        userId: params.currentUserId,
        applicationId: params.application.id,
        applicationCount: (_a = params.applicantApplicationCount) !== null && _a !== void 0 ? _a : undefined,
    }).catch((badgeError) => {
        console.error('Award application milestone badges error:', badgeError);
    });
    emitNewApplicationEvent(params.req, {
        companyId: String(params.job.companyId || ''),
        applicationId: String(params.application.id || ''),
        jobTitle: String(params.job.title || ''),
        applicantName: String(params.application.applicantName || ''),
        createdAt: params.nowIso,
    });
    void (0, jobApplicationReviewService_1.queueJobApplicationReviewEmails)({
        db: params.db,
        companyId: String(params.job.companyId || ''),
        jobId: params.jobId,
        application: params.application,
        job: params.job,
    }).catch((emailError) => {
        console.error('Job application review email dispatch error:', emailError);
    });
    setImmediate(() => {
        (0, resumeEnrichmentQueueService_1.enqueueResumeEnrichmentJob)(() => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c;
            yield (0, resumeParsingService_1.enrichUserProfileFromResume)({
                db: params.db,
                userId: params.currentUserId,
                resumeKey: (0, inputSanitizers_1.readString)((_a = params.application) === null || _a === void 0 ? void 0 : _a.resumeKey, 600),
                resumeMimeType: (0, inputSanitizers_1.readString)((_b = params.application) === null || _b === void 0 ? void 0 : _b.resumeMimeType, 120).toLowerCase(),
                resumeFileName: (0, inputSanitizers_1.readString)((_c = params.application) === null || _c === void 0 ? void 0 : _c.resumeFileName, 200),
                source: 'job_application_submission',
            });
        }));
    });
};
exports.scheduleJobApplicationPostCreateEffects = scheduleJobApplicationPostCreateEffects;
