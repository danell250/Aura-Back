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
exports.applicationNotesController = void 0;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const JOB_APPLICATION_NOTES_COLLECTION = 'application_notes';
const COMPANIES_COLLECTION = 'companies';
const COMPANY_MEMBERS_COLLECTION = 'company_members';
const USERS_COLLECTION = 'users';
const readString = (value, maxLength = 10000) => {
    if (typeof value !== 'string')
        return '';
    const normalized = value.trim();
    if (!normalized)
        return '';
    return normalized.slice(0, maxLength);
};
const readStringOrNull = (value, maxLength = 10000) => {
    const normalized = readString(value, maxLength);
    return normalized.length > 0 ? normalized : null;
};
const resolveUserDisplayName = (user) => {
    if (!user || typeof user !== 'object')
        return '';
    return (readString(user === null || user === void 0 ? void 0 : user.name, 160) ||
        `${readString(user === null || user === void 0 ? void 0 : user.firstName, 80)} ${readString(user === null || user === void 0 ? void 0 : user.lastName, 80)}`.trim());
};
const toApplicationNoteResponse = (note, authorName) => ({
    id: String((note === null || note === void 0 ? void 0 : note.id) || ''),
    applicationId: String((note === null || note === void 0 ? void 0 : note.applicationId) || ''),
    authorId: String((note === null || note === void 0 ? void 0 : note.authorId) || ''),
    authorName: authorName || readStringOrNull(note === null || note === void 0 ? void 0 : note.authorName, 160),
    content: String((note === null || note === void 0 ? void 0 : note.content) || ''),
    createdAt: (note === null || note === void 0 ? void 0 : note.createdAt) || null,
    updatedAt: (note === null || note === void 0 ? void 0 : note.updatedAt) || null,
});
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
        return { allowed: true, status: 200 };
    }
    const membership = yield db.collection(COMPANY_MEMBERS_COLLECTION).findOne({
        companyId,
        userId: authenticatedUserId,
        role: { $in: ['owner', 'admin'] },
    });
    if (!membership) {
        return { allowed: false, status: 403, error: 'Only company owner/admin can perform this action' };
    }
    return { allowed: true, status: 200 };
});
exports.applicationNotesController = {
    // GET /api/applications/:applicationId/notes
    listApplicationNotes: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const applicationId = readString(req.params.applicationId, 120);
            if (!applicationId) {
                return res.status(400).json({ success: false, error: 'applicationId is required' });
            }
            const db = (0, db_1.getDB)();
            const application = yield db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId }, { projection: { id: 1, companyId: 1 } });
            if (!application) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }
            const access = yield resolveOwnerAdminCompanyAccess(String(application.companyId || ''), currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const notes = yield db.collection(JOB_APPLICATION_NOTES_COLLECTION)
                .find({ applicationId })
                .sort({ createdAt: 1 })
                .limit(500)
                .toArray();
            if (notes.length === 0) {
                return res.json({ success: true, data: [] });
            }
            const authorIds = Array.from(new Set(notes
                .map((note) => readString(note === null || note === void 0 ? void 0 : note.authorId, 120))
                .filter((id) => id.length > 0)));
            const authorUsers = authorIds.length > 0
                ? yield db.collection(USERS_COLLECTION)
                    .find({ id: { $in: authorIds } })
                    .project({ id: 1, name: 1, firstName: 1, lastName: 1 })
                    .toArray()
                : [];
            const authorNameById = new Map(authorUsers.map((user) => [String((user === null || user === void 0 ? void 0 : user.id) || ''), resolveUserDisplayName(user)]));
            return res.json({
                success: true,
                data: notes.map((note) => toApplicationNoteResponse(note, authorNameById.get(String((note === null || note === void 0 ? void 0 : note.authorId) || '')) || null)),
            });
        }
        catch (error) {
            console.error('List application notes error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch application notes' });
        }
    }),
    // POST /api/applications/:applicationId/notes
    createApplicationNote: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const currentUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
            if (!currentUserId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const applicationId = readString(req.params.applicationId, 120);
            if (!applicationId) {
                return res.status(400).json({ success: false, error: 'applicationId is required' });
            }
            const content = readString((_b = req.body) === null || _b === void 0 ? void 0 : _b.content, 4000);
            if (!content) {
                return res.status(400).json({ success: false, error: 'Note content is required' });
            }
            const db = (0, db_1.getDB)();
            const application = yield db.collection(JOB_APPLICATIONS_COLLECTION).findOne({ id: applicationId }, { projection: { id: 1, jobId: 1, companyId: 1 } });
            if (!application) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }
            const access = yield resolveOwnerAdminCompanyAccess(String(application.companyId || ''), currentUserId);
            if (!access.allowed) {
                return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
            }
            const author = yield db.collection(USERS_COLLECTION).findOne({ id: currentUserId }, { projection: { name: 1, firstName: 1, lastName: 1 } });
            const authorName = resolveUserDisplayName(author) || null;
            const nowIso = new Date().toISOString();
            const note = {
                id: `jobnote-${Date.now()}-${crypto_1.default.randomBytes(4).toString('hex')}`,
                applicationId,
                jobId: readString(application.jobId, 120),
                companyId: readString(application.companyId, 120),
                authorId: currentUserId,
                authorName,
                content,
                createdAt: nowIso,
                updatedAt: nowIso,
            };
            yield db.collection(JOB_APPLICATION_NOTES_COLLECTION).insertOne(note);
            return res.status(201).json({
                success: true,
                data: toApplicationNoteResponse(note, authorName),
            });
        }
        catch (error) {
            console.error('Create application note error:', error);
            return res.status(500).json({ success: false, error: 'Failed to create application note' });
        }
    }),
};
