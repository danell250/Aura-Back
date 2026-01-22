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
exports.sendMagicLinkEmail = void 0;
// @ts-ignore
const nodemailer_1 = __importDefault(require("nodemailer"));
// Create reusable transporter object using the default SMTP transport
const transporter = nodemailer_1.default.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});
const sendMagicLinkEmail = (email, link) => __awaiter(void 0, void 0, void 0, function* () {
    // If no email credentials are set, just log the link (for dev/testing)
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.log('⚠️ No SMTP credentials found. Skipping email send.');
        console.log(`📨 [MOCK EMAIL] To: ${email}`);
        console.log(`🔗 Magic Link: ${link}`);
        return true;
    }
    try {
        const info = yield transporter.sendMail({
            from: process.env.SMTP_FROM || '"Aura" <noreply@aura.social>',
            to: email,
            subject: 'Your secure login link for Aura',
            html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Login to Aura</h2>
          <p>Click the link below to sign in. This link expires in 15 minutes.</p>
          <p>
            <a href="${link}" style="display: inline-block; background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
              Sign in to Aura
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">If you didn't request this link, you can safely ignore this email.</p>
        </div>
      `,
            text: `Click the link below to sign in to Aura:\n\n${link}\n\nThis link expires in 15 minutes.`,
        });
        console.log('✓ Magic link email sent:', info.messageId);
        return true;
    }
    catch (error) {
        console.error('Error sending magic link email:', error);
        return false;
    }
});
exports.sendMagicLinkEmail = sendMagicLinkEmail;
