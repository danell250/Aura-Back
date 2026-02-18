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
exports.resolveMentionedIdentityIds = exports.normalizeTaggedIdentityIds = exports.extractMentionHandles = exports.normalizeMentionHandle = void 0;
const MENTION_HANDLE_PATTERN = /(^|[^a-zA-Z0-9_])@([a-zA-Z0-9_-]{3,21})(?=$|[^a-zA-Z0-9_-])/g;
const MENTION_CACHE_TTL_MS = 5 * 60 * 1000;
const mentionHandleCache = new Map();
const readMentionCache = (handle) => {
    const entry = mentionHandleCache.get(handle);
    if (!entry)
        return null;
    if (entry.expiresAt <= Date.now()) {
        mentionHandleCache.delete(handle);
        return null;
    }
    return entry.ids;
};
const writeMentionCache = (handle, ids) => {
    mentionHandleCache.set(handle, {
        ids: Array.from(new Set(ids)),
        expiresAt: Date.now() + MENTION_CACHE_TTL_MS,
    });
};
const normalizeMentionHandle = (rawHandle) => {
    if (typeof rawHandle !== 'string')
        return '';
    const base = rawHandle.trim().toLowerCase();
    if (!base)
        return '';
    const withoutAt = base.startsWith('@') ? base.slice(1) : base;
    const cleaned = withoutAt.replace(/[^a-z0-9_-]/g, '');
    if (!cleaned)
        return '';
    return `@${cleaned}`;
};
exports.normalizeMentionHandle = normalizeMentionHandle;
const extractMentionHandles = (text) => {
    if (typeof text !== 'string' || !text.trim())
        return [];
    const uniqueHandles = new Set();
    let match;
    const matcher = new RegExp(MENTION_HANDLE_PATTERN.source, 'g');
    while ((match = matcher.exec(text)) !== null) {
        const normalized = (0, exports.normalizeMentionHandle)(match[2]);
        if (normalized)
            uniqueHandles.add(normalized);
    }
    return Array.from(uniqueHandles);
};
exports.extractMentionHandles = extractMentionHandles;
const normalizeTaggedIdentityIds = (input) => {
    if (!Array.isArray(input))
        return [];
    const uniqueIds = new Set();
    for (const value of input) {
        const id = typeof value === 'string' ? value.trim() : '';
        if (id)
            uniqueIds.add(id);
    }
    return Array.from(uniqueIds);
};
exports.normalizeTaggedIdentityIds = normalizeTaggedIdentityIds;
const resolveMentionedIdentityIds = (db_1, text_1, ...args_1) => __awaiter(void 0, [db_1, text_1, ...args_1], void 0, function* (db, text, maxHandles = 8) {
    const handles = (0, exports.extractMentionHandles)(text).slice(0, Math.max(1, maxHandles));
    if (handles.length === 0)
        return [];
    const combinedIds = new Set();
    const missingHandles = [];
    for (const handle of handles) {
        const cachedIds = readMentionCache(handle);
        if (cachedIds) {
            for (const id of cachedIds) {
                if (id)
                    combinedIds.add(id);
            }
            continue;
        }
        missingHandles.push(handle);
    }
    if (missingHandles.length > 0) {
        const resolvedEntries = yield db.collection('users')
            .aggregate([
            { $match: { handle: { $in: missingHandles } } },
            { $project: { id: 1, handle: 1 } },
            {
                $unionWith: {
                    coll: 'companies',
                    pipeline: [
                        { $match: { handle: { $in: missingHandles }, legacyArchived: { $ne: true } } },
                        { $project: { id: 1, handle: 1 } },
                    ],
                },
            },
        ])
            .toArray();
        const idsByHandle = new Map();
        for (const handle of missingHandles) {
            idsByHandle.set(handle, []);
        }
        for (const entry of resolvedEntries) {
            const handle = (0, exports.normalizeMentionHandle)(entry === null || entry === void 0 ? void 0 : entry.handle);
            const id = typeof (entry === null || entry === void 0 ? void 0 : entry.id) === 'string' ? entry.id.trim() : '';
            if (!handle || !id)
                continue;
            const current = idsByHandle.get(handle) || [];
            current.push(id);
            idsByHandle.set(handle, current);
            combinedIds.add(id);
        }
        for (const [handle, ids] of idsByHandle.entries()) {
            writeMentionCache(handle, ids);
        }
    }
    return Array.from(combinedIds);
});
exports.resolveMentionedIdentityIds = resolveMentionedIdentityIds;
