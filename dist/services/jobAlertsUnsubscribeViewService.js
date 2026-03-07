"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildJobAlertUnsubscribeConfirmHtml = exports.buildJobAlertStatusHtml = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const publicWebUrl_1 = require("../utils/publicWebUrl");
const jobAlertStatusTemplate_1 = require("../templates/jobAlertStatusTemplate");
const APP_BASE_URL = (0, publicWebUrl_1.getPublicWebUrl)();
const escapeHtml = (value) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const buildJobAlertStatusHtml = (params) => {
    const title = escapeHtml((0, inputSanitizers_1.readString)(params.title, 160) || 'Aura Jobs');
    const body = escapeHtml((0, inputSanitizers_1.readString)(params.body, 640) || 'Aura Jobs');
    const jobsUrl = `${APP_BASE_URL}/jobs`;
    return (0, jobAlertStatusTemplate_1.renderJobAlertStatusTemplate)({
        titleHtml: title,
        bodyHtml: body,
        jobsUrl,
    });
};
exports.buildJobAlertStatusHtml = buildJobAlertStatusHtml;
const buildJobAlertUnsubscribeConfirmHtml = (params) => {
    const token = escapeHtml((0, inputSanitizers_1.readString)(params.token, 240) || '');
    const jobsUrl = `${APP_BASE_URL}/jobs`;
    return (0, jobAlertStatusTemplate_1.renderJobAlertStatusTemplate)({
        titleHtml: 'Confirm weekly job alert unsubscribe',
        bodyHtml: 'Click confirm to stop receiving Aura weekly job alerts for this email address.',
        jobsUrl,
        actionHtml: `
      <form method="post" action="${APP_BASE_URL}/api/jobs/alerts/unsubscribe" style="margin-top:18px;">
        <input type="hidden" name="token" value="${token}" />
        <button type="submit" style="display:inline-flex;padding:12px 18px;border-radius:12px;text-decoration:none;background:#0f172a;color:#fff;font-weight:700;border:0;cursor:pointer;">
          Confirm unsubscribe
        </button>
      </form>
      <a href="${jobsUrl}" style="display:inline-flex;margin-top:12px;padding:12px 18px;border-radius:12px;text-decoration:none;background:#e2e8f0;color:#0f172a;font-weight:700;">Keep alerts and go back</a>
    `,
    });
};
exports.buildJobAlertUnsubscribeConfirmHtml = buildJobAlertUnsubscribeConfirmHtml;
