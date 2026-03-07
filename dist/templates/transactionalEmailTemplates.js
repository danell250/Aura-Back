"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderReverseJobMatchDigestEmailTemplate = exports.renderJobApplicationReviewEmailTemplate = exports.renderCompanyInviteEmailTemplate = exports.renderMagicLinkEmailTemplate = void 0;
const renderMagicLinkEmailTemplate = (params) => `
  <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
    <h2>Login to Aura Social</h2>
    <p>Click the button below to sign in. This link expires in 15 minutes.</p>
    <p>
      <a href="${params.magicLinkHtml}"
         style="display:inline-block;padding:10px 14px;background:#10b981;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">
         Sign in to Aura Social
      </a>
    </p>
    <p style="color: #666; font-size: 14px;">If you didn’t request this, you can safely ignore this email.</p>
  </div>
`;
exports.renderMagicLinkEmailTemplate = renderMagicLinkEmailTemplate;
const renderCompanyInviteEmailTemplate = (params) => `
  <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px;">
    <h2 style="color: #1e293b; margin-top: 0;">Join ${params.companyNameHtml}</h2>
    <p style="color: #475569; line-height: 1.6;">You've been invited to join the team for <strong>${params.companyNameHtml}</strong> on Aura©.</p>
    <p style="margin: 32px 0;">
      <a href="${params.inviteUrlHtml}"
         style="display:inline-block;padding:12px 24px;background:#10b981;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;font-size:14px;">
         Accept Invitation
      </a>
    </p>
    <p style="color: #64748b; font-size: 12px;">This invitation link will expire in 7 days.</p>
    <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 32px 0;" />
    <p style="color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; text-align: center;">
      Aura© &bull; The New Social Standard
    </p>
  </div>
`;
exports.renderCompanyInviteEmailTemplate = renderCompanyInviteEmailTemplate;
const renderJobApplicationReviewEmailTemplate = (params) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;">
    <div style="background: linear-gradient(135deg, #0f172a 0%, #0b1120 70%); color: #fff; padding: 24px 26px;">
      <p style="margin:0;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#6ee7b7;font-weight:800;">Aura Hiring</p>
      <h2 style="margin:10px 0 6px 0;font-size:22px;line-height:1.25;">New application requires review</h2>
      <p style="margin:0;color:#cbd5e1;font-size:13px;">${params.companyNameHtml} • ${params.jobTitleHtml}</p>
    </div>
    <div style="padding: 22px 26px;">
      <p style="margin:0 0 14px 0;color:#334155;font-size:14px;">Hi ${params.reviewerNameHtml}, a new candidate applied and is ready for review in the secure portal.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
        <tr><td style="padding:8px 0;color:#64748b;">Applicant</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${params.applicantNameHtml}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Email</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${params.applicantEmailHtml}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Phone</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${params.applicantPhoneHtml}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Submitted</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${params.submittedAtHtml}</td></tr>
        ${params.expiresRowHtml}
      </table>

      <p style="margin: 18px 0 0 0;">
        <a href="${params.securePortalUrlHtml}"
           style="display:inline-block;padding:12px 20px;background:#10b981;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:13px;">
           Review In Secure Portal
        </a>
      </p>

      <p style="margin:14px 0 0 0;color:#64748b;font-size:12px;">This secure link opens your company application review workflow. Access still requires a valid owner/admin session.</p>
    </div>
  </div>
`;
exports.renderJobApplicationReviewEmailTemplate = renderJobApplicationReviewEmailTemplate;
const renderReverseJobMatchDigestEmailTemplate = (params) => `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:680px;margin:0 auto;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#0f172a 0%,#052e2b 100%);padding:24px;color:#fff;">
      <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#86efac;font-weight:800;">Aura Reverse Match</p>
      <h2 style="margin:10px 0 6px 0;font-size:22px;line-height:1.25;">${params.jobsCount} jobs match your profile</h2>
      <p style="margin:0;color:#cbd5e1;font-size:13px;">Hi ${params.recipientNameHtml}, these opportunities were discovered and scored for your profile.</p>
    </div>
    <div style="padding:22px 24px;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left;padding:0 8px 8px 8px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Role</th>
            <th style="text-align:right;padding:0 8px 8px 8px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Match</th>
          </tr>
        </thead>
        <tbody>
          ${params.rowsHtml}
        </tbody>
      </table>
      ${params.shareLinkHtml}
    </div>
  </div>
`;
exports.renderReverseJobMatchDigestEmailTemplate = renderReverseJobMatchDigestEmailTemplate;
