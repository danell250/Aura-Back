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
exports.profileAnalyticsController = void 0;
const db_1 = require("../db");
const postsController_1 = require("./postsController");
const notificationsController_1 = require("./notificationsController");
const identityUtils_1 = require("../utils/identityUtils");
const openToWorkMetricsService_1 = require("../services/openToWorkMetricsService");
exports.profileAnalyticsController = {
    // POST /api/privacy/profile-view - Record profile view (if user allows it)
    recordProfileView: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const authenticatedUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            const { profileOwnerId } = req.body;
            if (!authenticatedUserId) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
            }
            if (!profileOwnerId) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'profileOwnerId is required'
                });
            }
            const db = (0, db_1.getDB)();
            const [userOwner, companyOwner] = yield Promise.all([
                db.collection('users').findOne({ id: profileOwnerId }),
                db.collection('companies').findOne({ id: profileOwnerId, legacyArchived: { $ne: true } }),
            ]);
            const ownerType = userOwner ? 'user' : 'company';
            const ownerCollection = ownerType === 'user' ? 'users' : 'companies';
            const profileOwner = userOwner || companyOwner;
            if (!profileOwner) {
                return res.status(404).json({
                    success: false,
                    error: 'Profile owner not found'
                });
            }
            if (ownerType === 'company') {
                const isCompanyOwner = String((profileOwner === null || profileOwner === void 0 ? void 0 : profileOwner.ownerId) || '') === authenticatedUserId;
                const companyMembership = yield db.collection('company_members').findOne({ companyId: profileOwnerId, userId: authenticatedUserId }, { projection: { _id: 1 } });
                if (isCompanyOwner || companyMembership) {
                    return res.json({
                        success: true,
                        message: 'Skipped profile view tracking for internal company view'
                    });
                }
            }
            if (ownerType === 'user' && profileOwnerId === authenticatedUserId) {
                return res.json({
                    success: true,
                    message: 'Skipped profile view tracking for self-view'
                });
            }
            const privacySettings = ownerType === 'user' ? (profileOwner.privacySettings || {}) : {};
            if (ownerType === 'user' && !privacySettings.showProfileViews && privacySettings.showProfileViews !== undefined) {
                return res.json({
                    success: true,
                    message: 'Profile view not recorded - user has disabled profile view tracking'
                });
            }
            const viewerIdentity = yield (0, identityUtils_1.resolveIdentityActor)(authenticatedUserId, {}, req.headers);
            if (!viewerIdentity) {
                return res.status(403).json({
                    success: false,
                    error: 'Forbidden',
                    message: 'Unauthorized identity context for profile view tracking',
                });
            }
            const viewer = yield db.collection('users').findOne({ id: authenticatedUserId });
            if (!viewer) {
                return res.status(404).json({
                    success: false,
                    error: 'Viewer not found'
                });
            }
            const viewerActor = viewerIdentity.type === 'company'
                ? yield db.collection('companies').findOne({ id: viewerIdentity.id, legacyArchived: { $ne: true } }, { projection: { id: 1, name: 1, handle: 1 } })
                : viewer;
            if (!viewerActor) {
                return res.status(404).json({
                    success: false,
                    error: 'Viewer identity not found'
                });
            }
            const profileViews = Array.isArray(profileOwner.profileViews) ? [...profileOwner.profileViews] : [];
            const shouldAddProfileView = !profileViews.includes(authenticatedUserId);
            if (shouldAddProfileView) {
                profileViews.push(authenticatedUserId);
                yield db.collection(ownerCollection).updateOne({ id: profileOwnerId }, {
                    $set: {
                        profileViews,
                        updatedAt: new Date().toISOString()
                    }
                });
            }
            const existingRecentViewNotice = yield db.collection('notifications').findOne({
                ownerType,
                ownerId: profileOwnerId,
                type: 'profile_view',
                'fromUser.id': String((viewerActor === null || viewerActor === void 0 ? void 0 : viewerActor.id) || ''),
                timestamp: { $gte: Date.now() - 60 * 60 * 1000 },
            }, { projection: { id: 1 } });
            if (existingRecentViewNotice) {
                return res.json({
                    success: true,
                    data: {
                        profileOwnerId,
                        viewerId: authenticatedUserId,
                        totalViews: profileViews.length
                    },
                    message: 'Profile view already recorded recently'
                });
            }
            yield (0, notificationsController_1.createNotificationInDB)(profileOwnerId, 'profile_view', String((viewerActor === null || viewerActor === void 0 ? void 0 : viewerActor.id) || ''), 'viewed your profile', undefined, undefined, {
                viewedBy: viewer.id,
                viewerUserId: viewer.id,
                viewerIdentityType: viewerIdentity.type,
                viewerCompanyId: viewerIdentity.type === 'company' ? viewerIdentity.id : undefined,
            }, undefined, ownerType);
            if (ownerType === 'user') {
                yield (0, openToWorkMetricsService_1.recordOpenToWorkProfileViewMetric)({
                    db,
                    userId: profileOwnerId,
                    viewerIdentityType: viewerIdentity.type,
                });
            }
            if (shouldAddProfileView) {
                (0, postsController_1.emitAuthorInsightsUpdate)(req.app, profileOwnerId, ownerType);
            }
            return res.json({
                success: true,
                data: {
                    profileOwnerId,
                    viewerId: authenticatedUserId,
                    totalViews: profileViews.length
                },
                message: 'Profile view recorded successfully'
            });
        }
        catch (error) {
            console.error('Error recording profile view:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to record profile view',
                message: 'Internal server error'
            });
        }
    }),
};
