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
exports.birthdayController = void 0;
const db_1 = require("../db");
const notificationsController_1 = require("./notificationsController");
const geminiController_1 = require("./geminiController");
exports.birthdayController = {
    getTodayBirthdays(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const requester = req.user;
                if (!requester || !requester.id) {
                    return res.status(401).json({
                        success: false,
                        error: 'Unauthorized',
                        message: 'User must be authenticated to get birthday announcements'
                    });
                }
                const db = (0, db_1.getDB)();
                const dbUser = yield db.collection('users').findOne({ id: requester.id });
                if (!dbUser) {
                    return res.status(404).json({
                        success: false,
                        error: 'User not found',
                        message: 'Requesting user does not exist'
                    });
                }
                const acquaintances = dbUser.acquaintances || [];
                const idsToCheck = [...new Set([...acquaintances, dbUser.id])];
                if (idsToCheck.length === 0) {
                    return res.json({
                        success: true,
                        data: [],
                        message: 'No acquaintances to check for birthdays'
                    });
                }
                const today = new Date();
                const mmToday = today.getMonth() + 1;
                const ddToday = today.getDate();
                const currentYear = today.getFullYear();
                const users = yield db.collection('users').find({
                    id: { $in: idsToCheck },
                    dob: { $exists: true, $ne: '' }
                }).toArray();
                const birthdayUsers = users.filter(u => {
                    if (!u.dob)
                        return false;
                    const d = new Date(u.dob);
                    if (Number.isNaN(d.getTime()))
                        return false;
                    return (d.getMonth() + 1) === mmToday && d.getDate() === ddToday;
                });
                if (birthdayUsers.length === 0) {
                    return res.json({
                        success: true,
                        data: [],
                        message: 'No birthdays today'
                    });
                }
                const announcements = [];
                for (const person of birthdayUsers) {
                    const mockReq = { body: { name: person.firstName, bio: person.bio || '' } };
                    let wishText = '';
                    yield new Promise((resolve) => {
                        const mockRes = {
                            json: (payload) => {
                                wishText = payload.text || '';
                                resolve();
                            },
                            status: () => ({
                                json: (payload) => {
                                    wishText = payload.error || '';
                                    resolve();
                                }
                            })
                        };
                        (0, geminiController_1.generateQuirkyBirthdayWish)(mockReq, mockRes);
                    });
                    const postId = `bday-post-${person.id}-${currentYear}`;
                    const existingPost = yield db.collection('posts').findOne({
                        isSystemPost: true,
                        systemType: 'birthday',
                        ownerId: person.id,
                        birthdayYear: currentYear
                    });
                    if (!existingPost) {
                        const supportEmail = 'aurasocialradiate@gmail.com';
                        const supportUser = yield db.collection('users').findOne({ email: supportEmail });
                        const authorId = (supportUser === null || supportUser === void 0 ? void 0 : supportUser.id) || `support-${supportEmail}`;
                        yield db.collection('posts').insertOne({
                            id: postId,
                            author: supportUser ? {
                                id: supportUser.id,
                                firstName: supportUser.firstName,
                                lastName: supportUser.lastName,
                                name: supportUser.name,
                                handle: supportUser.handle,
                                avatar: supportUser.avatar,
                                avatarType: supportUser.avatarType || 'image',
                                activeGlow: supportUser.activeGlow
                            } : {
                                id: authorId,
                                firstName: 'Aura',
                                lastName: 'Support',
                                name: 'Aura Support',
                                handle: '@aurasupport',
                                avatar: '/og-image.svg',
                                avatarType: 'image',
                                activeGlow: 'emerald'
                            },
                            authorId,
                            ownerId: person.id,
                            content: wishText || `🎉 Happy Birthday ${person.firstName}! Your aura is radiant today.`,
                            mediaUrl: undefined,
                            mediaType: undefined,
                            mediaItems: undefined,
                            sharedFrom: undefined,
                            energy: '🎉 Celebrating',
                            radiance: 0,
                            timestamp: Date.now(),
                            reactions: {},
                            reactionUsers: {},
                            userReactions: [],
                            comments: [],
                            isBoosted: false,
                            viewCount: 0,
                            hashtags: [],
                            taggedUserIds: [],
                            visibility: 'private',
                            isBirthdayPost: true,
                            isSystemPost: true,
                            systemType: 'birthday',
                            birthdayYear: currentYear
                        });
                        const acquaintancesForOwner = person.acquaintances || [];
                        if (acquaintancesForOwner.length > 0) {
                            const yearKey = `birthday-${person.id}-${currentYear}`;
                            yield Promise.all(acquaintancesForOwner
                                .filter(id => id && id !== person.id)
                                .map(id => (0, notificationsController_1.createNotificationInDB)(id, 'birthday', person.id, `It’s ${person.firstName}'s birthday today 🎂`, postId, undefined, { birthdayUserId: person.id, year: currentYear }, yearKey).catch(err => {
                                console.error('Error creating birthday notification from system post:', err);
                            })));
                        }
                    }
                    announcements.push({
                        id: `bday-${person.id}-${today.getFullYear()}`,
                        user: {
                            id: person.id,
                            firstName: person.firstName,
                            lastName: person.lastName,
                            name: person.name,
                            handle: person.handle,
                            avatar: person.avatar,
                            avatarType: person.avatarType
                        },
                        wish: wishText,
                        reactions: {},
                        userReactions: []
                    });
                }
                res.json({
                    success: true,
                    data: announcements,
                    message: 'Birthday announcements generated successfully'
                });
            }
            catch (error) {
                console.error('Error generating birthday announcements:', error);
                res.status(500).json({
                    success: false,
                    error: 'Failed to generate birthday announcements',
                    message: 'Internal server error'
                });
            }
        });
    }
};
