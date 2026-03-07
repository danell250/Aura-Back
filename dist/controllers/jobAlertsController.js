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
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobAlertsController = void 0;
const db_1 = require("../db");
const jobAlertEmailService_1 = require("../services/jobAlertEmailService");
const jobAlertCategoryService_1 = require("../services/jobAlertCategoryService");
const jobAlertsUnsubscribeViewService_1 = require("../services/jobAlertsUnsubscribeViewService");
const jobAlertSubscriptionService_1 = require("../services/jobAlertSubscriptionService");
const publicWebUrl_1 = require("../utils/publicWebUrl");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const APP_BASE_URL = (0, publicWebUrl_1.getPublicWebUrl)();
exports.jobAlertsController = {
    subscribePublicJobAlerts: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const email = (0, inputSanitizers_1.readString)((_a = req.body) === null || _a === void 0 ? void 0 : _a.email, 220).toLowerCase();
            const category = (0, jobAlertCategoryService_1.normalizeJobAlertCategory)((_b = req.body) === null || _b === void 0 ? void 0 : _b.category);
            if (!(0, jobAlertSubscriptionService_1.isValidJobAlertEmail)(email)) {
                return res.status(400).json({ success: false, error: 'A valid email address is required' });
            }
            if (!jobAlertCategoryService_1.JOB_ALERT_CATEGORIES.includes(category)) {
                return res.status(400).json({ success: false, error: 'Invalid category' });
            }
            const db = (0, db_1.getDB)();
            const result = yield (0, jobAlertSubscriptionService_1.subscribeToPublicJobAlerts)({
                db,
                email,
                category,
            });
            const unsubscribeUrl = `${APP_BASE_URL}/api/jobs/alerts/unsubscribe?token=${encodeURIComponent(result.unsubscribeToken)}`;
            if (result.status !== 'updated') {
                try {
                    yield (0, jobAlertEmailService_1.sendJobAlertsWelcomeEmail)(email, {
                        categoryLabel: category === 'all' ? 'All jobs' : `${category[0].toUpperCase()}${category.slice(1)} jobs`,
                        jobsUrl: `${APP_BASE_URL}/jobs`,
                        unsubscribeUrl,
                    });
                    yield (0, jobAlertSubscriptionService_1.markPublicJobAlertWelcomeEmailSent)({
                        db,
                        email,
                        sentAtIso: new Date().toISOString(),
                    });
                }
                catch (emailError) {
                    console.error('Public job alert welcome email error:', emailError);
                }
            }
            const message = result.status === 'created'
                ? 'Weekly job alerts are on. Check your inbox for the welcome email.'
                : result.status === 'reactivated'
                    ? 'Weekly job alerts are back on. Check your inbox for the welcome email.'
                    : 'You are already on the weekly job alerts list. We refreshed your preferences.';
            return res.status(result.created ? 201 : 200).json({
                success: true,
                data: {
                    email,
                    category,
                    cadence: 'weekly',
                },
                message,
            });
        }
        catch (error) {
            console.error('Subscribe public job alerts error:', error);
            return res.status(500).json({ success: false, error: 'Failed to subscribe to job alerts' });
        }
    }),
    renderPublicJobAlertsUnsubscribeConfirm: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const token = (0, inputSanitizers_1.readString)((_a = req.query) === null || _a === void 0 ? void 0 : _a.token, 240);
            if (!token) {
                return res
                    .status(400)
                    .type('html')
                    .send((0, jobAlertsUnsubscribeViewService_1.buildJobAlertStatusHtml)({
                    title: 'Invalid unsubscribe link',
                    body: 'That unsubscribe link is incomplete or expired.',
                }));
            }
            return res
                .status(200)
                .type('html')
                .send((0, jobAlertsUnsubscribeViewService_1.buildJobAlertUnsubscribeConfirmHtml)({ token }));
        }
        catch (error) {
            console.error('Render public job alerts unsubscribe confirm error:', error);
            return res
                .status(500)
                .type('html')
                .send((0, jobAlertsUnsubscribeViewService_1.buildJobAlertStatusHtml)({
                title: 'Could not load your unsubscribe page',
                body: 'Aura hit an unexpected error while loading your unsubscribe confirmation.',
            }));
        }
    }),
    confirmPublicJobAlertsUnsubscribe: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res
                    .status(503)
                    .type('html')
                    .send((0, jobAlertsUnsubscribeViewService_1.buildJobAlertStatusHtml)({
                    title: 'Job alerts are temporarily unavailable',
                    body: 'Aura could not reach the alerts service right now. Try again later.',
                }));
            }
            const token = (0, inputSanitizers_1.readString)(((_a = req.body) === null || _a === void 0 ? void 0 : _a.token) || ((_b = req.query) === null || _b === void 0 ? void 0 : _b.token), 240);
            if (!token) {
                return res
                    .status(400)
                    .type('html')
                    .send((0, jobAlertsUnsubscribeViewService_1.buildJobAlertStatusHtml)({
                    title: 'Invalid unsubscribe link',
                    body: 'That unsubscribe request is incomplete or expired.',
                }));
            }
            const success = yield (0, jobAlertSubscriptionService_1.unsubscribePublicJobAlertsByToken)({
                db: (0, db_1.getDB)(),
                token,
            });
            return res
                .status(success ? 200 : 404)
                .type('html')
                .send((0, jobAlertsUnsubscribeViewService_1.buildJobAlertStatusHtml)({
                title: success ? 'Weekly job alerts turned off' : 'Alert subscription not found',
                body: success
                    ? 'You have been unsubscribed from Aura weekly job alerts.'
                    : 'This unsubscribe link is no longer active.',
            }));
        }
        catch (error) {
            console.error('Unsubscribe public job alerts error:', error);
            return res
                .status(500)
                .type('html')
                .send((0, jobAlertsUnsubscribeViewService_1.buildJobAlertStatusHtml)({
                title: 'Could not update your alert subscription',
                body: 'Aura hit an unexpected error while processing your unsubscribe request.',
            }));
        }
    }),
};
