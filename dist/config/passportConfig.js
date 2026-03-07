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
exports.configurePassportStrategies = void 0;
const passport_1 = __importDefault(require("passport"));
const passport_google_oauth20_1 = require("passport-google-oauth20");
const passport_github2_1 = require("passport-github2");
const db_1 = require("../db");
const userUtils_1 = require("../utils/userUtils");
const publicWebUrl_1 = require("../utils/publicWebUrl");
const configurePassportStrategies = () => {
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        passport_1.default.use(new passport_google_oauth20_1.Strategy({
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL ||
                (0, publicWebUrl_1.buildPublicAuthCallbackUrl)('google'),
        }, (_accessToken, _refreshToken, profile, done) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            try {
                const displayName = profile.displayName || '';
                const nameParts = displayName.trim().split(/\s+/);
                const firstName = nameParts[0] || 'User';
                const lastName = nameParts.slice(1).join(' ') || '';
                const email = (_b = (_a = profile.emails) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.value;
                const isVerified = (_d = (_c = profile.emails) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.verified;
                if (!email) {
                    return done(new Error('Google account does not have an email address'), undefined);
                }
                if (isVerified === false) {
                    return done(new Error('Google email is not verified. Please verify your email on Google.'), undefined);
                }
                const user = {
                    id: profile.id,
                    googleId: profile.id,
                    firstName,
                    lastName,
                    name: displayName || `${firstName} ${lastName}`.trim(),
                    email: email.toLowerCase().trim(),
                    avatar: ((_f = (_e = profile.photos) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.value) || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.id}`,
                    avatarType: 'image',
                    handle: `@${firstName.toLowerCase()}${lastName.toLowerCase().replace(/\s+/g, '')}${Math.floor(Math.random() * 10000)}`,
                    bio: 'New to Aura©',
                    industry: 'Other',
                    companyName: '',
                    phone: '',
                    dob: '',
                    acquaintances: [],
                    blockedUsers: [],
                    trustScore: 10,
                    auraCredits: 100,
                    activeGlow: 'none',
                };
                return done(null, user);
            }
            catch (error) {
                console.error('Error in Google OAuth strategy:', error);
                return done(error, undefined);
            }
        })));
    }
    else {
        console.warn('⚠️ Google OAuth environment variables not found. Google login will not be available.');
    }
    passport_1.default.serializeUser((user, done) => {
        done(null, user.id);
    });
    passport_1.default.deserializeUser((id, done) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const db = (0, db_1.getDB)();
            const user = yield db.collection('users').findOne({ id });
            if (user) {
                done(null, (0, userUtils_1.transformUser)(user));
            }
            else {
                done(null, false);
            }
        }
        catch (error) {
            console.error('Error deserializing user:', error);
            done(error, null);
        }
    }));
    if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
        passport_1.default.use(new passport_github2_1.Strategy({
            clientID: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            callbackURL: process.env.GITHUB_CALLBACK_URL || (0, publicWebUrl_1.buildPublicAuthCallbackUrl)('github'),
            scope: ['user:email'],
        }, (_accessToken, _refreshToken, profile, done) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            try {
                const displayName = profile.displayName || '';
                const username = profile.username || 'githubuser';
                const nameParts = displayName.trim().split(/\s+/);
                const firstName = nameParts[0] || username;
                const lastName = nameParts.slice(1).join(' ') || '';
                const emailObj = (_a = profile.emails) === null || _a === void 0 ? void 0 : _a[0];
                const email = (emailObj && emailObj.value) || `${username}@github`;
                if (emailObj && emailObj.verified === false) {
                    return done(new Error('GitHub email is not verified. Please verify your email on GitHub.'), undefined);
                }
                const user = {
                    id: profile.id,
                    githubId: profile.id,
                    firstName,
                    lastName,
                    name: displayName || username,
                    email: email.toLowerCase().trim(),
                    avatar: (profile.photos && profile.photos[0] && profile.photos[0].value) ||
                        `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.id}`,
                    avatarType: 'image',
                    handle: `@${username.toLowerCase()}${Math.floor(Math.random() * 10000)}`,
                    bio: 'New to Aura©',
                    industry: 'Other',
                    companyName: '',
                    phone: '',
                    dob: '',
                    acquaintances: [],
                    blockedUsers: [],
                    trustScore: 10,
                    auraCredits: 100,
                    activeGlow: 'none',
                };
                return done(null, user);
            }
            catch (error) {
                console.error('Error in GitHub OAuth strategy:', error);
                return done(error, undefined);
            }
        })));
    }
    else {
        console.warn('⚠️ GitHub OAuth environment variables not found. GitHub login will not be available.');
    }
};
exports.configurePassportStrategies = configurePassportStrategies;
