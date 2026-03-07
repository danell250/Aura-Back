"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildJobAlertDigestEmailHtml = exports.buildJobAlertsWelcomeEmailHtml = void 0;
const htmlUtils_1 = require("../utils/htmlUtils");
const jobAlertEmailTemplates_1 = require("../templates/jobAlertEmailTemplates");
const formatDigestJobDiscoveredLabel = (value) => {
    if (!value)
        return 'New on Aura';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return 'New on Aura';
    const diffMs = Date.now() - parsed.getTime();
    const hours = Math.max(0, Math.floor(diffMs / (60 * 60 * 1000)));
    if (hours < 1)
        return 'Discovered just now';
    if (hours < 24)
        return `Discovered ${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1)
        return 'Discovered yesterday';
    return `Discovered ${days}d ago`;
};
const buildJobAlertDigestRowsHtml = (jobs) => {
    const rows = [];
    for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index];
        const title = (0, htmlUtils_1.safeHtmlText)(job.title || 'Job opening');
        const companyName = (0, htmlUtils_1.safeHtmlText)(job.companyName || 'Hiring team');
        const locationText = (0, htmlUtils_1.safeHtmlText)(job.locationText || 'Flexible');
        const url = (0, htmlUtils_1.safeHtmlText)(job.url || '#');
        const matchScore = Number.isFinite(Number(job.matchScore)) ? Math.max(0, Math.round(Number(job.matchScore))) : null;
        const discoveredLabel = formatDigestJobDiscoveredLabel(job.discoveredAt);
        rows.push(`
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
          <a href="${url}" style="color:#0f172a;font-weight:800;text-decoration:none;">${title}</a>
          <div style="font-size:12px;color:#475569;margin-top:3px;">${companyName} • ${locationText}</div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;">${(0, htmlUtils_1.safeHtmlText)(discoveredLabel)}</div>
        </td>
        <td style="padding:12px 0 12px 12px;border-bottom:1px solid #e2e8f0;text-align:right;vertical-align:top;">
          ${matchScore != null
            ? `<span style="display:inline-block;border-radius:999px;background:#ecfdf3;color:#047857;padding:6px 10px;font-size:12px;font-weight:800;">${matchScore}% match</span>`
            : `<span style="display:inline-block;border-radius:999px;background:#eff6ff;color:#1d4ed8;padding:6px 10px;font-size:12px;font-weight:800;">Fresh</span>`}
        </td>
      </tr>
    `);
    }
    return rows.join('');
};
const buildJobAlertsWelcomeEmailHtml = (params) => {
    const categoryLabel = (0, htmlUtils_1.safeHtmlText)(params.categoryLabel || 'All jobs');
    const jobsUrl = (0, htmlUtils_1.safeHtmlText)(params.jobsUrl || 'https://www.aurasocial.world/jobs');
    const unsubscribeUrl = typeof params.unsubscribeUrl === 'string' ? params.unsubscribeUrl.trim() : '';
    return (0, jobAlertEmailTemplates_1.renderJobAlertsWelcomeEmailTemplate)({
        categoryLabelHtml: categoryLabel,
        jobsUrlHtml: jobsUrl,
        unsubscribeLinkHtml: unsubscribeUrl
            ? `<p style="margin:0;font-size:12px;color:#64748b;">Need fewer emails? <a href="${(0, htmlUtils_1.safeHtmlText)(unsubscribeUrl)}" style="color:#0f766e;text-decoration:none;font-weight:700;">Unsubscribe</a>.</p>`
            : '',
    });
};
exports.buildJobAlertsWelcomeEmailHtml = buildJobAlertsWelcomeEmailHtml;
const buildJobAlertDigestEmailHtml = (params) => {
    const safeRecipientName = (0, htmlUtils_1.safeHtmlText)(params.recipientName || 'there');
    const headline = (0, htmlUtils_1.safeHtmlText)(params.headline || 'New jobs on Aura');
    const subheadline = (0, htmlUtils_1.safeHtmlText)(params.subheadline || 'Fresh roles are waiting for you.');
    const ctaUrl = (0, htmlUtils_1.safeHtmlText)(params.ctaUrl || 'https://www.aurasocial.world/jobs');
    const ctaLabel = (0, htmlUtils_1.safeHtmlText)(params.ctaLabel || 'Open Aura jobs');
    const manageUrl = typeof params.manageUrl === 'string' ? params.manageUrl.trim() : '';
    const rowsHtml = buildJobAlertDigestRowsHtml(params.jobs);
    return (0, jobAlertEmailTemplates_1.renderJobAlertDigestEmailTemplate)({
        safeRecipientName,
        headlineHtml: headline,
        subheadlineHtml: subheadline,
        rowsHtml,
        ctaUrlHtml: ctaUrl,
        ctaLabelHtml: ctaLabel,
        manageLinkHtml: manageUrl
            ? `<p style="margin:16px 0 0 0;font-size:12px;color:#64748b;">Manage emails: <a href="${(0, htmlUtils_1.safeHtmlText)(manageUrl)}" style="color:#0f766e;text-decoration:none;font-weight:700;">${(0, htmlUtils_1.safeHtmlText)(manageUrl)}</a></p>`
            : '',
    });
};
exports.buildJobAlertDigestEmailHtml = buildJobAlertDigestEmailHtml;
