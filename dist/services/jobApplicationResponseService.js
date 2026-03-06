"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.toApplicationCompanySummaryResponse = exports.toApplicationResponse = exports.hashSecureToken = exports.ALLOWED_RESUME_MIME_TYPES = exports.ALLOWED_APPLICATION_STATUSES = void 0;
const crypto_1 = __importDefault(require("crypto"));
exports.ALLOWED_APPLICATION_STATUSES = new Set([
    'submitted',
    'in_review',
    'shortlisted',
    'rejected',
    'hired',
    'withdrawn',
]);
exports.ALLOWED_RESUME_MIME_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const hashSecureToken = (token) => crypto_1.default.createHash('sha256').update(token).digest('hex');
exports.hashSecureToken = hashSecureToken;
const toApplicationResponse = (application) => ({
    id: String((application === null || application === void 0 ? void 0 : application.id) || ''),
    jobId: String((application === null || application === void 0 ? void 0 : application.jobId) || ''),
    companyId: String((application === null || application === void 0 ? void 0 : application.companyId) || ''),
    applicantUserId: String((application === null || application === void 0 ? void 0 : application.applicantUserId) || ''),
    applicantName: String((application === null || application === void 0 ? void 0 : application.applicantName) || ''),
    applicantEmail: String((application === null || application === void 0 ? void 0 : application.applicantEmail) || ''),
    applicantPhone: String((application === null || application === void 0 ? void 0 : application.applicantPhone) || ''),
    coverLetter: String((application === null || application === void 0 ? void 0 : application.coverLetter) || ''),
    portfolioUrl: String((application === null || application === void 0 ? void 0 : application.portfolioUrl) || ''),
    resumeKey: String((application === null || application === void 0 ? void 0 : application.resumeKey) || ''),
    resumeFileName: String((application === null || application === void 0 ? void 0 : application.resumeFileName) || ''),
    resumeMimeType: String((application === null || application === void 0 ? void 0 : application.resumeMimeType) || ''),
    resumeSize: Number.isFinite(application === null || application === void 0 ? void 0 : application.resumeSize) ? Number(application.resumeSize) : 0,
    status: String((application === null || application === void 0 ? void 0 : application.status) || 'submitted'),
    createdAt: (application === null || application === void 0 ? void 0 : application.createdAt) || null,
    updatedAt: (application === null || application === void 0 ? void 0 : application.updatedAt) || null,
    reviewedByUserId: (application === null || application === void 0 ? void 0 : application.reviewedByUserId) || null,
    reviewedAt: (application === null || application === void 0 ? void 0 : application.reviewedAt) || null,
    statusNote: (application === null || application === void 0 ? void 0 : application.statusNote) || null,
});
exports.toApplicationResponse = toApplicationResponse;
const toApplicationCompanySummaryResponse = (company) => company
    ? {
        id: String(company.id || ''),
        name: String(company.name || ''),
        handle: String(company.handle || ''),
        avatar: String(company.avatar || ''),
        avatarType: String(company.avatarType || 'image'),
    }
    : null;
exports.toApplicationCompanySummaryResponse = toApplicationCompanySummaryResponse;
