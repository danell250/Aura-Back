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
