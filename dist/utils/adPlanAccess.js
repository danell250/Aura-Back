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
exports.resolveOwnerPlanAccess = exports.findActiveSubscriptionForOwner = exports.buildActiveSubscriptionQuery = void 0;
const adPlans_1 = require("../constants/adPlans");
const adSubscriptionsController_1 = require("../controllers/adSubscriptionsController");
const companyAccess_1 = require("./companyAccess");
const buildActiveSubscriptionQuery = (ownerId, ownerType, now = Date.now()) => {
    const query = {
        status: 'active',
        $or: [
            { endDate: { $exists: false } },
            { endDate: { $gt: now } }
        ],
        $and: [
            {
                $or: [
                    { ownerId, ownerType },
                    { userId: ownerId, ownerType } // backward compatibility
                ]
            }
        ]
    };
    if (ownerType === 'user') {
        query.$and[0].$or.push({ userId: ownerId, ownerType: { $exists: false } });
    }
    return query;
};
exports.buildActiveSubscriptionQuery = buildActiveSubscriptionQuery;
const findActiveSubscriptionForOwner = (db_1, ownerId_1, ownerType_1, ...args_1) => __awaiter(void 0, [db_1, ownerId_1, ownerType_1, ...args_1], void 0, function* (db, ownerId, ownerType, now = Date.now(), options) {
    const subscription = yield db.collection('adSubscriptions').findOne((0, exports.buildActiveSubscriptionQuery)(ownerId, ownerType, now), (options === null || options === void 0 ? void 0 : options.projection) ? { projection: options.projection } : undefined);
    if (!subscription)
        return null;
    if (options === null || options === void 0 ? void 0 : options.refreshPeriod) {
        return (0, adSubscriptionsController_1.ensureCurrentPeriod)(db, subscription);
    }
    return subscription;
});
exports.findActiveSubscriptionForOwner = findActiveSubscriptionForOwner;
const resolveOwnerPlanAccess = (db_1, ownerId_1, ownerType_1, ...args_1) => __awaiter(void 0, [db_1, ownerId_1, ownerType_1, ...args_1], void 0, function* (db, ownerId, ownerType, now = Date.now(), options) {
    const complimentaryAccess = (0, companyAccess_1.hasFullCompanyAccess)(ownerType, ownerId);
    if (complimentaryAccess) {
        return {
            packageId: 'pkg-enterprise',
            entitlements: (0, adPlans_1.getPlanEntitlements)('pkg-enterprise'),
            subscription: null,
            complimentaryAccess: true
        };
    }
    const subscription = yield (0, exports.findActiveSubscriptionForOwner)(db, ownerId, ownerType, now, { refreshPeriod: options === null || options === void 0 ? void 0 : options.refreshPeriod });
    const packageId = (typeof (subscription === null || subscription === void 0 ? void 0 : subscription.packageId) === 'string' && adPlans_1.AD_PLANS[subscription.packageId])
        ? subscription.packageId
        : 'pkg-starter';
    return {
        packageId,
        entitlements: (0, adPlans_1.getPlanEntitlements)(packageId),
        subscription,
        complimentaryAccess: false
    };
});
exports.resolveOwnerPlanAccess = resolveOwnerPlanAccess;
