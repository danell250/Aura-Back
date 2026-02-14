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
exports.resolveIdentityActor = exports.validateIdentityAccess = void 0;
const db_1 = require("../db");
/**
 * Validates if a user has access to a specific identity (personal or company).
 * @param userId The ID of the authenticated user
 * @param identityId The ID of the identity to check access for
 * @returns true if the user is the identity (personal) or a member of the company identity
 */
const validateIdentityAccess = (userId, identityId) => __awaiter(void 0, void 0, void 0, function* () {
    // 1. Personal Identity Check
    if (userId === identityId) {
        return true;
    }
    // 2. Company Identity Check
    const db = (0, db_1.getDB)();
    // Check company_members collection for membership (owner, admin, member)
    const membership = yield db.collection('company_members').findOne({
        userId: userId,
        companyId: identityId
    });
    if (membership) {
        return true;
    }
    // 3. Legacy Company Check (where user is the owner and the company ID matches user ID)
    // This is for cases where the user has a companyName but isn't explicitly in company_members yet
    const user = yield db.collection('users').findOne({ id: userId });
    if ((user === null || user === void 0 ? void 0 : user.companyName) && userId === identityId) {
        return true;
    }
    return false;
});
exports.validateIdentityAccess = validateIdentityAccess;
/**
 * Resolves the effective identity actor for a request.
 * @param authenticatedUserId The ID of the authenticated user (from req.user.id)
 * @param params Object containing ownerType and ownerId (usually from req.body or req.query)
 * @param headers Optional request headers to check for x-identity-id and x-identity-type
 * @returns IdentityActor or null if unauthorized
 */
const resolveIdentityActor = (authenticatedUserId, params, headers) => __awaiter(void 0, void 0, void 0, function* () {
    let ownerType = params.ownerType || 'user';
    let ownerId = params.ownerId;
    // Prioritize headers if present
    if (headers) {
        if (headers['x-identity-type']) {
            ownerType = headers['x-identity-type'];
        }
        if (headers['x-identity-id']) {
            ownerId = headers['x-identity-id'];
        }
    }
    // If company context is requested
    if (ownerType === 'company' && ownerId) {
        const hasAccess = yield (0, exports.validateIdentityAccess)(authenticatedUserId, ownerId);
        if (!hasAccess)
            return null;
        return { type: 'company', id: ownerId };
    }
    // Default to personal user identity
    return { type: 'user', id: authenticatedUserId };
});
exports.resolveIdentityActor = resolveIdentityActor;
