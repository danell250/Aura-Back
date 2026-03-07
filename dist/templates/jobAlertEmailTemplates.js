"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderJobAlertDigestEmailTemplate = exports.renderJobAlertsWelcomeEmailTemplate = void 0;
const renderJobAlertsWelcomeEmailTemplate = (params) => `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#0f172a 0%,#052e2b 100%);padding:24px;color:#fff;">
      <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#86efac;font-weight:800;">Aura Jobs</p>
      <h2 style="margin:10px 0 6px 0;font-size:22px;line-height:1.25;">Weekly job alerts are on</h2>
      <p style="margin:0;color:#cbd5e1;font-size:13px;">We will send you a curated jobs digest every Monday for <strong>${params.categoryLabelHtml}</strong>.</p>
    </div>
    <div style="padding:22px 24px;">
      <p style="margin:0 0 14px 0;color:#475569;font-size:14px;line-height:1.6;">
        Expect a tight list of fresh roles worth opening, not a generic blast. You can browse current openings any time.
      </p>
      <p style="margin:0 0 18px 0;">
        <a href="${params.jobsUrlHtml}" style="display:inline-block;padding:12px 18px;background:#10b981;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">
          Browse current jobs
        </a>
      </p>
      ${params.unsubscribeLinkHtml || ''}
    </div>
  </div>
`;
exports.renderJobAlertsWelcomeEmailTemplate = renderJobAlertsWelcomeEmailTemplate;
const renderJobAlertDigestEmailTemplate = (params) => `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:680px;margin:0 auto;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#0f172a 0%,#052e2b 100%);padding:24px;color:#fff;">
      <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#86efac;font-weight:800;">Aura Jobs</p>
      <h2 style="margin:10px 0 6px 0;font-size:22px;line-height:1.25;">${params.headlineHtml}</h2>
      <p style="margin:0;color:#cbd5e1;font-size:13px;">Hi ${params.safeRecipientName}, ${params.subheadlineHtml}</p>
    </div>
    <div style="padding:22px 24px;">
      <table style="width:100%;border-collapse:collapse;">
        <tbody>
          ${params.rowsHtml}
        </tbody>
      </table>
      <p style="margin:18px 0 0 0;">
        <a href="${params.ctaUrlHtml}" style="display:inline-block;padding:12px 18px;background:#10b981;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">
          ${params.ctaLabelHtml}
        </a>
      </p>
      ${params.manageLinkHtml || ''}
    </div>
  </div>
`;
exports.renderJobAlertDigestEmailTemplate = renderJobAlertDigestEmailTemplate;
