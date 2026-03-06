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
exports.prepareJobApplicationSubmission = void 0;
const crypto_1 = __importDefault(require("crypto"));
const inputSanitizers_1 = require("../utils/inputSanitizers");
const jobApplicationResponseService_1 = require("./jobApplicationResponseService");
const JOBS_COLLECTION = 'jobs';
const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const USERS_COLLECTION = 'users';
const createJobApplicationWriteError = (statusCode, message) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};
const validateAndResolveApplicantIdentity = (params) => {
    var _a, _b, _c, _d, _e, _f;
    if (params.useProfile) {
        if (!params.profileUser) {
            throw createJobApplicationWriteError(400, 'Your Aura profile could not be loaded for this application');
        }
        const derivedProfileName = `${(0, inputSanitizers_1.readString)((_a = params.profileUser) === null || _a === void 0 ? void 0 : _a.firstName, 80)} ${(0, inputSanitizers_1.readString)((_b = params.profileUser) === null || _b === void 0 ? void 0 : _b.lastName, 80)}`.trim()
            || (0, inputSanitizers_1.readString)((_c = params.profileUser) === null || _c === void 0 ? void 0 : _c.name, 120);
        const derivedProfileEmail = (0, inputSanitizers_1.readString)((_d = params.profileUser) === null || _d === void 0 ? void 0 : _d.email, 160).toLowerCase();
        if (!derivedProfileName || !derivedProfileEmail) {
            throw createJobApplicationWriteError(400, 'Your Aura profile is missing a name or email. Update your profile and retry.');
        }
        return {
            applicantName: derivedProfileName,
            applicantEmail: derivedProfileEmail,
        };
    }
    return {
        applicantName: (0, inputSanitizers_1.readString)((_e = params.payload) === null || _e === void 0 ? void 0 : _e.applicantName, 120),
        applicantEmail: (0, inputSanitizers_1.readString)((_f = params.payload) === null || _f === void 0 ? void 0 : _f.applicantEmail, 160).toLowerCase(),
    };
};
const resolveResumePayload = (params) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    let resumeKey = (0, inputSanitizers_1.readString)((_a = params.payload) === null || _a === void 0 ? void 0 : _a.resumeKey, 500);
    let resumeFileName = (0, inputSanitizers_1.readString)((_b = params.payload) === null || _b === void 0 ? void 0 : _b.resumeFileName, 200);
    let resumeMimeType = (0, inputSanitizers_1.readString)((_c = params.payload) === null || _c === void 0 ? void 0 : _c.resumeMimeType, 120);
    let resumeSize = Number((_d = params.payload) === null || _d === void 0 ? void 0 : _d.resumeSize);
    if (params.useProfile && params.profileUser) {
        const defaultResumeKey = (0, inputSanitizers_1.readString)((_e = params.profileUser) === null || _e === void 0 ? void 0 : _e.defaultResumeKey, 500);
        if (defaultResumeKey) {
            resumeKey = defaultResumeKey;
            resumeFileName = (0, inputSanitizers_1.readString)((_f = params.profileUser) === null || _f === void 0 ? void 0 : _f.defaultResumeFileName, 200);
            resumeMimeType = (0, inputSanitizers_1.readString)((_g = params.profileUser) === null || _g === void 0 ? void 0 : _g.defaultResumeMimeType, 120);
            resumeSize = Number((_h = params.profileUser) === null || _h === void 0 ? void 0 : _h.defaultResumeSize);
        }
    }
    return {
        resumeKey,
        resumeFileName,
        resumeMimeType,
        resumeSize,
    };
};
const prepareJobApplicationSubmission = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const job = yield params.db.collection(JOBS_COLLECTION).findOne({ id: params.jobId });
    if (!job || job.status !== 'open') {
        throw createJobApplicationWriteError(404, 'Job not available for applications');
    }
    const duplicate = yield params.db.collection(JOB_APPLICATIONS_COLLECTION).findOne({
        jobId: params.jobId,
        applicantUserId: params.currentUserId,
    });
    if (duplicate) {
        throw createJobApplicationWriteError(409, 'You have already applied to this job');
    }
    const useProfile = Boolean((_a = params.payload) === null || _a === void 0 ? void 0 : _a.useProfile);
    const profileUser = useProfile
        ? yield params.db.collection(USERS_COLLECTION).findOne({ id: params.currentUserId }, {
            projection: {
                firstName: 1,
                lastName: 1,
                name: 1,
                email: 1,
                defaultResumeKey: 1,
                defaultResumeFileName: 1,
                defaultResumeMimeType: 1,
                defaultResumeSize: 1,
            },
        })
        : null;
    const applicantPhone = (0, inputSanitizers_1.readStringOrNull)((_b = params.payload) === null || _b === void 0 ? void 0 : _b.applicantPhone, 40);
    const coverLetter = (0, inputSanitizers_1.readStringOrNull)((_c = params.payload) === null || _c === void 0 ? void 0 : _c.coverLetter, 5000);
    const portfolioUrl = (0, inputSanitizers_1.readStringOrNull)((_d = params.payload) === null || _d === void 0 ? void 0 : _d.portfolioUrl, 300);
    const { applicantName, applicantEmail } = validateAndResolveApplicantIdentity({
        payload: params.payload,
        useProfile,
        profileUser,
    });
    const { resumeKey, resumeFileName, resumeMimeType, resumeSize } = resolveResumePayload({
        payload: params.payload,
        useProfile,
        profileUser,
    });
    if (useProfile && (!resumeKey || !resumeFileName || !resumeMimeType || !Number.isFinite(resumeSize) || resumeSize <= 0)) {
        throw createJobApplicationWriteError(400, 'No default resume found on your Aura profile. Add one in your profile and retry.');
    }
    if (!applicantName || !applicantEmail || !resumeKey || !resumeFileName || !resumeMimeType) {
        throw createJobApplicationWriteError(400, 'applicantName, applicantEmail, resumeKey, resumeFileName and resumeMimeType are required');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicantEmail)) {
        throw createJobApplicationWriteError(400, 'Invalid applicantEmail format');
    }
    if (!jobApplicationResponseService_1.ALLOWED_RESUME_MIME_TYPES.has(resumeMimeType)) {
        throw createJobApplicationWriteError(400, 'Unsupported resume file type');
    }
    if (!Number.isFinite(resumeSize) || resumeSize <= 0 || resumeSize > 10 * 1024 * 1024) {
        throw createJobApplicationWriteError(400, 'resumeSize must be between 1 byte and 10MB');
    }
    const nowIso = new Date().toISOString();
    const nowDate = new Date(nowIso);
    const application = {
        id: `jobapp-${Date.now()}-${crypto_1.default.randomBytes(4).toString('hex')}`,
        jobId: params.jobId,
        companyId: String(job.companyId || ''),
        jobTitleSnapshot: (0, inputSanitizers_1.readString)(job.title, 180) || null,
        applicantUserId: params.currentUserId,
        applicantName,
        applicantNameNormalized: applicantName.toLowerCase(),
        applicantEmail,
        applicantEmailNormalized: applicantEmail.toLowerCase(),
        applicantPhone,
        coverLetter,
        portfolioUrl,
        resumeKey,
        resumeFileName,
        resumeMimeType,
        resumeSize,
        status: 'submitted',
        createdAt: nowIso,
        createdAtDate: nowDate,
        updatedAt: nowIso,
        updatedAtDate: nowDate,
        reviewedByUserId: null,
        reviewedAt: null,
        reviewedAtDate: null,
        statusNote: null,
    };
    return {
        job,
        application,
        nowIso,
    };
});
exports.prepareJobApplicationSubmission = prepareJobApplicationSubmission;
