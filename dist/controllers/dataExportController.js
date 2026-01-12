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
exports.dataExportController = void 0;
const db_1 = require("../db");
const puppeteer_1 = __importDefault(require("puppeteer"));
exports.dataExportController = {
    // GET /api/data-export/request/:userId - Request data export
    requestDataExport: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { userId } = req.params;
            const { format = 'json' } = req.query; // Support format parameter
            console.log(`Data export requested for user ${userId} in ${format} format`);
            const db = (0, db_1.getDB)();
            const user = yield db.collection('users').findOne({ id: userId });
            if (!user) {
                console.error(`User not found: ${userId}`);
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: `User with ID ${userId} does not exist`
                });
            }
            // Generate export request ID
            const exportRequestId = `export-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
            // Create export request record
            const exportRequest = {
                id: exportRequestId,
                userId: userId,
                format: format,
                status: 'processing',
                requestedAt: new Date().toISOString(),
                completedAt: null,
                downloadUrl: null,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
            };
            console.log('Processing data export:', exportRequest);
            try {
                // Process the export immediately (in production, this would be queued)
                const exportData = yield generateUserDataExport(userId, db);
                // Update export request
                const updatedExportRequest = Object.assign(Object.assign({}, exportRequest), { status: 'completed', completedAt: new Date().toISOString(), downloadUrl: `/api/data-export/download/${exportRequestId}` });
                // Store the export data temporarily (in production, save to file storage)
                yield db.collection('dataExports').insertOne(Object.assign(Object.assign({}, updatedExportRequest), { data: exportData }));
                console.log('Data export completed successfully:', exportRequestId);
                res.json({
                    success: true,
                    data: {
                        exportRequestId,
                        status: 'completed',
                        format: format,
                        downloadUrl: updatedExportRequest.downloadUrl,
                        expiresAt: updatedExportRequest.expiresAt,
                        dataSize: JSON.stringify(exportData).length,
                        recordCount: calculateRecordCount(exportData)
                    },
                    message: 'Data export completed successfully'
                });
            }
            catch (exportError) {
                console.error('Error during data export generation:', exportError);
                // Store failed export record
                yield db.collection('dataExports').insertOne(Object.assign(Object.assign({}, exportRequest), { status: 'failed', error: exportError instanceof Error ? exportError.message : 'Unknown error', completedAt: new Date().toISOString() }));
                return res.status(500).json({
                    success: false,
                    error: 'Export generation failed',
                    message: exportError instanceof Error ? exportError.message : 'Failed to generate export data'
                });
            }
        }
        catch (error) {
            console.error('Error requesting data export:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to request data export',
                message: error instanceof Error ? error.message : 'Internal server error'
            });
        }
    }),
    // GET /api/data-export/download/:exportId - Download exported data
    downloadDataExport: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { exportId } = req.params;
            const db = (0, db_1.getDB)();
            const exportRecord = yield db.collection('dataExports').findOne({ id: exportId });
            if (!exportRecord) {
                return res.status(404).json({
                    success: false,
                    error: 'Export not found',
                    message: 'The requested data export does not exist or has expired'
                });
            }
            // Check if export has expired
            if (new Date() > new Date(exportRecord.expiresAt)) {
                return res.status(410).json({
                    success: false,
                    error: 'Export expired',
                    message: 'This data export has expired and is no longer available'
                });
            }
            const format = exportRecord.format || 'json';
            if (format === 'pdf') {
                // Generate and serve PDF
                const pdfBuffer = yield generatePDFExport(exportRecord.data);
                const filename = `aura-data-export-${exportRecord.userId}-${new Date().toISOString().split('T')[0]}.pdf`;
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Content-Length', pdfBuffer.length.toString());
                res.send(pdfBuffer);
            }
            else {
                // Serve JSON (default)
                const filename = `aura-data-export-${exportRecord.userId}-${new Date().toISOString().split('T')[0]}.json`;
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                res.setHeader('Cache-Control', 'no-cache');
                res.json(exportRecord.data);
            }
        }
        catch (error) {
            console.error('Error downloading data export:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to download data export',
                message: error instanceof Error ? error.message : 'Internal server error'
            });
        }
    }),
    // GET /api/data-export/status/:exportId - Check export status
    getExportStatus: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { exportId } = req.params;
            const db = (0, db_1.getDB)();
            const exportRecord = yield db.collection('dataExports').findOne({ id: exportId });
            if (!exportRecord) {
                return res.status(404).json({
                    success: false,
                    error: 'Export not found',
                    message: 'The requested data export does not exist'
                });
            }
            res.json({
                success: true,
                data: {
                    exportRequestId: exportRecord.id,
                    status: exportRecord.status,
                    requestedAt: exportRecord.requestedAt,
                    completedAt: exportRecord.completedAt,
                    downloadUrl: exportRecord.downloadUrl,
                    expiresAt: exportRecord.expiresAt,
                    dataSize: exportRecord.data ? JSON.stringify(exportRecord.data).length : 0,
                    recordCount: exportRecord.data ? calculateRecordCount(exportRecord.data) : 0
                },
                message: 'Export status retrieved successfully'
            });
        }
        catch (error) {
            console.error('Error getting export status:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get export status',
                message: 'Internal server error'
            });
        }
    }),
    // DELETE /api/data-export/:exportId - Delete export data
    deleteExport: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { exportId } = req.params;
            const db = (0, db_1.getDB)();
            const result = yield db.collection('dataExports').deleteOne({ id: exportId });
            if (result.deletedCount === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Export not found',
                    message: 'The requested data export does not exist'
                });
            }
            res.json({
                success: true,
                message: 'Data export deleted successfully'
            });
        }
        catch (error) {
            console.error('Error deleting export:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete export',
                message: 'Internal server error'
            });
        }
    })
};
// Helper function to generate comprehensive user data export
function generateUserDataExport(userId, db) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        const exportData = {
            exportInfo: {
                userId: userId,
                exportedAt: new Date().toISOString(),
                exportVersion: '1.0',
                format: 'JSON',
                description: 'Complete personal data export from Aura Social Platform',
                summary: {
                    totalPosts: 0,
                    totalComments: 0,
                    totalReactions: 0,
                    totalAcquaintances: 0,
                    totalNotifications: 0,
                    totalMessages: 0,
                    accountAge: 0,
                    lastActivity: null
                },
                errors: []
            },
            personalInformation: {},
            accountData: {},
            contentData: {
                posts: [],
                comments: [],
                reactions: []
            },
            socialData: {
                acquaintances: [],
                blockedUsers: [],
                profileViews: [],
                sentConnectionRequests: []
            },
            privacyData: {
                settings: {},
                consentRecords: [],
                dataProcessingHistory: []
            },
            activityData: {
                loginHistory: [],
                analyticsEvents: [],
                interactions: []
            },
            systemData: {
                notifications: [],
                messages: {
                    sent: [],
                    received: []
                },
                subscriptions: []
            }
        };
        try {
            // 1. Get user's personal information
            const user = yield db.collection('users').findOne({ id: userId });
            if (user) {
                exportData.personalInformation = {
                    id: user.id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    name: user.name,
                    email: user.email,
                    phone: user.phone || '',
                    dob: user.dob || '',
                    bio: user.bio || '',
                    handle: user.handle,
                    avatar: user.avatar,
                    avatarType: user.avatarType,
                    coverImage: user.coverImage,
                    coverType: user.coverType,
                    zodiacSign: user.zodiacSign,
                    industry: user.industry,
                    companyName: user.companyName,
                    employeeCount: user.employeeCount,
                    isCompany: user.isCompany || false,
                    createdAt: user.createdAt,
                    updatedAt: user.updatedAt,
                    lastLogin: user.lastLogin
                };
                exportData.accountData = {
                    trustScore: user.trustScore,
                    auraCredits: user.auraCredits,
                    activeGlow: user.activeGlow,
                    isPrivate: user.isPrivate || false,
                    googleId: user.googleId
                };
                exportData.socialData = {
                    acquaintances: user.acquaintances || [],
                    blockedUsers: user.blockedUsers || [],
                    profileViews: user.profileViews || [],
                    sentConnectionRequests: user.sentConnectionRequests || []
                };
                exportData.privacyData.settings = user.privacySettings || {};
            }
            // 2. Get user's posts
            const posts = yield db.collection('posts').find({ 'author.id': userId }).toArray();
            exportData.contentData.posts = posts.map((post) => ({
                id: post.id,
                content: post.content,
                mediaUrl: post.mediaUrl,
                mediaType: post.mediaType,
                energy: post.energy,
                radiance: post.radiance,
                timestamp: post.timestamp,
                reactions: post.reactions || {},
                hashtags: post.hashtags || [],
                isTimeCapsule: post.isTimeCapsule || false,
                unlockDate: post.unlockDate,
                timeCapsuleType: post.timeCapsuleType,
                timeCapsuleTitle: post.timeCapsuleTitle,
                createdAt: post.createdAt || new Date(post.timestamp).toISOString()
            }));
            // 3. Get user's comments
            const comments = yield db.collection('comments').find({ 'author.id': userId }).toArray();
            exportData.contentData.comments = comments.map((comment) => ({
                id: comment.id,
                postId: comment.postId,
                text: comment.text,
                timestamp: comment.timestamp,
                parentId: comment.parentId,
                reactions: comment.reactions || {},
                createdAt: comment.createdAt || new Date(comment.timestamp).toISOString()
            }));
            // 4. Get user's reactions (from posts and comments they reacted to)
            const postsWithUserReactions = yield db.collection('posts').find({
                [`userReactions.${userId}`]: { $exists: true }
            }).toArray();
            const commentsWithUserReactions = yield db.collection('comments').find({
                [`userReactions.${userId}`]: { $exists: true }
            }).toArray();
            exportData.contentData.reactions = [
                ...postsWithUserReactions.map((post) => ({
                    type: 'post',
                    targetId: post.id,
                    reaction: post.userReactions[userId],
                    timestamp: new Date().toISOString() // In production, store reaction timestamps
                })),
                ...commentsWithUserReactions.map((comment) => ({
                    type: 'comment',
                    targetId: comment.id,
                    postId: comment.postId,
                    reaction: comment.userReactions[userId],
                    timestamp: new Date().toISOString()
                }))
            ];
            // 5. Get user's notifications
            const notifications = yield db.collection('notifications').find({ userId: userId }).toArray();
            exportData.systemData.notifications = notifications.map((notification) => {
                var _a;
                return ({
                    id: notification.id,
                    type: notification.type,
                    message: notification.message,
                    timestamp: notification.timestamp,
                    isRead: notification.isRead,
                    fromUserId: (_a = notification.fromUser) === null || _a === void 0 ? void 0 : _a.id,
                    postId: notification.postId,
                    createdAt: notification.createdAt || new Date(notification.timestamp).toISOString()
                });
            });
            // 6. Get user's messages
            const sentMessages = yield db.collection('messages').find({ senderId: userId }).toArray();
            const receivedMessages = yield db.collection('messages').find({ receiverId: userId }).toArray();
            exportData.systemData.messages = {
                sent: sentMessages.map((msg) => ({
                    id: msg.id,
                    receiverId: msg.receiverId,
                    text: msg.text,
                    timestamp: msg.timestamp,
                    messageType: msg.messageType,
                    mediaUrl: msg.mediaUrl,
                    isRead: msg.isRead,
                    createdAt: msg.createdAt || new Date(msg.timestamp).toISOString()
                })),
                received: receivedMessages.map((msg) => ({
                    id: msg.id,
                    senderId: msg.senderId,
                    text: msg.text,
                    timestamp: msg.timestamp,
                    messageType: msg.messageType,
                    mediaUrl: msg.mediaUrl,
                    isRead: msg.isRead,
                    createdAt: msg.createdAt || new Date(msg.timestamp).toISOString()
                }))
            };
            // 7. Get analytics events (if user consented)
            if ((_a = user === null || user === void 0 ? void 0 : user.privacySettings) === null || _a === void 0 ? void 0 : _a.analyticsConsent) {
                // In production, you'd have an analytics collection
                exportData.activityData.analyticsEvents = [
                    {
                        note: 'Analytics events would be included here if available',
                        consentGiven: true,
                        dataTypes: ['page_views', 'user_interactions', 'feature_usage']
                    }
                ];
            }
            // 8. Add privacy and consent records
            exportData.privacyData.consentRecords = [
                {
                    type: 'data_processing',
                    consent: ((_b = user === null || user === void 0 ? void 0 : user.privacySettings) === null || _b === void 0 ? void 0 : _b.dataProcessingConsent) || false,
                    timestamp: ((_c = user === null || user === void 0 ? void 0 : user.privacySettings) === null || _c === void 0 ? void 0 : _c.updatedAt) || (user === null || user === void 0 ? void 0 : user.createdAt) || new Date().toISOString()
                },
                {
                    type: 'analytics',
                    consent: ((_d = user === null || user === void 0 ? void 0 : user.privacySettings) === null || _d === void 0 ? void 0 : _d.analyticsConsent) || false,
                    timestamp: ((_e = user === null || user === void 0 ? void 0 : user.privacySettings) === null || _e === void 0 ? void 0 : _e.updatedAt) || (user === null || user === void 0 ? void 0 : user.createdAt) || new Date().toISOString()
                },
                {
                    type: 'marketing',
                    consent: ((_f = user === null || user === void 0 ? void 0 : user.privacySettings) === null || _f === void 0 ? void 0 : _f.marketingConsent) || false,
                    timestamp: ((_g = user === null || user === void 0 ? void 0 : user.privacySettings) === null || _g === void 0 ? void 0 : _g.updatedAt) || (user === null || user === void 0 ? void 0 : user.createdAt) || new Date().toISOString()
                },
                {
                    type: 'third_party_sharing',
                    consent: ((_h = user === null || user === void 0 ? void 0 : user.privacySettings) === null || _h === void 0 ? void 0 : _h.thirdPartySharing) || false,
                    timestamp: ((_j = user === null || user === void 0 ? void 0 : user.privacySettings) === null || _j === void 0 ? void 0 : _j.updatedAt) || (user === null || user === void 0 ? void 0 : user.createdAt) || new Date().toISOString()
                }
            ];
            // 9. Add data processing history
            exportData.privacyData.dataProcessingHistory = [
                {
                    action: 'account_created',
                    timestamp: (user === null || user === void 0 ? void 0 : user.createdAt) || new Date().toISOString(),
                    description: 'User account created with initial data processing consent'
                },
                {
                    action: 'privacy_settings_updated',
                    timestamp: ((_k = user === null || user === void 0 ? void 0 : user.privacySettings) === null || _k === void 0 ? void 0 : _k.updatedAt) || (user === null || user === void 0 ? void 0 : user.createdAt) || new Date().toISOString(),
                    description: 'Privacy settings last updated by user'
                },
                {
                    action: 'data_export_requested',
                    timestamp: new Date().toISOString(),
                    description: 'User requested complete data export (GDPR Article 20)'
                }
            ];
            // 10. Add summary statistics
            exportData.exportInfo.summary = {
                totalPosts: exportData.contentData.posts.length,
                totalComments: exportData.contentData.comments.length,
                totalReactions: exportData.contentData.reactions.length,
                totalAcquaintances: exportData.socialData.acquaintances.length,
                totalNotifications: exportData.systemData.notifications.length,
                totalMessages: exportData.systemData.messages.sent.length + exportData.systemData.messages.received.length,
                accountAge: (user === null || user === void 0 ? void 0 : user.createdAt) ? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24)) : 0,
                lastActivity: (user === null || user === void 0 ? void 0 : user.lastLogin) || null
            };
        }
        catch (error) {
            console.error('Error generating user data export:', error);
            exportData.exportInfo.errors = [
                {
                    message: 'Some data could not be exported due to technical issues',
                    timestamp: new Date().toISOString(),
                    error: error instanceof Error ? error.message : 'Unknown error'
                }
            ];
        }
        return exportData;
    });
}
// Helper function to calculate record count
function calculateRecordCount(exportData) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    let count = 0;
    if (exportData.personalInformation)
        count += 1;
    if (exportData.accountData)
        count += 1;
    if ((_a = exportData.contentData) === null || _a === void 0 ? void 0 : _a.posts)
        count += exportData.contentData.posts.length;
    if ((_b = exportData.contentData) === null || _b === void 0 ? void 0 : _b.comments)
        count += exportData.contentData.comments.length;
    if ((_c = exportData.contentData) === null || _c === void 0 ? void 0 : _c.reactions)
        count += exportData.contentData.reactions.length;
    if ((_d = exportData.socialData) === null || _d === void 0 ? void 0 : _d.acquaintances)
        count += exportData.socialData.acquaintances.length;
    if ((_e = exportData.systemData) === null || _e === void 0 ? void 0 : _e.notifications)
        count += exportData.systemData.notifications.length;
    if ((_g = (_f = exportData.systemData) === null || _f === void 0 ? void 0 : _f.messages) === null || _g === void 0 ? void 0 : _g.sent)
        count += exportData.systemData.messages.sent.length;
    if ((_j = (_h = exportData.systemData) === null || _h === void 0 ? void 0 : _h.messages) === null || _j === void 0 ? void 0 : _j.received)
        count += exportData.systemData.messages.received.length;
    if ((_k = exportData.privacyData) === null || _k === void 0 ? void 0 : _k.consentRecords)
        count += exportData.privacyData.consentRecords.length;
    return count;
}
// Helper function to generate PDF export
function generatePDFExport(exportData) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const htmlContent = generateHTMLTemplate(exportData);
            // Use Puppeteer to generate PDF from HTML
            const browser = yield puppeteer_1.default.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = yield browser.newPage();
            yield page.setContent(htmlContent, { waitUntil: 'networkidle0' });
            const pdfBuffer = yield page.pdf({
                format: 'A4',
                printBackground: true,
                margin: {
                    top: '20px',
                    right: '20px',
                    bottom: '20px',
                    left: '20px'
                }
            });
            yield browser.close();
            return Buffer.from(pdfBuffer);
        }
        catch (error) {
            console.error('Error generating PDF:', error);
            throw new Error('Failed to generate PDF export');
        }
    });
}
// Helper function to generate HTML template for PDF
function generateHTMLTemplate(exportData) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const summary = ((_a = exportData.exportInfo) === null || _a === void 0 ? void 0 : _a.summary) || {};
    const personalInfo = exportData.personalInformation || {};
    const contentData = exportData.contentData || {};
    const socialData = exportData.socialData || {};
    const privacyData = exportData.privacyData || {};
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Aura Data Export - ${personalInfo.name || 'User'}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; color: #333; }
        .header { text-align: center; border-bottom: 2px solid #4F46E5; padding-bottom: 20px; margin-bottom: 30px; }
        .section { margin-bottom: 30px; page-break-inside: avoid; }
        .section-title { color: #4F46E5; font-size: 18px; font-weight: bold; margin-bottom: 15px; border-bottom: 1px solid #E5E7EB; padding-bottom: 5px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
        .info-item { padding: 8px; background: #F9FAFB; border-radius: 4px; }
        .info-label { font-weight: bold; color: #6B7280; }
        .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 20px 0; }
        .stat-card { text-align: center; padding: 15px; background: #F3F4F6; border-radius: 8px; }
        .stat-number { font-size: 24px; font-weight: bold; color: #4F46E5; }
        .stat-label { font-size: 12px; color: #6B7280; text-transform: uppercase; }
        .content-list { max-height: 300px; overflow: hidden; }
        .content-item { padding: 10px; border-left: 3px solid #4F46E5; margin-bottom: 10px; background: #F9FAFB; }
        .timestamp { color: #6B7280; font-size: 12px; }
        .footer { margin-top: 50px; text-align: center; color: #6B7280; font-size: 12px; border-top: 1px solid #E5E7EB; padding-top: 20px; }
        @media print { body { margin: 20px; } .section { page-break-inside: avoid; } }
    </style>
</head>
<body>
    <div class="header">
        <h1>Aura Data Export</h1>
        <p><strong>${personalInfo.name || 'User'}</strong> • Generated on ${new Date(((_b = exportData.exportInfo) === null || _b === void 0 ? void 0 : _b.exportedAt) || Date.now()).toLocaleDateString()}</p>
    </div>

    <div class="section">
        <h2 class="section-title">Export Summary</h2>
        <div class="stats">
            <div class="stat-card">
                <div class="stat-number">${summary.totalPosts || 0}</div>
                <div class="stat-label">Posts</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${summary.totalComments || 0}</div>
                <div class="stat-label">Comments</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${summary.totalAcquaintances || 0}</div>
                <div class="stat-label">Acquaintances</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${summary.totalMessages || 0}</div>
                <div class="stat-label">Messages</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${summary.totalNotifications || 0}</div>
                <div class="stat-label">Notifications</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${summary.accountAge || 0}</div>
                <div class="stat-label">Days Active</div>
            </div>
        </div>
    </div>

    <div class="section">
        <h2 class="section-title">Personal Information</h2>
        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">Name:</div>
                <div>${personalInfo.name || 'Not provided'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Email:</div>
                <div>${personalInfo.email || 'Not provided'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Handle:</div>
                <div>@${personalInfo.handle || 'Not set'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Account Created:</div>
                <div>${personalInfo.createdAt ? new Date(personalInfo.createdAt).toLocaleDateString() : 'Unknown'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Bio:</div>
                <div>${personalInfo.bio || 'No bio provided'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Industry:</div>
                <div>${personalInfo.industry || 'Not specified'}</div>
            </div>
        </div>
    </div>

    <div class="section">
        <h2 class="section-title">Recent Posts (Last 10)</h2>
        <div class="content-list">
            ${(contentData.posts || []).slice(0, 10).map((post) => `
                <div class="content-item">
                    <div>${post.content || 'No content'}</div>
                    <div class="timestamp">${post.timestamp ? new Date(post.timestamp).toLocaleString() : 'Unknown date'}</div>
                </div>
            `).join('')}
            ${(contentData.posts || []).length === 0 ? '<p>No posts found</p>' : ''}
        </div>
    </div>

    <div class="section">
        <h2 class="section-title">Privacy Settings</h2>
        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">Show Profile in Search:</div>
                <div>${((_c = privacyData.settings) === null || _c === void 0 ? void 0 : _c.showInSearch) !== false ? 'Yes' : 'No'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Show Online Status:</div>
                <div>${((_d = privacyData.settings) === null || _d === void 0 ? void 0 : _d.showOnlineStatus) !== false ? 'Yes' : 'No'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Allow Tagging:</div>
                <div>${((_e = privacyData.settings) === null || _e === void 0 ? void 0 : _e.allowTagging) !== false ? 'Yes' : 'No'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Email Notifications:</div>
                <div>${((_f = privacyData.settings) === null || _f === void 0 ? void 0 : _f.emailNotifications) !== false ? 'Yes' : 'No'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Analytics Consent:</div>
                <div>${((_g = privacyData.settings) === null || _g === void 0 ? void 0 : _g.analyticsConsent) === true ? 'Yes' : 'No'}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Show Profile Views:</div>
                <div>${((_h = privacyData.settings) === null || _h === void 0 ? void 0 : _h.showProfileViews) !== false ? 'Yes' : 'No'}</div>
            </div>
        </div>
    </div>

    <div class="section">
        <h2 class="section-title">Data Processing Consent Records</h2>
        ${(privacyData.consentRecords || []).map((record) => {
        var _a;
        return `
            <div class="content-item">
                <div><strong>${((_a = record.type) === null || _a === void 0 ? void 0 : _a.replace(/_/g, ' ').toUpperCase()) || 'Unknown'}:</strong> ${record.consent ? 'Granted' : 'Denied'}</div>
                <div class="timestamp">${record.timestamp ? new Date(record.timestamp).toLocaleString() : 'Unknown date'}</div>
            </div>
        `;
    }).join('')}
    </div>

    <div class="footer">
        <p>This export contains your personal data as stored in the Aura platform as of ${new Date(((_j = exportData.exportInfo) === null || _j === void 0 ? void 0 : _j.exportedAt) || Date.now()).toLocaleString()}.</p>
        <p>For the complete data export including all technical details, please download the JSON format.</p>
        <p>Export ID: ${((_k = exportData.exportInfo) === null || _k === void 0 ? void 0 : _k.userId) || 'Unknown'} • Version: ${((_l = exportData.exportInfo) === null || _l === void 0 ? void 0 : _l.exportVersion) || '1.0'}</p>
    </div>
</body>
</html>`;
}
