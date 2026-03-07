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
exports.sendJobAlertsWelcomeEmail = sendJobAlertsWelcomeEmail;
exports.sendJobAlertDigestEmail = sendJobAlertDigestEmail;
const mail_1 = __importDefault(require("@sendgrid/mail"));
const jobAlertEmailPresenterService_1 = require("./jobAlertEmailPresenterService");
const emailService_1 = require("./emailService");
mail_1.default.setApiKey(process.env.SENDGRID_API_KEY || '');
function sendJobAlertsWelcomeEmail(to, payload) {
    return __awaiter(this, void 0, void 0, function* () {
        const from = (0, emailService_1.getDefaultEmailFrom)();
        if (!(0, emailService_1.isEmailDeliveryConfigured)()) {
            console.warn('⚠️ SendGrid credentials not found. Job alerts welcome email will be logged to console only.');
            console.log('--- JOB ALERT WELCOME ---');
            console.log(`To: ${to}`);
            console.log(`Category: ${payload.categoryLabel}`);
            console.log(`Jobs URL: ${payload.jobsUrl}`);
            console.log('-------------------------');
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
                subject: 'You are on the Aura weekly job alerts list',
                html: (0, jobAlertEmailPresenterService_1.buildJobAlertsWelcomeEmailHtml)(payload),
            });
            return { delivered: true, provider: 'sendgrid' };
        }
        catch (error) {
            console.error('Error sending job alerts welcome email:', error);
            if (error === null || error === void 0 ? void 0 : error.response) {
                console.error(error.response.body);
            }
            throw error;
        }
    });
}
function sendJobAlertDigestEmail(to, payload) {
    return __awaiter(this, void 0, void 0, function* () {
        const from = (0, emailService_1.getDefaultEmailFrom)();
        const jobs = Array.isArray(payload.jobs) ? payload.jobs.slice(0, 10) : [];
        if (jobs.length === 0) {
            return {
                delivered: false,
                provider: (0, emailService_1.isEmailDeliveryConfigured)() ? 'sendgrid' : 'disabled',
                reason: 'No jobs to send',
            };
        }
        if (!(0, emailService_1.isEmailDeliveryConfigured)()) {
            console.warn('⚠️ SendGrid credentials not found. Job alert digest email will be logged to console only.');
            console.log('--- JOB ALERT DIGEST ---');
            console.log(`To: ${to}`);
            console.log(`Jobs: ${jobs.length}`);
            console.log(`CTA: ${payload.ctaUrl}`);
            console.log('------------------------');
            return {
                delivered: false,
                provider: 'disabled',
                reason: 'SENDGRID_API_KEY is not configured',
            };
        }
        const html = (0, jobAlertEmailPresenterService_1.buildJobAlertDigestEmailHtml)({
            recipientName: payload.recipientName,
            headline: payload.headline,
            subheadline: payload.subheadline,
            jobs,
            ctaUrl: payload.ctaUrl,
            ctaLabel: payload.ctaLabel,
            manageUrl: payload.manageUrl,
        });
        try {
            yield mail_1.default.send({
                to,
                from,
                subject: (0, emailService_1.sanitizeEmailSubjectText)(payload.headline || 'New jobs on Aura'),
                html,
            });
            return { delivered: true, provider: 'sendgrid' };
        }
        catch (error) {
            console.error('Error sending job alert digest email:', error);
            if (error === null || error === void 0 ? void 0 : error.response) {
                console.error(error.response.body);
            }
            throw error;
        }
    });
}
