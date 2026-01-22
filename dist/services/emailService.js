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
const mail_1 = __importDefault(require("@sendgrid/mail"));
mail_1.default.setApiKey(process.env.SENDGRID_API_KEY || '');
function sendMagicLinkEmail(to, magicLink) {
    return __awaiter(this, void 0, void 0, function* () {
        const from = process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_FROM;
        // For development without credentials, log the link instead of crashing
        if (!process.env.SENDGRID_API_KEY || !from) {
            console.log('⚠️ SendGrid credentials not found. Skipping email send.');
            if (!process.env.SENDGRID_API_KEY)
                console.log('   - Missing SENDGRID_API_KEY');
            if (!from)
                console.log('   - Missing SENDGRID_FROM_EMAIL or EMAIL_FROM');
            console.log(`📨 [MOCK EMAIL] To: ${to}`);
            console.log(`🔗 Magic Link: ${magicLink}`);
            return;
        }
        try {
            yield mail_1.default.send({
                to,
                from,
                subject: 'Your secure login link',
                html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Login to Aura</h2>
          <p>Click the button below to sign in. This link expires in 15 minutes.</p>
          <p>
            <a href="${magicLink}"
               style="display:inline-block;padding:10px 14px;background:#10b981;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">
               Sign in to Aura
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
