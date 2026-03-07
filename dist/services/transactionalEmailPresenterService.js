"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildReverseJobMatchDigestEmailHtml = exports.buildJobApplicationReviewEmailHtml = exports.buildCompanyInviteEmailHtml = exports.buildMagicLinkEmailHtml = void 0;
const htmlUtils_1 = require("../utils/htmlUtils");
const transactionalEmailTemplates_1 = require("../templates/transactionalEmailTemplates");
const buildMagicLinkEmailHtml = (magicLink) => (0, transactionalEmailTemplates_1.renderMagicLinkEmailTemplate)({
    magicLinkHtml: (0, htmlUtils_1.safeHtmlText)(magicLink),
});
exports.buildMagicLinkEmailHtml = buildMagicLinkEmailHtml;
const buildCompanyInviteEmailHtml = (params) => (0, transactionalEmailTemplates_1.renderCompanyInviteEmailTemplate)({
    companyNameHtml: (0, htmlUtils_1.safeHtmlText)(params.companyName),
    inviteUrlHtml: (0, htmlUtils_1.safeHtmlText)(params.inviteUrl),
});
exports.buildCompanyInviteEmailHtml = buildCompanyInviteEmailHtml;
const buildJobApplicationReviewEmailHtml = (payload) => {
    const reviewerName = (0, htmlUtils_1.safeText)(payload.reviewerName, 'Team');
    const companyName = (0, htmlUtils_1.safeText)(payload.companyName, 'Aura Company');
    const jobTitle = (0, htmlUtils_1.safeText)(payload.jobTitle, 'Open role');
    const applicantName = (0, htmlUtils_1.safeText)(payload.applicantName, 'Applicant');
    const applicantEmail = (0, htmlUtils_1.safeText)(payload.applicantEmail, 'Not provided');
    const applicantPhone = (0, htmlUtils_1.safeText)(payload.applicantPhone, 'Not provided');
    const submittedAtRaw = (0, htmlUtils_1.safeText)(payload.submittedAt, new Date().toISOString());
    const submittedAt = Number.isNaN(new Date(submittedAtRaw).getTime())
        ? submittedAtRaw
        : new Date(submittedAtRaw).toLocaleString();
    const expiresAtRaw = (0, htmlUtils_1.safeText)(payload.expiresAt, '');
    const expiresAt = expiresAtRaw && !Number.isNaN(new Date(expiresAtRaw).getTime())
        ? new Date(expiresAtRaw).toLocaleString()
        : expiresAtRaw;
    return (0, transactionalEmailTemplates_1.renderJobApplicationReviewEmailTemplate)({
        reviewerNameHtml: (0, htmlUtils_1.safeHtmlText)(reviewerName),
        companyNameHtml: (0, htmlUtils_1.safeHtmlText)(companyName),
        jobTitleHtml: (0, htmlUtils_1.safeHtmlText)(jobTitle),
        applicantNameHtml: (0, htmlUtils_1.safeHtmlText)(applicantName),
        applicantEmailHtml: (0, htmlUtils_1.safeHtmlText)(applicantEmail),
        applicantPhoneHtml: (0, htmlUtils_1.safeHtmlText)(applicantPhone),
        submittedAtHtml: (0, htmlUtils_1.safeHtmlText)(submittedAt),
        expiresRowHtml: expiresAt
            ? `<tr><td style="padding:8px 0;color:#64748b;">Secure link expires</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${(0, htmlUtils_1.safeHtmlText)(expiresAt)}</td></tr>`
            : '',
        securePortalUrlHtml: (0, htmlUtils_1.safeHtmlText)(payload.securePortalUrl),
    });
};
exports.buildJobApplicationReviewEmailHtml = buildJobApplicationReviewEmailHtml;
const buildReverseJobMatchDigestEmailHtml = (params) => {
    const safeRecipientName = (0, htmlUtils_1.safeHtmlText)(params.recipientName || 'there');
    const rowsHtml = params.jobs
        .map((job) => {
        const title = (0, htmlUtils_1.safeHtmlText)(job.title || 'Job match');
        const companyName = (0, htmlUtils_1.safeHtmlText)(job.companyName || 'Hiring Team');
        const locationText = (0, htmlUtils_1.safeHtmlText)(job.locationText || 'Flexible');
        const url = (0, htmlUtils_1.safeHtmlText)(job.url || '#');
        const score = Math.max(0, Math.round(Number(job.score || 0)));
        return `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;">
            <a href="${url}" style="color:#0f172a;font-weight:700;text-decoration:none;">${title}</a>
            <div style="font-size:12px;color:#475569;margin-top:2px;">${companyName} • ${locationText}</div>
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:800;color:#059669;">
            ${score}%
          </td>
        </tr>
      `;
    })
        .join('');
    const shareUrl = typeof params.shareUrl === 'string' ? params.shareUrl.trim() : '';
    return (0, transactionalEmailTemplates_1.renderReverseJobMatchDigestEmailTemplate)({
        jobsCount: params.jobs.length,
        recipientNameHtml: safeRecipientName,
        rowsHtml,
        shareLinkHtml: shareUrl
            ? `
        <p style="margin:16px 0 0 0;font-size:12px;color:#64748b;">
          Share your top matches:
          <a href="${(0, htmlUtils_1.safeHtmlText)(shareUrl)}" style="color:#0f766e;text-decoration:none;font-weight:700;">${(0, htmlUtils_1.safeHtmlText)(shareUrl)}</a>
        </p>
      `
            : '',
    });
};
exports.buildReverseJobMatchDigestEmailHtml = buildReverseJobMatchDigestEmailHtml;
