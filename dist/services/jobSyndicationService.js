"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildJobsSyndicationFeed = void 0;
const readString = (value, maxLength = 10000) => {
    if (typeof value !== 'string')
        return '';
    const normalized = value.trim();
    if (!normalized)
        return '';
    return normalized.slice(0, maxLength);
};
const getFrontendBaseUrl = () => {
    const configured = readString(process.env.FRONTEND_URL || '', 300) ||
        readString(process.env.VITE_FRONTEND_URL || '', 300);
    return configured ? configured.replace(/\/$/, '') : 'https://www.aurasocial.world';
};
const getBackendBaseUrl = () => {
    const configured = readString(process.env.BACKEND_URL || '', 300) ||
        readString(process.env.PUBLIC_BACKEND_URL || '', 300);
    return configured ? configured.replace(/\/$/, '') : 'https://api.aurasocial.world';
};
const toCompactText = (value, maxLength = 16000) => readString(String(value || ''), maxLength).replace(/\s+/g, ' ').trim();
const toSyndicationItem = (job) => {
    const frontendBaseUrl = getFrontendBaseUrl();
    const slug = readString(job === null || job === void 0 ? void 0 : job.slug, 220) || readString(job === null || job === void 0 ? void 0 : job.id, 220) || 'job';
    const jobUrl = `${frontendBaseUrl}/jobs/${encodeURIComponent(slug)}`;
    const publishedAt = readString(String((job === null || job === void 0 ? void 0 : job.publishedAt) || (job === null || job === void 0 ? void 0 : job.createdAt) || ''), 80) || null;
    const updatedAt = readString(String((job === null || job === void 0 ? void 0 : job.updatedAt) || (job === null || job === void 0 ? void 0 : job.createdAt) || ''), 80) || null;
    const companyHandle = readString(job === null || job === void 0 ? void 0 : job.companyHandle, 120).replace(/^@/, '');
    const companyUrl = companyHandle
        ? `${frontendBaseUrl}/company/${encodeURIComponent(companyHandle)}`
        : undefined;
    const applicationUrl = readString(job === null || job === void 0 ? void 0 : job.applicationUrl, 600);
    const applicationEmail = readString(job === null || job === void 0 ? void 0 : job.applicationEmail, 200);
    const externalUrl = applicationUrl || (applicationEmail ? `mailto:${applicationEmail}` : undefined);
    return Object.assign(Object.assign({ id: readString(job === null || job === void 0 ? void 0 : job.id, 120), url: jobUrl }, (externalUrl ? { external_url: externalUrl } : {})), { title: readString(job === null || job === void 0 ? void 0 : job.title, 200), content_text: toCompactText((job === null || job === void 0 ? void 0 : job.description) || (job === null || job === void 0 ? void 0 : job.summary) || ''), summary: toCompactText((job === null || job === void 0 ? void 0 : job.summary) || '', 500), date_published: publishedAt, date_modified: updatedAt, tags: Array.isArray(job === null || job === void 0 ? void 0 : job.tags) ? job.tags : [], authors: [
            Object.assign({ name: readString(job === null || job === void 0 ? void 0 : job.companyName, 200) || 'Company' }, (companyUrl ? { url: companyUrl } : {})),
        ], _aura: {
            jobId: readString(job === null || job === void 0 ? void 0 : job.id, 120),
            slug,
            companyId: readString(job === null || job === void 0 ? void 0 : job.companyId, 120),
            companyHandle: readString(job === null || job === void 0 ? void 0 : job.companyHandle, 120),
            companyIsVerified: Boolean(job === null || job === void 0 ? void 0 : job.companyIsVerified),
            locationText: readString(job === null || job === void 0 ? void 0 : job.locationText, 200),
            workModel: readString(job === null || job === void 0 ? void 0 : job.workModel, 40),
            employmentType: readString(job === null || job === void 0 ? void 0 : job.employmentType, 40),
            salaryMin: typeof (job === null || job === void 0 ? void 0 : job.salaryMin) === 'number' ? job.salaryMin : null,
            salaryMax: typeof (job === null || job === void 0 ? void 0 : job.salaryMax) === 'number' ? job.salaryMax : null,
            salaryCurrency: readString(job === null || job === void 0 ? void 0 : job.salaryCurrency, 12),
            applicationUrl: applicationUrl || null,
            applicationEmail: applicationEmail || null,
        } });
};
const buildJobsSyndicationFeed = (jobs) => ({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Aura Jobs Feed',
    home_page_url: `${getFrontendBaseUrl()}/jobs`,
    feed_url: `${getBackendBaseUrl()}/api/partner/jobs`,
    description: 'Latest jobs published on Aura.',
    language: 'en',
    generated_at: new Date().toISOString(),
    items: jobs.map(toSyndicationItem),
});
exports.buildJobsSyndicationFeed = buildJobsSyndicationFeed;
