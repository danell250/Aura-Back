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
exports.clearLogoutCookies = exports.invalidateUserAuthSessions = exports.resolveLogoutUserId = void 0;
const db_1 = require("../db");
const jwtUtils_1 = require("./jwtUtils");
const resolveLogoutUserId = (req) => {
    var _a, _b, _c, _d, _e, _f;
    const attachedUserId = typeof ((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.id) === 'string' ? req.user.id.trim() : '';
    if (attachedUserId)
        return attachedUserId;
    const refreshToken = typeof ((_b = req.cookies) === null || _b === void 0 ? void 0 : _b.refreshToken) === 'string' ? req.cookies.refreshToken : '';
    if (refreshToken) {
        const decodedRefresh = (0, jwtUtils_1.verifyRefreshToken)(refreshToken);
        if (decodedRefresh === null || decodedRefresh === void 0 ? void 0 : decodedRefresh.id)
            return decodedRefresh.id;
    }
    const accessToken = typeof ((_c = req.cookies) === null || _c === void 0 ? void 0 : _c.accessToken) === 'string'
        ? req.cookies.accessToken
        : ((_d = req.headers.authorization) === null || _d === void 0 ? void 0 : _d.startsWith('Bearer '))
            ? req.headers.authorization.split(' ')[1]
            : '';
    if (accessToken) {
        const decodedAccess = (0, jwtUtils_1.verifyAccessToken)(accessToken);
        if (decodedAccess === null || decodedAccess === void 0 ? void 0 : decodedAccess.id)
            return decodedAccess.id;
    }
    const sessionUserId = (_f = (_e = req.session) === null || _e === void 0 ? void 0 : _e.passport) === null || _f === void 0 ? void 0 : _f.user;
    return typeof sessionUserId === 'string' && sessionUserId.trim().length > 0 ? sessionUserId : null;
};
exports.resolveLogoutUserId = resolveLogoutUserId;
const invalidateUserAuthSessions = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    const nowIso = new Date().toISOString();
    yield (0, db_1.getDB)().collection('users').updateOne({ id: userId }, {
        $set: {
            refreshTokens: [],
            authInvalidBefore: nowIso,
            lastActive: nowIso
        }
    });
});
exports.invalidateUserAuthSessions = invalidateUserAuthSessions;
const clearLogoutCookies = (res) => {
    (0, jwtUtils_1.clearTokenCookies)(res);
    res.clearCookie('connect.sid', { path: '/' });
    if (process.env.COOKIE_DOMAIN) {
        res.clearCookie('connect.sid', { path: '/', domain: process.env.COOKIE_DOMAIN });
    }
};
exports.clearLogoutCookies = clearLogoutCookies;
