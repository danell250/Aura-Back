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
exports.generateUniqueHandle = exports.validateHandleFormat = exports.findUserByEmailAndMagicLinkHash = exports.findUserByEmail = exports.normalizeUserHandle = void 0;
const db_1 = require("../db");
const normalizeUserHandle = (rawHandle) => {
    const base = (rawHandle || '').trim().toLowerCase();
    const withoutAt = base.startsWith('@') ? base.slice(1) : base;
    const cleaned = withoutAt.replace(/[^a-z0-9_-]/g, '');
    if (!cleaned)
        return '';
    return `@${cleaned}`;
};
exports.normalizeUserHandle = normalizeUserHandle;
const findUserByEmail = (email) => __awaiter(void 0, void 0, void 0, function* () {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail)
        return null;
    const db = (0, db_1.getDB)();
    return db.collection('users').findOne({ email: normalizedEmail }, { collation: { locale: 'en', strength: 2 } });
});
exports.findUserByEmail = findUserByEmail;
const findUserByEmailAndMagicLinkHash = (email, tokenHash) => __awaiter(void 0, void 0, void 0, function* () {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedHash = String(tokenHash || '').trim().toLowerCase();
    if (!normalizedEmail || !normalizedHash)
        return null;
    const db = (0, db_1.getDB)();
    return db.collection('users').findOne({ email: normalizedEmail, magicLinkTokenHash: normalizedHash }, { collation: { locale: 'en', strength: 2 } });
});
exports.findUserByEmailAndMagicLinkHash = findUserByEmailAndMagicLinkHash;
const validateHandleFormat = (handle) => {
    const normalized = (0, exports.normalizeUserHandle)(handle);
    if (!normalized) {
        return { ok: false, message: 'Handle is required' };
    }
    const core = normalized.slice(1);
    if (core.length < 3 || core.length > 21) {
        return { ok: false, message: 'Handle must be between 3 and 21 characters' };
    }
    if (!/^[a-z0-9_-]+$/.test(core)) {
        return { ok: false, message: 'Handle can only use letters, numbers, underscores and hyphens' };
    }
    return { ok: true };
};
exports.validateHandleFormat = validateHandleFormat;
const generateUniqueHandle = (firstName, lastName) => __awaiter(void 0, void 0, void 0, function* () {
    const db = (0, db_1.getDB)();
    const firstNameSafe = (firstName || 'user').toLowerCase().trim().replace(/\s+/g, '');
    const lastNameSafe = (lastName || '').toLowerCase().trim().replace(/\s+/g, '');
    const baseHandle = `@${firstNameSafe}${lastNameSafe}`;
    try {
        const existingUser = yield db.collection('users').findOne({ handle: baseHandle });
        const existingCompany = yield db.collection('companies').findOne({ handle: baseHandle });
        if (!existingUser && !existingCompany) {
            console.log('✓ Handle available:', baseHandle);
            return baseHandle;
        }
    }
    catch (error) {
        console.error('Error checking base handle:', error);
    }
    const MAX_RANDOM_ATTEMPTS = 50;
    const BATCH_SIZE = 10;
    const generatedCandidates = new Set();
    for (let offset = 0; offset < MAX_RANDOM_ATTEMPTS; offset += BATCH_SIZE) {
        const batch = [];
        while (batch.length < BATCH_SIZE && generatedCandidates.size < MAX_RANDOM_ATTEMPTS) {
            const randomNum = Math.floor(Math.random() * 100000);
            const candidateHandle = `${baseHandle}${randomNum}`;
            if (!generatedCandidates.has(candidateHandle)) {
                generatedCandidates.add(candidateHandle);
                batch.push(candidateHandle);
            }
        }
        if (!batch.length)
            break;
        try {
            const [existingUsers, existingCompanies] = yield Promise.all([
                db.collection('users').find({ handle: { $in: batch } }, { projection: { handle: 1, _id: 0 } }).toArray(),
                db.collection('companies').find({ handle: { $in: batch } }, { projection: { handle: 1, _id: 0 } }).toArray(),
            ]);
            const takenHandles = new Set([
                ...existingUsers.map((entry) => String((entry === null || entry === void 0 ? void 0 : entry.handle) || '')),
                ...existingCompanies.map((entry) => String((entry === null || entry === void 0 ? void 0 : entry.handle) || '')),
            ]);
            const availableHandle = batch.find((candidate) => !takenHandles.has(candidate));
            if (availableHandle) {
                console.log('✓ Handle available:', availableHandle);
                return availableHandle;
            }
        }
        catch (error) {
            console.error('Error checking handle batch availability:', error);
        }
    }
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 9);
    const fallbackHandle = `@user${timestamp}${randomStr}`;
    console.log('⚠ Using fallback handle:', fallbackHandle);
    return fallbackHandle;
});
exports.generateUniqueHandle = generateUniqueHandle;
