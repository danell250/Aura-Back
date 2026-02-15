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
exports.sendMagicLinkEmail = sendMagicLinkEmail;
exports.sendCompanyInviteEmail = sendCompanyInviteEmail;
exports.sendReportPreviewEmail = sendReportPreviewEmail;
const mail_1 = __importDefault(require("@sendgrid/mail"));
mail_1.default.setApiKey(process.env.SENDGRID_API_KEY || '');
function sendMagicLinkEmail(to, magicLink) {
    return __awaiter(this, void 0, void 0, function* () {
        // Configured as per request: using SENDGRID_FROM_NAME and SENDGRID_FROM_EMAIL
        const from = `${process.env.SENDGRID_FROM_NAME || 'Aura©'} <${process.env.SENDGRID_FROM_EMAIL || 'no-reply@aura.net.za'}>`;
        if (!process.env.SENDGRID_API_KEY) {
            console.warn('⚠️ SendGrid credentials not found. Magic link will be logged to console only.');
            console.log('--- MAGIC LINK ---');
            console.log(magicLink);
            console.log('------------------');
            return; // Don't throw, just return success (simulated)
        }
        try {
            yield mail_1.default.send({
                to,
                from,
                subject: 'Your secure login link for Aura©',
                html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Login to Aura©</h2>
          <p>Click the button below to sign in. This link expires in 15 minutes.</p>
          <p>
            <a href="${magicLink}"
               style="display:inline-block;padding:10px 14px;background:#10b981;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">
               Sign in to Aura©
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">If you didn’t request this, you can safely ignore this email.</p>
        </div>
      `,
            });
            console.log('✓ Magic link email sent via SendGrid to:', to);
        }
        catch (error) {
            console.error('Error sending magic link email:', error);
            if (error.response) {
                console.error(error.response.body);
            }
            throw error;
        }
    });
}
function sendCompanyInviteEmail(to, companyName, inviteUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        const from = `${process.env.SENDGRID_FROM_NAME || 'Aura©'} <${process.env.SENDGRID_FROM_EMAIL || 'no-reply@aura.net.za'}>`;
        if (!process.env.SENDGRID_API_KEY) {
            console.warn('⚠️ SendGrid credentials not found. Company invite will be logged to console only.');
            console.log('--- COMPANY INVITE ---');
            console.log(`To: ${to}`);
            console.log(`Company: ${companyName}`);
            console.log(`URL: ${inviteUrl}`);
            console.log('----------------------');
            return;
        }
        try {
            yield mail_1.default.send({
                to,
                from,
                subject: `Invite to join ${companyName} on Aura©`,
                html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px;">
          <h2 style="color: #1e293b; margin-top: 0;">Join ${companyName}</h2>
          <p style="color: #475569; line-height: 1.6;">You've been invited to join the team for <strong>${companyName}</strong> on Aura©.</p>
          <p style="margin: 32px 0;">
            <a href="${inviteUrl}"
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
      `,
            });
            console.log('✓ Company invite email sent via SendGrid to:', to);
        }
        catch (error) {
            console.error('Error sending company invite email:', error);
            throw error;
        }
    });
}
const safeText = (value, fallback = 'N/A') => {
    if (typeof value === 'string' && value.trim().length > 0)
        return value.trim();
    return fallback;
};
const safeNumber = (value, digits = 2) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue))
        return Number(0).toFixed(digits);
    return numberValue.toFixed(digits);
};
function sendReportPreviewEmail(to, payload) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const from = `${process.env.SENDGRID_REPORTS_FROM_NAME || 'Aura Reports'} <${process.env.SENDGRID_REPORTS_FROM_EMAIL || 'reports@aura.net.za'}>`;
        const metricReach = Number(((_a = payload.metrics) === null || _a === void 0 ? void 0 : _a.reach) || 0).toLocaleString();
        const metricCtr = safeNumber((_b = payload.metrics) === null || _b === void 0 ? void 0 : _b.ctr, 2);
        const metricClicks = Number(((_c = payload.metrics) === null || _c === void 0 ? void 0 : _c.clicks) || 0).toLocaleString();
        const metricConversions = Number(((_d = payload.metrics) === null || _d === void 0 ? void 0 : _d.conversions) || 0).toLocaleString();
        const metricEfficiency = safeNumber((_e = payload.metrics) === null || _e === void 0 ? void 0 : _e.auraEfficiency, 2);
        const metricSpend = safeNumber((_f = payload.metrics) === null || _f === void 0 ? void 0 : _f.spend, 2);
        const periodLabel = safeText(payload.periodLabel, 'Last 7 days');
        const scopeLabel = safeText(payload.scope, 'all_signals').replace('_', ' ');
        const topSignals = Array.isArray(payload.topSignals) ? payload.topSignals.slice(0, 3) : [];
        const recommendations = Array.isArray(payload.recommendations) ? payload.recommendations.slice(0, 3) : [];
        if (!process.env.SENDGRID_API_KEY) {
            console.warn('⚠️ SendGrid credentials not found. Report preview email will be logged to console only.');
            console.log('--- REPORT PREVIEW EMAIL ---');
            console.log(`To: ${to}`);
            console.log(`Period: ${periodLabel}`);
            console.log(`Scope: ${scopeLabel}`);
            console.log('----------------------------');
            return;
        }
        try {
            yield mail_1.default.send({
                to,
                from,
                subject: `Aura Scheduled Report Preview • ${periodLabel}`,
                html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #0f172a 0%, #0b1120 70%); color: white; padding: 28px 28px 20px 28px;">
            <p style="margin:0;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#6ee7b7;font-weight:800;">Aura Reports</p>
            <h2 style="margin:10px 0 6px 0;font-size:24px;line-height:1.2;">Scheduled Report Preview</h2>
            <p style="margin:0;color:#cbd5e1;font-size:13px;">Sender: reports@ • ${periodLabel} • Scope: ${scopeLabel}</p>
          </div>
          <div style="padding: 24px 28px;">
            <h3 style="margin:0 0 12px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Executive Summary</h3>
            <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
              <tr><td style="padding:8px 0;color:#475569;">Reach</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${metricReach}</td></tr>
              <tr><td style="padding:8px 0;color:#475569;">CTR</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${metricCtr}%</td></tr>
              <tr><td style="padding:8px 0;color:#475569;">Clicks</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${metricClicks}</td></tr>
              <tr><td style="padding:8px 0;color:#475569;">Conversions</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${metricConversions}</td></tr>
              <tr><td style="padding:8px 0;color:#475569;">Aura Efficiency</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${metricEfficiency}</td></tr>
              <tr><td style="padding:8px 0;color:#475569;">Spend</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">$${metricSpend}</td></tr>
            </table>

            ${topSignals.length > 0 ? `
            <h3 style="margin:0 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Top Signals</h3>
            <ul style="margin:0 0 16px 18px;padding:0;color:#334155;">
              ${topSignals.map((signal) => `<li style="margin-bottom:6px;">${safeText(signal.name)} • CTR ${safeNumber(signal.ctr, 2)}% • Reach ${Number(signal.reach || 0).toLocaleString()}</li>`).join('')}
            </ul>` : ''}

            ${recommendations.length > 0 ? `
            <h3 style="margin:0 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Recommendations</h3>
            <ul style="margin:0 0 4px 18px;padding:0;color:#334155;">
              ${recommendations.map((item) => `<li style="margin-bottom:6px;">${safeText(item)}</li>`).join('')}
            </ul>` : ''}
          </div>
        </div>
      `
            });
            console.log('✓ Report preview email sent via SendGrid to:', to);
        }
        catch (error) {
            console.error('Error sending report preview email:', error);
            if (error.response) {
                console.error(error.response.body);
            }
            throw error;
        }
    });
}
