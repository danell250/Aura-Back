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
exports.sanitizeEmailSubjectText = exports.getDefaultEmailFrom = exports.isEmailDeliveryConfigured = void 0;
exports.sendMagicLinkEmail = sendMagicLinkEmail;
exports.sendCompanyInviteEmail = sendCompanyInviteEmail;
exports.sendReportPreviewEmail = sendReportPreviewEmail;
exports.sendJobApplicationReviewEmail = sendJobApplicationReviewEmail;
exports.sendReverseJobMatchDigestEmail = sendReverseJobMatchDigestEmail;
const mail_1 = __importDefault(require("@sendgrid/mail"));
const reportPreviewEmailPresenterService_1 = require("./reportPreviewEmailPresenterService");
const transactionalEmailPresenterService_1 = require("./transactionalEmailPresenterService");
const htmlUtils_1 = require("../utils/htmlUtils");
mail_1.default.setApiKey(process.env.SENDGRID_API_KEY || '');
const isEmailDeliveryConfigured = () => typeof process.env.SENDGRID_API_KEY === 'string' && process.env.SENDGRID_API_KEY.trim().length > 0;
exports.isEmailDeliveryConfigured = isEmailDeliveryConfigured;
const getDefaultEmailFrom = () => `${process.env.SENDGRID_FROM_NAME || 'Aura©'} <${process.env.SENDGRID_FROM_EMAIL || 'no-reply@aurasocial.world'}>`;
exports.getDefaultEmailFrom = getDefaultEmailFrom;
const sanitizeEmailSubjectText = (value) => {
    if (typeof value !== 'string')
        return '';
    return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
};
exports.sanitizeEmailSubjectText = sanitizeEmailSubjectText;
function sendMagicLinkEmail(to, magicLink) {
    return __awaiter(this, void 0, void 0, function* () {
        // Configured as per request: using SENDGRID_FROM_NAME and SENDGRID_FROM_EMAIL
        const from = (0, exports.getDefaultEmailFrom)();
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
                subject: 'Your secure login link for Aura Social',
                html: (0, transactionalEmailPresenterService_1.buildMagicLinkEmailHtml)(magicLink),
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
        const from = (0, exports.getDefaultEmailFrom)();
        const subjectCompanyName = (0, exports.sanitizeEmailSubjectText)(companyName) || 'Aura Company';
        if (!(0, exports.isEmailDeliveryConfigured)()) {
            console.warn('⚠️ SendGrid credentials not found. Company invite will be logged to console only.');
            console.log('--- COMPANY INVITE ---');
            console.log(`To: ${to}`);
            console.log(`Company: ${subjectCompanyName}`);
            console.log(`URL: ${inviteUrl}`);
            console.log('----------------------');
            return {
                delivered: false,
                provider: 'disabled',
                reason: 'SENDGRID_API_KEY is not configured'
            };
        }
        try {
            yield mail_1.default.send({
                to,
                from,
                subject: `Invite to join ${subjectCompanyName} on Aura©`,
                html: (0, transactionalEmailPresenterService_1.buildCompanyInviteEmailHtml)({
                    companyName: subjectCompanyName,
                    inviteUrl,
                }),
            });
            console.log('✓ Company invite email sent via SendGrid to:', to);
            return {
                delivered: true,
                provider: 'sendgrid'
            };
        }
        catch (error) {
            console.error('Error sending company invite email:', error);
            throw error;
        }
    });
}
function sendReportPreviewEmail(to, payload) {
    return __awaiter(this, void 0, void 0, function* () {
        const from = (0, exports.getDefaultEmailFrom)();
        const periodLabel = (0, htmlUtils_1.safeText)(payload.periodLabel, 'Last 7 days');
        const scopeLabel = (0, htmlUtils_1.safeText)(payload.scope, 'all_signals').replace('_', ' ');
        if (!(0, exports.isEmailDeliveryConfigured)()) {
            console.warn('⚠️ SendGrid credentials not found. Report preview email will be logged to console only.');
            console.log('--- REPORT PREVIEW EMAIL ---');
            console.log(`To: ${to}`);
            console.log(`Period: ${periodLabel}`);
            console.log(`Scope: ${scopeLabel}`);
            console.log('----------------------------');
            return {
                delivered: false,
                provider: 'disabled',
                reason: 'SENDGRID_API_KEY is not configured'
            };
        }
        try {
            const message = (0, reportPreviewEmailPresenterService_1.buildReportPreviewEmailMessage)({
                to,
                from,
                payload,
            });
            yield mail_1.default.send(message);
            console.log('✓ Report preview email sent via SendGrid to:', to);
            return {
                delivered: true,
                provider: 'sendgrid'
            };
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
function sendJobApplicationReviewEmail(to, payload) {
    return __awaiter(this, void 0, void 0, function* () {
        const from = (0, exports.getDefaultEmailFrom)();
        const companyName = (0, htmlUtils_1.safeText)(payload.companyName, 'Aura Company');
        const jobTitle = (0, htmlUtils_1.safeText)(payload.jobTitle, 'Open role');
        if (!(0, exports.isEmailDeliveryConfigured)()) {
            console.warn('⚠️ SendGrid credentials not found. Job review email will be logged to console only.');
            console.log('--- JOB REVIEW EMAIL ---');
            console.log(`To: ${to}`);
            console.log(`Company: ${companyName}`);
            console.log(`Role: ${jobTitle}`);
            console.log(`Portal URL: ${payload.securePortalUrl}`);
            console.log('------------------------');
            return {
                delivered: false,
                provider: 'disabled',
                reason: 'SENDGRID_API_KEY is not configured',
            };
        }
        try {
            yield mail_1.default.send({
                to,
                from,
                subject: `New job application: ${jobTitle} • ${companyName}`,
                html: (0, transactionalEmailPresenterService_1.buildJobApplicationReviewEmailHtml)(payload),
            });
            return {
                delivered: true,
                provider: 'sendgrid',
            };
        }
        catch (error) {
            console.error('Error sending job application review email:', error);
            if (error === null || error === void 0 ? void 0 : error.response) {
                console.error(error.response.body);
            }
            throw error;
        }
    });
}
function sendReverseJobMatchDigestEmail(to, payload) {
    return __awaiter(this, void 0, void 0, function* () {
        const from = (0, exports.getDefaultEmailFrom)();
        const jobs = Array.isArray(payload.jobs) ? payload.jobs.slice(0, 10) : [];
        const shareUrl = typeof payload.shareUrl === 'string' ? payload.shareUrl.trim() : '';
        if (jobs.length === 0) {
            return { delivered: false, provider: (0, exports.isEmailDeliveryConfigured)() ? 'sendgrid' : 'disabled', reason: 'No jobs to send' };
        }
        if (!(0, exports.isEmailDeliveryConfigured)()) {
            console.warn('⚠️ SendGrid credentials not found. Reverse match digest email will be logged to console only.');
            console.log('--- REVERSE MATCH DIGEST ---');
            console.log(`To: ${to}`);
            console.log(`Jobs: ${jobs.length}`);
            console.log(`Share URL: ${shareUrl || 'n/a'}`);
            console.log('----------------------------');
            return {
                delivered: false,
                provider: 'disabled',
                reason: 'SENDGRID_API_KEY is not configured',
            };
        }
        try {
            yield mail_1.default.send({
                to,
                from,
                subject: `${jobs.length} jobs you're a strong match for today`,
                html: (0, transactionalEmailPresenterService_1.buildReverseJobMatchDigestEmailHtml)({
                    recipientName: payload.recipientName,
                    jobs,
                    shareUrl,
                }),
            });
            return { delivered: true, provider: 'sendgrid' };
        }
        catch (error) {
            console.error('Error sending reverse job match digest email:', error);
            if (error === null || error === void 0 ? void 0 : error.response) {
                console.error(error.response.body);
            }
            throw error;
        }
    });
}
