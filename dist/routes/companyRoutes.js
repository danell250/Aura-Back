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
const express_1 = require("express");
const db_1 = require("../db");
const authMiddleware_1 = require("../middleware/authMiddleware");
const emailService_1 = require("../services/emailService");
const notificationsController_1 = require("../controllers/notificationsController");
const crypto_1 = __importDefault(require("crypto"));
const userUtils_1 = require("../utils/userUtils");
// Helper to generate unique handle for company
const generateCompanyHandle = (name) => __awaiter(void 0, void 0, void 0, function* () {
    const db = (0, db_1.getDB)();
    const baseHandle = `@${name.toLowerCase().trim().replace(/[^a-z0-9]/g, '')}`;
    // Try base handle first
    const existingUser = yield db.collection('users').findOne({ handle: baseHandle });
    const existingCompany = yield db.collection('companies').findOne({ handle: baseHandle });
    if (!existingUser && !existingCompany)
        return baseHandle;
    // Append random numbers until unique
    for (let i = 0; i < 10; i++) {
        const candidate = `${baseHandle}${Math.floor(Math.random() * 1000)}`;
        const user = yield db.collection('users').findOne({ handle: candidate });
        const comp = yield db.collection('companies').findOne({ handle: candidate });
        if (!user && !comp)
            return candidate;
    }
    return `@comp${Date.now()}`;
});
const router = (0, express_1.Router)();
// GET /api/companies/me - Get companies the current user belongs to
router.get('/me', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const currentUser = req.user;
        const db = (0, db_1.getDB)();
        const memberships = yield db.collection('company_members').find({ userId: currentUser.id }).toArray();
        const companyIds = memberships.map(m => m.companyId);
        // Also include the legacy company if it exists (where userId === companyId)
        if (!companyIds.includes(currentUser.id)) {
            const user = yield db.collection('users').findOne({ id: currentUser.id });
            if (user === null || user === void 0 ? void 0 : user.companyName) {
                companyIds.push(currentUser.id);
            }
        }
        const companies = yield db.collection('companies').find({ id: { $in: companyIds } }).toArray();
        // Fallback for legacy companies not in 'companies' collection yet
        const legacyIds = companyIds.filter(id => !companies.some(c => c.id === id));
        for (const lid of legacyIds) {
            const u = yield db.collection('users').findOne({ id: lid });
            if (u) {
                companies.push({
                    id: u.id,
                    name: u.companyName || u.name,
                    website: u.companyWebsite,
                    industry: u.industry,
                    location: u.location || '',
                    employeeCount: u.employeeCount,
                    email: u.companyEmail || '',
                    bio: u.bio,
                    isVerified: !!u.companyWebsite,
                    ownerId: u.id,
                    createdAt: u.createdAt || new Date(),
                    updatedAt: u.updatedAt || new Date()
                });
            }
        }
        // Merge role into company data
        const data = companies.map(c => {
            const membership = memberships.find(m => m.companyId === c.id);
            return Object.assign(Object.assign({}, c), { role: (membership === null || membership === void 0 ? void 0 : membership.role) || (c.ownerId === currentUser.id ? 'owner' : 'member') });
        });
        res.json({ success: true, data });
    }
    catch (error) {
        console.error('Get my companies error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch your corporate identities' });
    }
}));
// POST /api/companies - Create a new company
router.post('/', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const currentUser = req.user;
        const { name, industry, bio, website, location, employeeCount, email, handle: providedHandle } = req.body;
        const db = (0, db_1.getDB)();
        if (!name) {
            return res.status(400).json({ success: false, error: 'Identity name is required' });
        }
        const normalizedEmployeeCount = Number.isFinite(Number(employeeCount)) && Number(employeeCount) > 0
            ? Math.floor(Number(employeeCount))
            : undefined;
        const normalizedCompanyEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
        if (normalizedCompanyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedCompanyEmail)) {
            return res.status(400).json({ success: false, error: 'Company email is invalid' });
        }
        // Handle validation if provided
        let handle = providedHandle;
        if (handle) {
            handle = handle.startsWith('@') ? handle.toLowerCase() : `@${handle.toLowerCase()}`;
            if (!/^@[a-z0-9_]+$/.test(handle)) {
                return res.status(400).json({ success: false, error: 'Handle can only contain letters, numbers, and underscores' });
            }
            if (handle.length < 4 || handle.length > 30) {
                return res.status(400).json({ success: false, error: 'Handle must be between 3 and 30 characters' });
            }
            const existingUser = yield db.collection('users').findOne({ handle });
            const existingCompany = yield db.collection('companies').findOne({ handle });
            if (existingUser || existingCompany) {
                return res.status(409).json({ success: false, error: 'Handle already taken' });
            }
        }
        else {
            handle = yield generateCompanyHandle(name);
        }
        // 1. Limit validation: Check how many companies the user owns
        const ownedCompaniesCount = yield db.collection('companies').countDocuments({ ownerId: currentUser.id });
        const MAX_COMPANIES = 5;
        if (ownedCompaniesCount >= MAX_COMPANIES) {
            return res.status(403).json({
                success: false,
                error: `You have reached the maximum limit of ${MAX_COMPANIES} corporate identities.`
            });
        }
        const companyId = `comp-${crypto_1.default.randomBytes(8).toString('hex')}`;
        const newCompany = {
            id: companyId,
            name,
            handle,
            industry: industry || 'Technology',
            bio: bio || '',
            website: website || '',
            location: location || '',
            employeeCount: normalizedEmployeeCount,
            email: normalizedCompanyEmail || '',
            ownerId: currentUser.id,
            isVerified: !!website,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        yield db.collection('companies').insertOne(newCompany);
        // Add creator as owner
        yield db.collection('company_members').updateOne({ companyId, userId: currentUser.id }, {
            $set: {
                companyId,
                userId: currentUser.id,
                role: 'owner',
                joinedAt: new Date(),
                updatedAt: new Date()
            }
        }, { upsert: true });
        res.json({ success: true, data: newCompany });
    }
    catch (error) {
        console.error('Create company error:', error);
        res.status(500).json({ success: false, error: 'Failed to create corporate identity' });
    }
}));
// PATCH /api/companies/:companyId - Update company details
router.patch('/:companyId', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { companyId } = req.params;
        const currentUser = req.user;
        const rawUpdates = req.body || {};
        const updates = {};
        const db = (0, db_1.getDB)();
        const allowedFields = ['name', 'industry', 'bio', 'website', 'location', 'employeeCount', 'email', 'handle'];
        for (const field of allowedFields) {
            if (rawUpdates[field] !== undefined) {
                updates[field] = rawUpdates[field];
            }
        }
        // Verify currentUser is owner/admin
        const membership = yield db.collection('company_members').findOne({
            companyId,
            userId: currentUser.id,
            role: { $in: ['owner', 'admin'] }
        });
        if (!membership && currentUser.id !== companyId) {
            return res.status(403).json({ success: false, error: 'Unauthorized to update this corporate identity' });
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, error: 'No valid fields provided for update' });
        }
        if (updates.employeeCount !== undefined) {
            const normalizedEmployeeCount = Number.isFinite(Number(updates.employeeCount)) && Number(updates.employeeCount) > 0
                ? Math.floor(Number(updates.employeeCount))
                : null;
            if (normalizedEmployeeCount === null) {
                return res.status(400).json({ success: false, error: 'Employee count must be a positive number' });
            }
            updates.employeeCount = normalizedEmployeeCount;
        }
        if (updates.email !== undefined) {
            const normalizedCompanyEmail = typeof updates.email === 'string' ? updates.email.trim().toLowerCase() : '';
            if (normalizedCompanyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedCompanyEmail)) {
                return res.status(400).json({ success: false, error: 'Company email is invalid' });
            }
            updates.email = normalizedCompanyEmail;
        }
        // Auto-verify if website is added
        if (updates.website) {
            updates.isVerified = true;
        }
        // Handle handle updates
        if (updates.handle) {
            const normalizedHandle = updates.handle.startsWith('@') ? updates.handle.toLowerCase() : `@${updates.handle.toLowerCase()}`;
            // Validation: No spaces or special characters except @
            if (!/^@[a-z0-9_]+$/.test(normalizedHandle)) {
                return res.status(400).json({ success: false, error: 'Handle can only contain letters, numbers, and underscores' });
            }
            if (normalizedHandle.length < 4 || normalizedHandle.length > 30) {
                return res.status(400).json({ success: false, error: 'Handle must be between 3 and 30 characters' });
            }
            const existingUser = yield db.collection('users').findOne({ handle: normalizedHandle });
            const existingCompany = yield db.collection('companies').findOne({ handle: normalizedHandle, id: { $ne: companyId } });
            if (existingUser || existingCompany) {
                return res.status(409).json({ success: false, error: 'Handle already taken' });
            }
            updates.handle = normalizedHandle;
        }
        updates.updatedAt = new Date();
        const result = yield db.collection('companies').updateOne({ id: companyId }, { $set: updates });
        // If it was a legacy company in users collection
        if (result.matchedCount === 0 && companyId === currentUser.id) {
            yield db.collection('users').updateOne({ id: companyId }, {
                $set: {
                    companyName: updates.name,
                    companyWebsite: updates.website,
                    industry: updates.industry,
                    location: updates.location,
                    employeeCount: updates.employeeCount,
                    companyEmail: updates.email,
                    bio: updates.bio,
                    isVerified: updates.isVerified,
                    updatedAt: new Date().toISOString()
                }
            });
        }
        res.json({ success: true, message: 'Corporate identity updated successfully' });
    }
    catch (error) {
        console.error('Update company error:', error);
        res.status(500).json({ success: false, error: 'Failed to update corporate identity' });
    }
}));
// GET /api/companies/:id - Get a specific company
router.get('/:id', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const currentUser = req.user;
        const db = (0, db_1.getDB)();
        const company = yield db.collection('companies').findOne({ id });
        if (!company) {
            return res.status(404).json({ success: false, error: 'Corporate identity not found' });
        }
        // Access control: only members or owner can access management-level details
        // If we want public access, we should have a separate public route or filter sensitive data
        const membership = yield db.collection('company_members').findOne({
            companyId: id,
            userId: currentUser.id
        });
        if (!membership && company.ownerId !== currentUser.id && id !== currentUser.id) {
            // Check if this is a request for basic public info vs management info
            // For now, restrict this route to members only as it's used in management views
            return res.status(403).json({ success: false, error: 'You are not a member of this corporate identity' });
        }
        res.json({ success: true, data: company });
    }
    catch (error) {
        console.error('Get company error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch corporate identity' });
    }
}));
// POST /api/companies/:companyId/invites - Create invite
router.post('/:companyId/invites', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { companyId } = req.params;
        const { email, role } = req.body;
        const currentUser = req.user;
        if (!email || !role) {
            return res.status(400).json({ success: false, error: 'Email and role are required' });
        }
        const db = (0, db_1.getDB)();
        // Verify currentUser is owner/admin of the company
        const member = yield db.collection('company_members').findOne({
            companyId,
            userId: currentUser.id,
            role: { $in: ['owner', 'admin'] }
        });
        // If not in company_members, check if they ARE the company (initial setup)
        if (!member && currentUser.id !== companyId) {
            return res.status(403).json({ success: false, error: 'Unauthorized to invite' });
        }
        const token = crypto_1.default.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry
        // If the user already exists, send them a notification in the app
        const invitedUser = yield db.collection('users').findOne({ email: email.toLowerCase().trim() });
        const invite = {
            companyId,
            email: email.toLowerCase().trim(),
            role,
            token,
            status: 'pending',
            invitedByUserId: currentUser.id,
            targetUserId: (invitedUser === null || invitedUser === void 0 ? void 0 : invitedUser.id) || null,
            expiresAt,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        const insertResult = yield db.collection('company_invites').insertOne(invite);
        const inviteId = insertResult.insertedId.toString();
        // Get company name for the email/notification
        let companyName = 'A Company';
        const company = yield db.collection('companies').findOne({ id: companyId });
        if (company) {
            companyName = company.name;
        }
        else {
            // Fallback for legacy
            const legacyUser = yield db.collection('users').findOne({ id: companyId });
            companyName = (legacyUser === null || legacyUser === void 0 ? void 0 : legacyUser.companyName) || (legacyUser === null || legacyUser === void 0 ? void 0 : legacyUser.name) || 'A Company';
        }
        if (invitedUser) {
            yield (0, notificationsController_1.createNotificationInDB)(invitedUser.id, 'company_invite', currentUser.id, `invited you to join ${companyName} as ${role}`, undefined, undefined, { inviteId, companyId, role, token });
            console.log(`🔔 Notification sent to existing user ${invitedUser.id} for company invite`);
        }
        else {
            // If the user doesn't exist, send them an email invite link
            const inviteUrl = `${process.env.FRONTEND_URL || 'https://www.aura.net.za'}/?invite=${token}`;
            yield (0, emailService_1.sendCompanyInviteEmail)(invite.email, companyName, inviteUrl);
            console.log(`✉️ Email invite sent to new user ${invite.email}`);
        }
        res.json({ success: true, message: 'Invite sent successfully' });
    }
    catch (error) {
        console.error('Create invite error:', error);
        res.status(500).json({ success: false, error: 'Failed to create invite' });
    }
}));
// POST /api/companies/invites/accept - Accept invite token
router.post('/invites/accept', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { token } = req.body;
        const currentUser = req.user;
        if (!token) {
            return res.status(400).json({ success: false, error: 'Token is required' });
        }
        const db = (0, db_1.getDB)();
        const invite = yield db.collection('company_invites').findOne({
            token,
            expiresAt: { $gt: new Date() },
            status: 'pending'
        });
        if (!invite) {
            return res.status(404).json({ success: false, error: 'Invalid, expired, or already processed invite' });
        }
        // Add to members
        yield db.collection('company_members').updateOne({ companyId: invite.companyId, userId: currentUser.id }, {
            $set: {
                companyId: invite.companyId,
                userId: currentUser.id,
                role: invite.role,
                joinedAt: new Date(),
                updatedAt: new Date()
            }
        }, { upsert: true });
        // Mark invite as accepted
        yield db.collection('company_invites').updateOne({ _id: invite._id }, {
            $set: {
                status: 'accepted',
                acceptedAt: new Date(),
                acceptedByUserId: currentUser.id,
                updatedAt: new Date()
            }
        });
        // Update the notification to mark it as read/accepted
        yield db.collection('users').updateOne({ id: currentUser.id, 'notifications.type': 'company_invite', 'notifications.meta.token': token }, { $set: { 'notifications.$.isRead': true } });
        res.json({ success: true, message: 'Invite accepted successfully' });
    }
    catch (error) {
        console.error('Accept invite error:', error);
        res.status(500).json({ success: false, error: 'Failed to accept invite' });
    }
}));
// POST /api/companies/:companyId/invites/:inviteId/resend - Resend invite
router.post('/:companyId/invites/:inviteId/resend', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { companyId, inviteId } = req.params;
        const currentUser = req.user;
        const { ObjectId } = require('mongodb');
        const db = (0, db_1.getDB)();
        // Verify currentUser is owner/admin
        const requester = yield db.collection('company_members').findOne({
            companyId,
            userId: currentUser.id,
            role: { $in: ['owner', 'admin'] }
        });
        if (!requester && currentUser.id !== companyId) {
            return res.status(403).json({ success: false, error: 'Unauthorized' });
        }
        let query = {};
        try {
            query._id = new ObjectId(inviteId);
        }
        catch (e) {
            query.inviteId = inviteId;
        }
        query.companyId = companyId;
        const invite = yield db.collection('company_invites').findOne(query);
        if (!invite) {
            return res.status(404).json({ success: false, error: 'Invite not found' });
        }
        // Refresh expiry
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        yield db.collection('company_invites').updateOne({ _id: invite._id }, {
            $set: {
                expiresAt,
                updatedAt: new Date()
            }
        });
        // Get company name
        let companyName = 'A Company';
        const company = yield db.collection('companies').findOne({ id: companyId });
        if (company) {
            companyName = company.name;
        }
        else {
            const legacyUser = yield db.collection('users').findOne({ id: companyId });
            companyName = (legacyUser === null || legacyUser === void 0 ? void 0 : legacyUser.companyName) || (legacyUser === null || legacyUser === void 0 ? void 0 : legacyUser.name) || 'A Company';
        }
        if (invite.targetUserId) {
            yield (0, notificationsController_1.createNotificationInDB)(invite.targetUserId, 'company_invite', currentUser.id, `resent an invite to join ${companyName} as ${invite.role}`, undefined, undefined, { inviteId: invite._id.toString(), companyId, role: invite.role, token: invite.token });
        }
        else {
            const inviteUrl = `${process.env.FRONTEND_URL || 'https://www.aura.net.za'}/?invite=${invite.token}`;
            yield (0, emailService_1.sendCompanyInviteEmail)(invite.email, companyName, inviteUrl);
        }
        res.json({ success: true, message: 'Invite resent successfully' });
    }
    catch (error) {
        console.error('Resend invite error:', error);
        res.status(500).json({ success: false, error: 'Failed to resend invite' });
    }
}));
// GET /api/companies/:companyId/members - List members
router.get('/:companyId/members', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { companyId } = req.params;
        const currentUser = req.user;
        const db = (0, db_1.getDB)();
        // Verify currentUser is a member or the company itself
        const isMember = yield db.collection('company_members').findOne({
            companyId,
            userId: currentUser.id
        });
        if (!isMember && currentUser.id !== companyId) {
            return res.status(403).json({ success: false, error: 'Unauthorized to view members' });
        }
        const members = yield db.collection('company_members').aggregate([
            { $match: { companyId } },
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: 'id',
                    as: 'userDetails'
                }
            },
            { $unwind: '$userDetails' },
            {
                $project: {
                    userId: 1,
                    role: 1,
                    joinedAt: 1,
                    name: '$userDetails.name',
                    email: '$userDetails.email',
                    avatar: '$userDetails.avatar'
                }
            }
        ]).toArray();
        res.json({ success: true, data: members });
    }
    catch (error) {
        console.error('Get members error:', error);
        res.status(500).json({ success: false, error: 'Failed to get members' });
    }
}));
// GET /api/companies/:companyId/invites - List pending invites
router.get('/:companyId/invites', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { companyId } = req.params;
        const currentUser = req.user;
        const db = (0, db_1.getDB)();
        // Verify currentUser is owner/admin
        const requester = yield db.collection('company_members').findOne({
            companyId,
            userId: currentUser.id,
            role: { $in: ['owner', 'admin'] }
        });
        if (!requester && currentUser.id !== companyId) {
            return res.status(403).json({ success: false, error: 'Unauthorized to view invites' });
        }
        const invites = yield db.collection('company_invites').find({
            companyId,
            status: 'pending',
            expiresAt: { $gt: new Date() }
        }).toArray();
        res.json({ success: true, data: invites });
    }
    catch (error) {
        console.error('Get invites error:', error);
        res.status(500).json({ success: false, error: 'Failed to get invites' });
    }
}));
// DELETE /api/companies/:companyId/invites/:inviteId - Cancel invite
router.delete('/:companyId/invites/:inviteId', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { companyId, inviteId } = req.params;
        const currentUser = req.user;
        const { ObjectId } = require('mongodb');
        const db = (0, db_1.getDB)();
        // Verify currentUser is owner/admin
        const requester = yield db.collection('company_members').findOne({
            companyId,
            userId: currentUser.id,
            role: { $in: ['owner', 'admin'] }
        });
        if (!requester && currentUser.id !== companyId) {
            return res.status(403).json({ success: false, error: 'Unauthorized' });
        }
        let query = {};
        try {
            query._id = new ObjectId(inviteId);
        }
        catch (e) {
            // If not a valid ObjectId, try finding by custom inviteId field if it exists
            query.inviteId = inviteId;
        }
        query.companyId = companyId;
        const result = yield db.collection('company_invites').updateOne(query, {
            $set: {
                status: 'cancelled',
                updatedAt: new Date()
            }
        });
        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, error: 'Invite not found' });
        }
        res.json({ success: true, message: 'Invite cancelled successfully' });
    }
    catch (error) {
        console.error('Cancel invite error:', error);
        res.status(500).json({ success: false, error: 'Failed to cancel invite' });
    }
}));
// POST /api/companies/invites/:inviteId/accept - Accept invite by ID
router.post('/invites/:inviteId/accept', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { inviteId } = req.params;
        const currentUser = req.user;
        const { ObjectId } = require('mongodb');
        const db = (0, db_1.getDB)();
        let query = {
            status: 'pending',
            expiresAt: { $gt: new Date() }
        };
        try {
            query._id = new ObjectId(inviteId);
        }
        catch (e) {
            query.inviteId = inviteId;
        }
        const invite = yield db.collection('company_invites').findOne(query);
        if (!invite) {
            return res.status(404).json({ success: false, error: 'Invalid, expired, or already processed invite' });
        }
        // Check if target matches user email or targetUserId
        const user = yield db.collection('users').findOne({ id: currentUser.id });
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        const emailMatch = invite.email.toLowerCase() === user.email.toLowerCase();
        const idMatch = invite.targetUserId === user.id;
        if (!emailMatch && !idMatch) {
            return res.status(403).json({ success: false, error: 'This invite was not intended for you' });
        }
        // Add to members
        yield db.collection('company_members').updateOne({ companyId: invite.companyId, userId: currentUser.id }, {
            $set: {
                companyId: invite.companyId,
                userId: currentUser.id,
                role: invite.role,
                joinedAt: new Date(),
                updatedAt: new Date()
            }
        }, { upsert: true });
        // Mark invite as accepted
        yield db.collection('company_invites').updateOne({ _id: invite._id }, {
            $set: {
                status: 'accepted',
                acceptedAt: new Date(),
                acceptedByUserId: currentUser.id,
                updatedAt: new Date()
            }
        });
        // Mark notification as read
        yield db.collection('users').updateOne({ id: currentUser.id, 'notifications.meta.inviteId': inviteId }, { $set: { 'notifications.$.isRead': true } });
        res.json({ success: true, message: 'Invite accepted successfully' });
    }
    catch (error) {
        console.error('Accept invite error:', error);
        res.status(500).json({ success: false, error: 'Failed to accept invite' });
    }
}));
// POST /api/companies/invites/:inviteId/decline - Decline invite
router.post('/invites/:inviteId/decline', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { inviteId } = req.params;
        const currentUser = req.user;
        const { ObjectId } = require('mongodb');
        const db = (0, db_1.getDB)();
        let query = {
            status: 'pending'
        };
        try {
            query._id = new ObjectId(inviteId);
        }
        catch (e) {
            query.inviteId = inviteId;
        }
        const invite = yield db.collection('company_invites').findOne(query);
        if (!invite) {
            return res.status(404).json({ success: false, error: 'Invite not found or already processed' });
        }
        // Verify this invite is for the current user
        const user = yield db.collection('users').findOne({ id: currentUser.id });
        if (!user || (invite.email.toLowerCase() !== user.email.toLowerCase() && invite.targetUserId !== user.id)) {
            return res.status(403).json({ success: false, error: 'Unauthorized' });
        }
        yield db.collection('company_invites').updateOne({ _id: invite._id }, {
            $set: {
                status: 'declined',
                updatedAt: new Date()
            }
        });
        // Mark notification as read
        yield db.collection('users').updateOne({ id: currentUser.id, 'notifications.meta.inviteId': inviteId }, { $set: { 'notifications.$.isRead': true } });
        res.json({ success: true, message: 'Invite declined' });
    }
    catch (error) {
        console.error('Decline invite error:', error);
        res.status(500).json({ success: false, error: 'Failed to decline invite' });
    }
}));
// DELETE /api/companies/:companyId/members/:userId - Remove member
router.delete('/:companyId/members/:userId', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { companyId, userId } = req.params;
        const currentUser = req.user;
        const db = (0, db_1.getDB)();
        // Verify currentUser is owner/admin
        const requester = yield db.collection('company_members').findOne({
            companyId,
            userId: currentUser.id,
            role: { $in: ['owner', 'admin'] }
        });
        if (!requester && currentUser.id !== companyId) {
            return res.status(403).json({ success: false, error: 'Unauthorized' });
        }
        yield db.collection('company_members').deleteOne({ companyId, userId });
        res.json({ success: true, message: 'Member removed successfully' });
    }
    catch (error) {
        console.error('Remove member error:', error);
        res.status(500).json({ success: false, error: 'Failed to remove member' });
    }
}));
router.post('/:companyId/subscribe', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { companyId } = req.params;
    const currentUser = req.user;
    const db = (0, db_1.getDB)();
    const company = yield db.collection('companies').findOne({ id: companyId });
    if (!company)
        return res.status(404).json({ success: false, error: 'Company not found' });
    yield db.collection('users').updateOne({ id: currentUser.id }, { $addToSet: { subscribedCompanyIds: companyId }, $set: { updatedAt: new Date().toISOString() } });
    yield db.collection('companies').updateOne({ id: companyId }, { $addToSet: { subscribers: currentUser.id }, $set: { updatedAt: new Date() } });
    const refreshed = yield db.collection('companies').findOne({ id: companyId });
    const subscribers = Array.isArray(refreshed === null || refreshed === void 0 ? void 0 : refreshed.subscribers) ? [...new Set(refreshed.subscribers)] : [];
    yield db.collection('companies').updateOne({ id: companyId }, { $set: { subscriberCount: subscribers.length, subscribers } });
    return res.json({ success: true, data: { subscribed: true, subscriberCount: subscribers.length } });
}));
router.post('/:companyId/unsubscribe', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { companyId } = req.params;
    const currentUser = req.user;
    const db = (0, db_1.getDB)();
    yield db.collection('users').updateOne({ id: currentUser.id }, { $pull: { subscribedCompanyIds: companyId }, $set: { updatedAt: new Date().toISOString() } });
    yield db.collection('companies').updateOne({ id: companyId }, { $pull: { subscribers: currentUser.id }, $set: { updatedAt: new Date() } });
    const refreshed = yield db.collection('companies').findOne({ id: companyId });
    const subscribers = Array.isArray(refreshed === null || refreshed === void 0 ? void 0 : refreshed.subscribers) ? [...new Set(refreshed.subscribers)] : [];
    yield db.collection('companies').updateOne({ id: companyId }, { $set: { subscriberCount: subscribers.length, subscribers } });
    return res.json({ success: true, data: { subscribed: false, subscriberCount: subscribers.length } });
}));
router.get('/:companyId/subscribers', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { companyId } = req.params;
    const db = (0, db_1.getDB)();
    const company = yield db.collection('companies').findOne({ id: companyId });
    if (!company)
        return res.status(404).json({ success: false, error: 'Company not found' });
    const ids = Array.isArray(company.subscribers) ? company.subscribers : [];
    const users = ids.length ? yield db.collection('users').find({ id: { $in: ids } }).toArray() : [];
    return res.json({
        success: true,
        data: users.map(u => (0, userUtils_1.transformUser)(u)),
        count: ids.length
    });
}));
exports.default = router;
