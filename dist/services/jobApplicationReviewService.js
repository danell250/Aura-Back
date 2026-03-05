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
exports.queueJobApplicationReviewEmails = void 0;
const crypto_1 = __importDefault(require("crypto"));
const emailService_1 = require("./emailService");
const COMPANIES_COLLECTION = 'companies';
const COMPANY_MEMBERS_COLLECTION = 'company_members';
const USERS_COLLECTION = 'users';
const JOB_APPLICATION_REVIEW_LINKS_COLLECTION = 'job_application_review_links';
const readString = (value, maxLength = 10000) => {
    if (typeof value !== 'string')
        return '';
    const normalized = value.trim();
    if (!normalized)
        return '';
    return normalized.slice(0, maxLength);
};
const hashSecureToken = (token) => crypto_1.default.createHash('sha256').update(token).digest('hex');
const getReviewLinkTtlHours = () => {
    const raw = Number(process.env.JOB_REVIEW_LINK_TTL_HOURS || 72);
    if (!Number.isFinite(raw))
        return 72;
    return Math.min(168, Math.max(1, Math.round(raw)));
};
const getReviewPortalBaseUrl = () => {
    const configured = readString(process.env.FRONTEND_URL || '', 300) ||
        readString(process.env.VITE_FRONTEND_URL || '', 300);
    return configured ? configured.replace(/\/$/, '') : 'https://www.aurasocial.world';
};
const buildReviewPortalUrl = (rawToken) => {
    const baseUrl = getReviewPortalBaseUrl();
    return `${baseUrl}/company/manage?applicationReviewToken=${encodeURIComponent(rawToken)}`;
};
const resolveJobReviewRecipients = (db, companyId) => __awaiter(void 0, void 0, void 0, function* () {
    if (!companyId)
        return { company: null, recipients: [] };
    const [company, memberRows] = yield Promise.all([
        db.collection(COMPANIES_COLLECTION).findOne({ id: companyId, legacyArchived: { $ne: true } }, { projection: { id: 1, name: 1, ownerId: 1 } }),
        db.collection(COMPANY_MEMBERS_COLLECTION)
            .find({ companyId, role: { $in: ['owner', 'admin'] } }, { projection: { userId: 1 } })
            .toArray(),
    ]);
    if (!company)
        return { company: null, recipients: [] };
    const reviewerIds = new Set();
    for (const member of memberRows) {
        const reviewerUserId = readString(member === null || member === void 0 ? void 0 : member.userId, 120);
        if (reviewerUserId)
            reviewerIds.add(reviewerUserId);
    }
    const ownerId = readString(company.ownerId, 120);
    if (ownerId)
        reviewerIds.add(ownerId);
    if (reviewerIds.size === 0) {
        return { company, recipients: [] };
    }
    const reviewerUsers = yield db.collection(USERS_COLLECTION)
        .find({ id: { $in: Array.from(reviewerIds) } })
        .project({ id: 1, email: 1, name: 1, firstName: 1, lastName: 1 })
        .toArray();
    const emailDedupe = new Set();
    const recipients = [];
    for (const reviewer of reviewerUsers) {
        const email = readString(reviewer === null || reviewer === void 0 ? void 0 : reviewer.email, 160).toLowerCase();
        if (!email || emailDedupe.has(email))
            continue;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            continue;
        emailDedupe.add(email);
        const displayName = readString(reviewer === null || reviewer === void 0 ? void 0 : reviewer.name, 120) ||
            `${readString(reviewer === null || reviewer === void 0 ? void 0 : reviewer.firstName, 80)} ${readString(reviewer === null || reviewer === void 0 ? void 0 : reviewer.lastName, 80)}`.trim() ||
            'Team';
        recipients.push({
            userId: String((reviewer === null || reviewer === void 0 ? void 0 : reviewer.id) || ''),
            email,
            displayName,
        });
    }
    return { company, recipients };
});
const queueJobApplicationReviewEmails = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const companyId = readString(params.companyId, 120);
    const jobId = readString(params.jobId, 120);
    const application = params.application;
    const job = params.job;
    if (!companyId || !jobId || !application || !job)
        return;
    const { company, recipients } = yield resolveJobReviewRecipients(params.db, companyId);
    if (!company || recipients.length === 0)
        return;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const ttlHours = getReviewLinkTtlHours();
    const expiresAtIso = new Date(now + ttlHours * 60 * 60 * 1000).toISOString();
    const linkRows = [];
    for (const recipient of recipients) {
        const rawToken = crypto_1.default.randomBytes(32).toString('hex');
        linkRows.push({
            recipient,
            rawToken,
            record: {
                id: `jobreview-${Date.now()}-${crypto_1.default.randomBytes(4).toString('hex')}`,
                tokenHash: hashSecureToken(rawToken),
                companyId,
                jobId,
                applicationId: String((application === null || application === void 0 ? void 0 : application.id) || ''),
                recipientUserId: recipient.userId,
                recipientEmail: recipient.email,
                createdAt: nowIso,
                expiresAt: expiresAtIso,
                lastResolvedAt: null,
                lastResolvedByUserId: null,
            },
        });
    }
    if (linkRows.length === 0)
        return;
    yield params.db.collection(JOB_APPLICATION_REVIEW_LINKS_COLLECTION).insertMany(linkRows.map((row) => row.record));
    yield Promise.allSettled(linkRows.map((row) => (0, emailService_1.sendJobApplicationReviewEmail)(row.recipient.email, {
        reviewerName: row.recipient.displayName,
        companyName: readString(company === null || company === void 0 ? void 0 : company.name, 160) || readString(job === null || job === void 0 ? void 0 : job.companyName, 160) || 'Aura Company',
        jobTitle: readString(job === null || job === void 0 ? void 0 : job.title, 160) || 'Open role',
        applicantName: readString(application === null || application === void 0 ? void 0 : application.applicantName, 160) || 'Applicant',
        applicantEmail: readString(application === null || application === void 0 ? void 0 : application.applicantEmail, 160),
        applicantPhone: readString(application === null || application === void 0 ? void 0 : application.applicantPhone, 60),
        submittedAt: readString(application === null || application === void 0 ? void 0 : application.createdAt, 80) || nowIso,
        securePortalUrl: buildReviewPortalUrl(row.rawToken),
        expiresAt: expiresAtIso,
    })));
});
exports.queueJobApplicationReviewEmails = queueJobApplicationReviewEmails;
