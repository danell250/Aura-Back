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
exports.enrichUserProfileFromResume = void 0;
const resumeTextExtractionService_1 = require("./resumeTextExtractionService");
const resumeStorageService_1 = require("./resumeStorageService");
const USERS_COLLECTION = 'users';
const readString = (value, maxLength = 10000) => {
    if (typeof value !== 'string')
        return '';
    const normalized = value.trim();
    if (!normalized)
        return '';
    return normalized.slice(0, maxLength);
};
const buildResumeInsights = (params) => ({
    parsedAt: params.nowIso,
    parser: params.parsed.parser,
    source: readString(params.source, 80) || 'resume_upload',
    resumeKey: params.resumeKey,
    resumeMimeType: params.resumeMimeType,
    resumeFileName: readString(params.resumeFileName, 200) || null,
    extractedEmail: params.parsed.email,
    extractedName: params.parsed.inferredName,
    extractedSkills: params.parsed.skills,
});
const persistUserResumeUpdates = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const nowIso = new Date().toISOString();
    const resumeInsights = buildResumeInsights({
        parsed: params.parsed,
        resumeKey: params.resumeKey,
        resumeMimeType: params.resumeMimeType,
        resumeFileName: params.resumeFileName,
        source: params.source,
        nowIso,
    });
    const parsedSkills = params.parsed.skills.slice(0, 100);
    const updateDoc = {
        $set: {
            updatedAt: nowIso,
            resumeInsights,
        },
    };
    if (parsedSkills.length > 0) {
        updateDoc.$addToSet = {
            skills: { $each: parsedSkills },
            profileSkills: { $each: parsedSkills },
        };
    }
    yield params.db.collection(USERS_COLLECTION).updateOne({ id: params.userId }, updateDoc);
});
const normalizeResumeEnrichmentInput = (params) => {
    const normalized = {
        userId: readString(params.userId, 120),
        resumeKey: readString(params.resumeKey, 600),
        resumeMimeType: readString(params.resumeMimeType, 120).toLowerCase(),
        resumeFileName: readString(params.resumeFileName, 200),
        source: readString(params.source, 80),
    };
    if (!normalized.userId
        || !normalized.resumeKey
        || !normalized.resumeMimeType
        || !resumeTextExtractionService_1.RESUME_SUPPORTED_MIME_TYPES.has(normalized.resumeMimeType)) {
        return null;
    }
    return normalized;
};
const parseResumeFromStorage = (db, input) => __awaiter(void 0, void 0, void 0, function* () {
    const fileBuffer = yield (0, resumeStorageService_1.resolveResumeBuffer)({ db, resumeKey: input.resumeKey });
    if (!fileBuffer)
        return null;
    const parsed = yield (0, resumeTextExtractionService_1.parseResumeBuffer)(fileBuffer, input.resumeMimeType);
    if (!parsed.fullText && parsed.skills.length === 0 && !parsed.email)
        return null;
    return parsed;
});
const enrichUserProfileFromResume = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const normalizedInput = normalizeResumeEnrichmentInput(params);
    if (!normalizedInput)
        return;
    const parsed = yield parseResumeFromStorage(params.db, normalizedInput);
    if (!parsed)
        return;
    yield persistUserResumeUpdates({
        db: params.db,
        userId: normalizedInput.userId,
        parsed,
        resumeKey: normalizedInput.resumeKey,
        resumeMimeType: normalizedInput.resumeMimeType,
        resumeFileName: normalizedInput.resumeFileName,
        source: normalizedInput.source,
    });
});
exports.enrichUserProfileFromResume = enrichUserProfileFromResume;
