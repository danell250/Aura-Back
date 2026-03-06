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
exports.listApplicantJobApplications = void 0;
const jobApplicationResponseService_1 = require("./jobApplicationResponseService");
const jobResponseService_1 = require("./jobResponseService");
const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const JOBS_COLLECTION = 'jobs';
const COMPANIES_COLLECTION = 'companies';
const APPLICATION_PROJECTION = {
    id: 1,
    jobId: 1,
    companyId: 1,
    applicantUserId: 1,
    applicantName: 1,
    applicantEmail: 1,
    applicantPhone: 1,
    coverLetter: 1,
    portfolioUrl: 1,
    resumeKey: 1,
    resumeFileName: 1,
    resumeMimeType: 1,
    resumeSize: 1,
    status: 1,
    createdAt: 1,
    updatedAt: 1,
    reviewedByUserId: 1,
    reviewedAt: 1,
    statusNote: 1,
};
const JOB_LOOKUP_PROJECTION = {
    id: 1,
    companyId: 1,
    title: 1,
    slug: 1,
    source: 1,
    companyName: 1,
    companyHandle: 1,
    companyIsVerified: 1,
    companyWebsite: 1,
    companyEmail: 1,
    locationText: 1,
    workModel: 1,
    employmentType: 1,
    salaryMin: 1,
    salaryMax: 1,
    salaryCurrency: 1,
    status: 1,
    summary: 1,
    description: 1,
    discoveredAt: 1,
    publishedAt: 1,
    applicationDeadline: 1,
    applicationUrl: 1,
    applicationEmail: 1,
    applicationCount: 1,
    viewCount: 1,
    tags: 1,
    createdAt: 1,
    updatedAt: 1,
};
const COMPANY_LOOKUP_PROJECTION = {
    id: 1,
    name: 1,
    handle: 1,
    avatar: 1,
    avatarType: 1,
};
const buildApplicantJobApplicationsPipeline = (params) => {
    const filter = {
        applicantUserId: params.applicantUserId,
    };
    if (params.status) {
        filter.status = params.status;
    }
    return [
        { $match: filter },
        { $sort: { createdAt: -1 } },
        { $skip: params.skip },
        { $limit: params.limit },
        { $project: APPLICATION_PROJECTION },
        {
            $lookup: {
                from: JOBS_COLLECTION,
                let: { jobId: '$jobId' },
                pipeline: [
                    {
                        $match: {
                            $expr: { $eq: ['$id', '$$jobId'] },
                        },
                    },
                    {
                        $project: JOB_LOOKUP_PROJECTION,
                    },
                ],
                as: 'job',
            },
        },
        {
            $unwind: {
                path: '$job',
                preserveNullAndEmptyArrays: true,
            },
        },
        {
            $lookup: {
                from: COMPANIES_COLLECTION,
                let: { companyId: '$job.companyId' },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ['$id', '$$companyId'] },
                                    { $ne: ['$legacyArchived', true] },
                                ],
                            },
                        },
                    },
                    {
                        $project: COMPANY_LOOKUP_PROJECTION,
                    },
                ],
                as: 'company',
            },
        },
        {
            $unwind: {
                path: '$company',
                preserveNullAndEmptyArrays: true,
            },
        },
    ];
};
const toApplicantJobApplicationListItem = (application) => (Object.assign(Object.assign({}, (0, jobApplicationResponseService_1.toApplicationResponse)(application)), { job: (application === null || application === void 0 ? void 0 : application.job) ? (0, jobResponseService_1.toJobResponse)(application.job) : null, company: (0, jobApplicationResponseService_1.toApplicationCompanySummaryResponse)(application === null || application === void 0 ? void 0 : application.company) }));
const listApplicantJobApplications = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const filter = {
        applicantUserId: params.applicantUserId,
    };
    if (params.status) {
        filter.status = params.status;
    }
    const [items, total] = yield Promise.all([
        params.db.collection(JOB_APPLICATIONS_COLLECTION)
            .aggregate(buildApplicantJobApplicationsPipeline(params))
            .toArray(),
        params.db.collection(JOB_APPLICATIONS_COLLECTION).countDocuments(filter),
    ]);
    return {
        items: items.map(toApplicantJobApplicationListItem),
        total,
    };
});
exports.listApplicantJobApplications = listApplicantJobApplications;
