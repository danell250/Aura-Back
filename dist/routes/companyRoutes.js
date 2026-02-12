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
const crypto_1 = __importDefault(require("crypto"));
const router = (0, express_1.Router)();
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
        const invite = {
            companyId,
            email: email.toLowerCase().trim(),
            role,
            token,
            expiresAt,
            createdAt: new Date(),
            invitedBy: currentUser.id
        };
        yield db.collection('company_invites').insertOne(invite);
        // Get company name for the email
        const company = yield db.collection('users').findOne({ id: companyId });
        const companyName = (company === null || company === void 0 ? void 0 : company.name) || 'A Company';
        const inviteUrl = `${process.env.FRONTEND_URL || 'https://aura.net.za'}/?invite=${token}`;
        yield (0, emailService_1.sendCompanyInviteEmail)(invite.email, companyName, inviteUrl);
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
            acceptedAt: { $exists: false }
        });
        if (!invite) {
            return res.status(404).json({ success: false, error: 'Invalid or expired invite' });
        }
        // Add to members
        yield db.collection('company_members').updateOne({ companyId: invite.companyId, userId: currentUser.id }, {
            $set: {
                companyId: invite.companyId,
                userId: currentUser.id,
                role: invite.role,
                joinedAt: new Date()
            }
        }, { upsert: true });
        // Mark invite as accepted
        yield db.collection('company_invites').updateOne({ _id: invite._id }, { $set: { acceptedAt: new Date(), acceptedByUserId: currentUser.id } });
        res.json({ success: true, message: 'Invite accepted successfully' });
    }
    catch (error) {
        console.error('Accept invite error:', error);
        res.status(500).json({ success: false, error: 'Failed to accept invite' });
    }
}));
// GET /api/companies/:companyId/members - List members
router.get('/:companyId/members', authMiddleware_1.requireAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { companyId } = req.params;
        const db = (0, db_1.getDB)();
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
exports.default = router;
