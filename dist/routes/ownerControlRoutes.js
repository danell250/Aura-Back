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
const express_1 = require("express");
const db_1 = require("../db");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
const REPORT_STATUS_VALUES = new Set(['open', 'in_review', 'resolved', 'dismissed']);
const readIsoTimestamp = (value) => {
    if (typeof value === 'number' && Number.isFinite(value))
        return new Date(value).toISOString();
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed))
            return new Date(parsed).toISOString();
    }
    return new Date(0).toISOString();
};
const readMillis = (value) => {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return 0;
};
const previewText = (value, max = 140) => {
    if (typeof value !== 'string')
        return '';
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= max)
        return normalized;
    return `${normalized.slice(0, max - 3)}...`;
};
const normalizeReportType = (report) => {
    if ((report === null || report === void 0 ? void 0 : report.type) === 'post')
        return 'post';
    if (typeof (report === null || report === void 0 ? void 0 : report.postId) === 'string' && report.postId.trim().length > 0)
        return 'post';
    return 'user';
};
const isSuspendedMessage = (reason) => reason ? `Account suspended: ${reason}` : 'Account suspended. Contact support for assistance.';
router.use(authMiddleware_1.requireAuth, authMiddleware_1.requireAdmin);
router.get('/overview', (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const db = (0, db_1.getDB)();
        const now = Date.now();
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
        const [users, reports, recentCompanySubscriptions, recentCreditTransactions] = yield Promise.all([
            db.collection('users')
                .find({})
                .project({
                _id: 0,
                id: 1,
                name: 1,
                handle: 1,
                email: 1,
                createdAt: 1,
                isSuspended: 1,
                suspensionReason: 1
            })
                .toArray(),
            db.collection('reports')
                .find({})
                .sort({ createdAt: -1 })
                .limit(200)
                .toArray(),
            db.collection('adSubscriptions')
                .find({ ownerType: 'company' })
                .sort({ createdAt: -1 })
                .limit(120)
                .toArray(),
            db.collection('transactions')
                .find({ type: 'credit_purchase' })
                .sort({ createdAt: -1 })
                .limit(180)
                .toArray()
        ]);
        const userById = new Map();
        users.forEach((user) => {
            if (typeof (user === null || user === void 0 ? void 0 : user.id) === 'string' && user.id.trim().length > 0) {
                userById.set(user.id, user);
            }
        });
        const reportPostIds = Array.from(new Set(reports
            .filter((report) => normalizeReportType(report) === 'post')
            .map((report) => (typeof (report === null || report === void 0 ? void 0 : report.postId) === 'string' ? report.postId : ''))
            .filter((id) => id.trim().length > 0)));
        const reportPosts = reportPostIds.length > 0
            ? yield db.collection('posts')
                .find({ id: { $in: reportPostIds } })
                .project({
                _id: 0,
                id: 1,
                content: 1,
                author: 1,
                visibility: 1,
                moderationHidden: 1
            })
                .toArray()
            : [];
        const postById = new Map();
        reportPosts.forEach((post) => {
            if (typeof (post === null || post === void 0 ? void 0 : post.id) === 'string' && post.id.trim().length > 0) {
                postById.set(post.id, post);
            }
        });
        const unresolvedStatuses = new Set(['open', 'in_review', '']);
        const mappedReports = reports.map((report) => {
            var _a, _b, _c, _d, _e;
            const reportType = normalizeReportType(report);
            const postId = typeof (report === null || report === void 0 ? void 0 : report.postId) === 'string' ? report.postId : '';
            const targetPost = postId ? postById.get(postId) : undefined;
            const targetUserId = reportType === 'user'
                ? (typeof (report === null || report === void 0 ? void 0 : report.targetUserId) === 'string' ? report.targetUserId : '')
                : (typeof ((_a = targetPost === null || targetPost === void 0 ? void 0 : targetPost.author) === null || _a === void 0 ? void 0 : _a.id) === 'string' ? targetPost.author.id : '');
            const reporterId = typeof (report === null || report === void 0 ? void 0 : report.reporterId) === 'string' ? report.reporterId : '';
            const reporter = reporterId ? userById.get(reporterId) : undefined;
            const targetUser = targetUserId ? userById.get(targetUserId) : undefined;
            const status = typeof (report === null || report === void 0 ? void 0 : report.status) === 'string' ? report.status : 'open';
            return {
                id: (report === null || report === void 0 ? void 0 : report.id) || ((_c = (_b = report === null || report === void 0 ? void 0 : report._id) === null || _b === void 0 ? void 0 : _b.toString) === null || _c === void 0 ? void 0 : _c.call(_b)) || '',
                type: reportType,
                status,
                reason: typeof (report === null || report === void 0 ? void 0 : report.reason) === 'string' ? report.reason : 'Not specified',
                notes: typeof (report === null || report === void 0 ? void 0 : report.notes) === 'string' ? report.notes : '',
                createdAt: readIsoTimestamp(report === null || report === void 0 ? void 0 : report.createdAt),
                reporter: reporter
                    ? {
                        id: reporter.id,
                        name: reporter.name || 'Unknown',
                        handle: reporter.handle || '',
                        email: reporter.email || ''
                    }
                    : null,
                targetUser: targetUser
                    ? {
                        id: targetUser.id,
                        name: targetUser.name || 'Unknown',
                        handle: targetUser.handle || '',
                        email: targetUser.email || '',
                        isSuspended: !!targetUser.isSuspended,
                        suspensionReason: targetUser.suspensionReason || ''
                    }
                    : (targetUserId
                        ? {
                            id: targetUserId,
                            name: 'Unknown',
                            handle: '',
                            email: '',
                            isSuspended: false,
                            suspensionReason: ''
                        }
                        : null),
                post: targetPost
                    ? {
                        id: targetPost.id,
                        preview: previewText(targetPost.content),
                        authorName: ((_d = targetPost.author) === null || _d === void 0 ? void 0 : _d.name) || 'Unknown',
                        authorHandle: ((_e = targetPost.author) === null || _e === void 0 ? void 0 : _e.handle) || '',
                        visibility: targetPost.visibility || 'public',
                        moderationHidden: !!targetPost.moderationHidden
                    }
                    : null,
                isUnresolved: unresolvedStatuses.has(status)
            };
        });
        const totalUsers = users.length;
        const signupsLast30Days = users.reduce((count, user) => {
            const createdAtMs = readMillis(user === null || user === void 0 ? void 0 : user.createdAt);
            return createdAtMs >= thirtyDaysAgo ? count + 1 : count;
        }, 0);
        const openPostReports = mappedReports.filter((report) => report.type === 'post' && report.isUnresolved).length;
        const openUserReports = mappedReports.filter((report) => report.type === 'user' && report.isUnresolved).length;
        const companyIds = Array.from(new Set(recentCompanySubscriptions
            .map((subscription) => (typeof (subscription === null || subscription === void 0 ? void 0 : subscription.ownerId) === 'string' ? subscription.ownerId : ''))
            .filter((id) => id.trim().length > 0)));
        const companies = companyIds.length > 0
            ? yield db.collection('companies')
                .find({ id: { $in: companyIds } })
                .project({ _id: 0, id: 1, name: 1, handle: 1 })
                .toArray()
            : [];
        const companyById = new Map();
        companies.forEach((company) => {
            if (typeof (company === null || company === void 0 ? void 0 : company.id) === 'string' && company.id.trim().length > 0) {
                companyById.set(company.id, company);
            }
        });
        const packageBreakdownMap = new Map();
        recentCompanySubscriptions.forEach((subscription) => {
            const label = ((subscription === null || subscription === void 0 ? void 0 : subscription.packageName) || (subscription === null || subscription === void 0 ? void 0 : subscription.packageId) || 'Unknown').toString();
            packageBreakdownMap.set(label, (packageBreakdownMap.get(label) || 0) + 1);
        });
        const companiesWithSubscriptions = new Set(recentCompanySubscriptions
            .map((subscription) => (typeof (subscription === null || subscription === void 0 ? void 0 : subscription.ownerId) === 'string' ? subscription.ownerId : ''))
            .filter((id) => id.trim().length > 0));
        const companySubscriptions = recentCompanySubscriptions.map((subscription) => {
            const companyId = typeof (subscription === null || subscription === void 0 ? void 0 : subscription.ownerId) === 'string' ? subscription.ownerId : '';
            const company = companyById.get(companyId);
            const status = typeof (subscription === null || subscription === void 0 ? void 0 : subscription.status) === 'string' ? subscription.status : 'unknown';
            return {
                id: (subscription === null || subscription === void 0 ? void 0 : subscription.id) || '',
                companyId,
                companyName: (company === null || company === void 0 ? void 0 : company.name) || companyId || 'Unknown company',
                companyHandle: (company === null || company === void 0 ? void 0 : company.handle) || '',
                packageName: (subscription === null || subscription === void 0 ? void 0 : subscription.packageName) || (subscription === null || subscription === void 0 ? void 0 : subscription.packageId) || 'Unknown plan',
                status,
                startDate: readIsoTimestamp(subscription === null || subscription === void 0 ? void 0 : subscription.startDate),
                endDate: readIsoTimestamp(subscription === null || subscription === void 0 ? void 0 : subscription.endDate),
                createdAt: readIsoTimestamp(subscription === null || subscription === void 0 ? void 0 : subscription.createdAt),
                adsUsed: Number((subscription === null || subscription === void 0 ? void 0 : subscription.adsUsed) || 0),
                adLimit: Number((subscription === null || subscription === void 0 ? void 0 : subscription.adLimit) || 0)
            };
        });
        const creditUserIds = Array.from(new Set(recentCreditTransactions
            .map((transaction) => (typeof (transaction === null || transaction === void 0 ? void 0 : transaction.userId) === 'string' ? transaction.userId : ''))
            .filter((id) => id.trim().length > 0)));
        const creditUsers = creditUserIds.length > 0
            ? yield db.collection('users')
                .find({ id: { $in: creditUserIds } })
                .project({ _id: 0, id: 1, name: 1, handle: 1, email: 1 })
                .toArray()
            : [];
        const creditUserById = new Map();
        creditUsers.forEach((user) => {
            if (typeof (user === null || user === void 0 ? void 0 : user.id) === 'string' && user.id.trim().length > 0) {
                creditUserById.set(user.id, user);
            }
        });
        const creditBundleMap = new Map();
        let totalCreditsSold = 0;
        const creditPurchases = recentCreditTransactions.map((transaction) => {
            var _a, _b, _c, _d;
            const userId = typeof (transaction === null || transaction === void 0 ? void 0 : transaction.userId) === 'string' ? transaction.userId : '';
            const user = creditUserById.get(userId);
            const credits = Number((_b = (_a = transaction === null || transaction === void 0 ? void 0 : transaction.credits) !== null && _a !== void 0 ? _a : transaction === null || transaction === void 0 ? void 0 : transaction.amount) !== null && _b !== void 0 ? _b : 0);
            const bundleName = ((transaction === null || transaction === void 0 ? void 0 : transaction.bundleName) || 'Unknown bundle').toString();
            const bucket = creditBundleMap.get(bundleName) || { purchases: 0, credits: 0 };
            bucket.purchases += 1;
            bucket.credits += Number.isFinite(credits) ? credits : 0;
            creditBundleMap.set(bundleName, bucket);
            totalCreditsSold += Number.isFinite(credits) ? credits : 0;
            return {
                id: (transaction === null || transaction === void 0 ? void 0 : transaction.transactionId) || ((_d = (_c = transaction === null || transaction === void 0 ? void 0 : transaction._id) === null || _c === void 0 ? void 0 : _c.toString) === null || _d === void 0 ? void 0 : _d.call(_c)) || '',
                userId,
                userName: (user === null || user === void 0 ? void 0 : user.name) || 'Unknown',
                userHandle: (user === null || user === void 0 ? void 0 : user.handle) || '',
                userEmail: (user === null || user === void 0 ? void 0 : user.email) || '',
                bundleName,
                credits: Number.isFinite(credits) ? credits : 0,
                paymentMethod: (transaction === null || transaction === void 0 ? void 0 : transaction.paymentMethod) || 'unknown',
                status: (transaction === null || transaction === void 0 ? void 0 : transaction.status) || 'unknown',
                createdAt: readIsoTimestamp(transaction === null || transaction === void 0 ? void 0 : transaction.createdAt)
            };
        });
        return res.json({
            success: true,
            data: {
                metrics: {
                    totalUsers,
                    signupsLast30Days,
                    openPostReports,
                    openUserReports,
                    companiesWithSubscriptions: companiesWithSubscriptions.size,
                    totalCreditPurchases: creditPurchases.length,
                    totalCreditsSold
                },
                reports: mappedReports,
                companySubscriptions: {
                    packageBreakdown: Array.from(packageBreakdownMap.entries()).map(([packageName, count]) => ({
                        packageName,
                        count
                    })),
                    recent: companySubscriptions
                },
                creditPurchases: {
                    bundleBreakdown: Array.from(creditBundleMap.entries()).map(([bundleName, value]) => ({
                        bundleName,
                        purchases: value.purchases,
                        credits: value.credits
                    })),
                    recent: creditPurchases
                }
            }
        });
    }
    catch (error) {
        console.error('Error loading owner control overview:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to load control panel overview'
        });
    }
}));
router.patch('/reports/:reportId', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { reportId } = req.params;
        const status = typeof ((_a = req.body) === null || _a === void 0 ? void 0 : _a.status) === 'string' ? req.body.status.trim() : '';
        const adminNotes = typeof ((_b = req.body) === null || _b === void 0 ? void 0 : _b.adminNotes) === 'string' ? req.body.adminNotes.trim().slice(0, 500) : '';
        const reviewer = req.user;
        if (!REPORT_STATUS_VALUES.has(status)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid status value'
            });
        }
        const db = (0, db_1.getDB)();
        const now = new Date().toISOString();
        const updateResult = yield db.collection('reports').updateOne({ id: reportId }, {
            $set: {
                status,
                adminNotes,
                reviewedBy: (reviewer === null || reviewer === void 0 ? void 0 : reviewer.id) || 'admin',
                reviewedByEmail: (reviewer === null || reviewer === void 0 ? void 0 : reviewer.email) || '',
                updatedAt: now
            }
        });
        if (!updateResult.matchedCount) {
            return res.status(404).json({
                success: false,
                error: 'Report not found'
            });
        }
        const updated = yield db.collection('reports').findOne({ id: reportId });
        return res.json({
            success: true,
            data: updated
        });
    }
    catch (error) {
        console.error('Error updating report status:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update report'
        });
    }
}));
router.post('/users/:userId/suspend', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { userId } = req.params;
        const suspended = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.suspended) !== false;
        const reason = typeof ((_b = req.body) === null || _b === void 0 ? void 0 : _b.reason) === 'string' ? req.body.reason.trim().slice(0, 300) : '';
        const db = (0, db_1.getDB)();
        const now = new Date().toISOString();
        const updateResult = yield db.collection('users').updateOne({ id: userId }, {
            $set: {
                isSuspended: suspended,
                suspensionReason: suspended ? (reason || 'Suspended by owner control panel') : '',
                suspendedAt: suspended ? now : null,
                updatedAt: now
            }
        });
        if (!updateResult.matchedCount) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        return res.json({
            success: true,
            data: {
                userId,
                isSuspended: suspended,
                message: suspended ? isSuspendedMessage(reason) : 'Suspension removed'
            }
        });
    }
    catch (error) {
        console.error('Error updating suspension state:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update suspension state'
        });
    }
}));
router.post('/posts/:postId/hide', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { postId } = req.params;
        const hidden = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.hidden) !== false;
        const note = typeof ((_b = req.body) === null || _b === void 0 ? void 0 : _b.note) === 'string' ? req.body.note.trim().slice(0, 300) : '';
        const reviewer = req.user;
        const db = (0, db_1.getDB)();
        const post = yield db.collection('posts').findOne({ id: postId });
        if (!post) {
            return res.status(404).json({
                success: false,
                error: 'Post not found'
            });
        }
        const now = new Date().toISOString();
        if (hidden) {
            const originalVisibility = typeof (post === null || post === void 0 ? void 0 : post.visibility) === 'string' ? post.visibility : 'public';
            yield db.collection('posts').updateOne({ id: postId }, {
                $set: {
                    moderationHidden: true,
                    moderationHiddenAt: now,
                    moderationHiddenBy: (reviewer === null || reviewer === void 0 ? void 0 : reviewer.id) || 'owner-control-token',
                    moderationNote: note,
                    moderationOriginalVisibility: (post === null || post === void 0 ? void 0 : post.moderationOriginalVisibility) || originalVisibility,
                    visibility: 'private',
                    updatedAt: now
                }
            });
        }
        else {
            const restoreVisibility = typeof (post === null || post === void 0 ? void 0 : post.moderationOriginalVisibility) === 'string'
                ? post.moderationOriginalVisibility
                : (typeof (post === null || post === void 0 ? void 0 : post.visibility) === 'string' && post.visibility !== 'private' ? post.visibility : 'public');
            yield db.collection('posts').updateOne({ id: postId }, {
                $set: {
                    moderationHidden: false,
                    visibility: restoreVisibility,
                    updatedAt: now
                },
                $unset: {
                    moderationHiddenAt: '',
                    moderationHiddenBy: '',
                    moderationNote: '',
                    moderationOriginalVisibility: ''
                }
            });
        }
        const updated = yield db.collection('posts').findOne({ id: postId });
        return res.json({
            success: true,
            data: {
                id: (updated === null || updated === void 0 ? void 0 : updated.id) || postId,
                moderationHidden: !!(updated === null || updated === void 0 ? void 0 : updated.moderationHidden),
                visibility: (updated === null || updated === void 0 ? void 0 : updated.visibility) || 'public'
            }
        });
    }
    catch (error) {
        console.error('Error updating post moderation state:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update post moderation state'
        });
    }
}));
exports.default = router;
