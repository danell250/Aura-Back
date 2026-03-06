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
exports.userOpportunityController = void 0;
const db_1 = require("../db");
const jobApplicationLifecycleService_1 = require("../services/jobApplicationLifecycleService");
const jobResumeStorageService_1 = require("../services/jobResumeStorageService");
const userOpportunityNotificationService_1 = require("../services/userOpportunityNotificationService");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const identityUtils_1 = require("../utils/identityUtils");
const readIdentityHeader = (value) => {
    if (typeof value === 'string')
        return value.trim();
    if (Array.isArray(value) && typeof value[0] === 'string')
        return value[0].trim();
    return '';
};
const resolveCompanyIdentityAccess = (req) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const authenticatedUserId = (0, inputSanitizers_1.readString)((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.id, 120);
    if (!authenticatedUserId) {
        return { ok: false, status: 401, error: 'Authentication required' };
    }
    const identityType = readIdentityHeader(req.headers['x-identity-type']);
    const requestedCompanyId = readIdentityHeader(req.headers['x-identity-id']);
    if (identityType !== 'company' || !requestedCompanyId) {
        return { ok: false, status: 403, error: 'Company identity context is required' };
    }
    const identityActor = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, { ownerType: 'company', ownerId: requestedCompanyId }, req.headers);
    if (!identityActor || identityActor.type !== 'company' || identityActor.id !== requestedCompanyId) {
        return { ok: false, status: 403, error: 'Unauthorized company identity context' };
    }
    const access = yield (0, jobApplicationLifecycleService_1.resolveOwnerAdminCompanyAccess)(identityActor.id, authenticatedUserId);
    if (!access.allowed || !access.company) {
        return { ok: false, status: access.status, error: access.error || 'Unauthorized company access' };
    }
    return {
        ok: true,
        status: 200,
        companyId: identityActor.id,
        company: access.company,
    };
});
const candidateAllowsCompanyOutreach = (candidate) => {
    if ((candidate === null || candidate === void 0 ? void 0 : candidate.openToWork) !== true)
        return false;
    const privacySettings = ((candidate === null || candidate === void 0 ? void 0 : candidate.privacySettings) && typeof candidate.privacySettings === 'object')
        ? candidate.privacySettings
        : {};
    const profileVisibility = (0, inputSanitizers_1.readString)(privacySettings === null || privacySettings === void 0 ? void 0 : privacySettings.profileVisibility, 40).toLowerCase();
    if (profileVisibility === 'private' || profileVisibility === 'friends') {
        return false;
    }
    if ((privacySettings === null || privacySettings === void 0 ? void 0 : privacySettings.showInSearch) === false) {
        return false;
    }
    return true;
};
exports.userOpportunityController = {
    // POST /api/users/:id/invite-to-apply
    inviteToApply: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            const candidateUserId = (0, inputSanitizers_1.readString)(req.params.id, 120);
            if (!candidateUserId) {
                return res.status(400).json({ success: false, error: 'Candidate user id is required' });
            }
            const companyAccess = yield resolveCompanyIdentityAccess(req);
            if (!companyAccess.ok || !companyAccess.companyId || !companyAccess.company) {
                return res.status(companyAccess.status).json({ success: false, error: companyAccess.error || 'Unauthorized' });
            }
            const db = (0, db_1.getDB)();
            const candidate = yield db.collection('users').findOne({ id: candidateUserId });
            if (!candidate) {
                return res.status(404).json({ success: false, error: 'Candidate not found' });
            }
            if (!candidateAllowsCompanyOutreach(candidate)) {
                return res.status(409).json({
                    success: false,
                    error: 'Candidate is not available for company outreach on Aura',
                });
            }
            const duplicateWindowMs = 7 * 24 * 60 * 60 * 1000;
            const existingInvite = yield db.collection('notifications').findOne({
                ownerType: 'user',
                ownerId: candidateUserId,
                type: 'invite_to_apply',
                'fromUser.id': companyAccess.companyId,
                timestamp: { $gte: Date.now() - duplicateWindowMs },
            }, { projection: { id: 1 } });
            if (existingInvite) {
                return res.status(409).json({
                    success: false,
                    error: 'This candidate was already invited recently',
                });
            }
            const inviterUserId = (0, inputSanitizers_1.readString)((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.id, 120);
            const notification = yield (0, userOpportunityNotificationService_1.createInviteToApplyNotification)({
                db,
                candidateUserId,
                companyId: companyAccess.companyId,
                companyHandle: (0, inputSanitizers_1.readString)((_b = companyAccess.company) === null || _b === void 0 ? void 0 : _b.handle, 120),
                invitedByUserId: inviterUserId,
            });
            return res.json({
                success: true,
                data: {
                    notificationId: String((notification === null || notification === void 0 ? void 0 : notification.id) || ''),
                    candidateUserId,
                    companyId: companyAccess.companyId,
                    createdAt: new Date().toISOString(),
                },
            });
        }
        catch (error) {
            console.error('Invite candidate to apply error:', error);
            return res.status(500).json({ success: false, error: 'Failed to send invite' });
        }
    }),
    // GET /api/users/:id/open-resume/view-url
    getOpenResumeViewUrl: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const targetUserId = (0, inputSanitizers_1.readString)(req.params.id, 120);
            const authenticatedUserId = (0, inputSanitizers_1.readString)((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.id, 120);
            if (!targetUserId || !authenticatedUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const db = (0, db_1.getDB)();
            const candidate = yield db.collection('users').findOne({ id: targetUserId });
            if (!candidate) {
                return res.status(404).json({ success: false, error: 'Candidate not found' });
            }
            const isSelf = authenticatedUserId === targetUserId;
            if (!isSelf) {
                const companyAccess = yield resolveCompanyIdentityAccess(req);
                if (!companyAccess.ok) {
                    return res.status(companyAccess.status).json({ success: false, error: companyAccess.error || 'Unauthorized' });
                }
                if (!candidateAllowsCompanyOutreach(candidate)) {
                    return res.status(409).json({ success: false, error: 'Candidate is not available for company outreach on Aura' });
                }
            }
            const resumeKey = (0, inputSanitizers_1.readString)(candidate === null || candidate === void 0 ? void 0 : candidate.resumeKey, 500) || (0, inputSanitizers_1.readString)(candidate === null || candidate === void 0 ? void 0 : candidate.defaultResumeKey, 500);
            if (!resumeKey) {
                return res.status(404).json({ success: false, error: 'Resume not available' });
            }
            const expiresInSeconds = 600;
            const url = yield (0, jobResumeStorageService_1.getApplicationResumeSignedUrl)(resumeKey, expiresInSeconds);
            if (!url) {
                return res.status(503).json({
                    success: false,
                    error: 'Resume preview service is not configured',
                });
            }
            return res.json({
                success: true,
                data: {
                    url,
                    expiresInSeconds,
                },
            });
        }
        catch (error) {
            console.error('Get open resume view URL error:', error);
            return res.status(500).json({ success: false, error: 'Failed to generate resume view URL' });
        }
    }),
};
