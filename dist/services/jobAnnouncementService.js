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
exports.publishJobAnnouncementPost = exports.buildJobAnnouncementMeta = void 0;
const crypto_1 = __importDefault(require("crypto"));
const hashtagUtils_1 = require("../utils/hashtagUtils");
const inputSanitizers_1 = require("../utils/inputSanitizers");
const jobAnnouncementContentService_1 = require("./jobAnnouncementContentService");
const buildJobAnnouncementMeta = (company) => ({
    name: (0, inputSanitizers_1.readString)(company === null || company === void 0 ? void 0 : company.name, 120) || 'Company',
    handle: (0, inputSanitizers_1.readString)(company === null || company === void 0 ? void 0 : company.handle, 80) || '',
    avatar: (0, inputSanitizers_1.readString)(company === null || company === void 0 ? void 0 : company.avatar, 500) || '',
    avatarKey: (0, inputSanitizers_1.readString)(company === null || company === void 0 ? void 0 : company.avatarKey, 500) || '',
    avatarType: (company === null || company === void 0 ? void 0 : company.avatarType) === 'video' ? 'video' : 'image',
    activeGlow: (0, inputSanitizers_1.readString)(company === null || company === void 0 ? void 0 : company.activeGlow, 40) || 'none',
});
exports.buildJobAnnouncementMeta = buildJobAnnouncementMeta;
const publishJobAnnouncementPost = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const nowTimestamp = Date.now();
    const postId = `post-job-${nowTimestamp}-${crypto_1.default.randomBytes(4).toString('hex')}`;
    const announcementContent = (0, jobAnnouncementContentService_1.buildJobAnnouncementContent)({
        title: params.job.title,
        companyName: params.company.name,
        locationText: params.job.locationText,
        workModel: params.job.workModel,
        employmentType: params.job.employmentType,
        summary: params.job.summary,
        tags: params.job.tags,
    });
    const hashtags = (0, hashtagUtils_1.getHashtagsFromText)(announcementContent);
    const announcementPost = {
        id: postId,
        author: {
            id: params.ownerId,
            firstName: params.company.name,
            lastName: '',
            name: params.company.name,
            handle: params.company.handle,
            avatar: params.company.avatar,
            avatarKey: params.company.avatarKey,
            avatarType: params.company.avatarType,
            activeGlow: params.company.activeGlow,
            type: 'company',
        },
        authorId: params.ownerId,
        ownerId: params.ownerId,
        ownerType: 'company',
        content: announcementContent,
        energy: '🪐 Neutral',
        radiance: 0,
        timestamp: nowTimestamp,
        visibility: 'public',
        reactions: {},
        reactionUsers: {},
        userReactions: [],
        comments: [],
        isBoosted: false,
        viewCount: 0,
        hashtags,
        taggedUserIds: [],
        jobMeta: {
            jobId: params.job.id,
            companyId: params.ownerId,
            title: params.job.title,
            locationText: params.job.locationText,
            workModel: params.job.workModel,
            employmentType: params.job.employmentType,
        },
    };
    try {
        yield params.db.collection('posts').insertOne(announcementPost);
        (_a = params.io) === null || _a === void 0 ? void 0 : _a.emit('new_post', announcementPost);
        if (params.emitInsightsUpdate) {
            void (() => __awaiter(void 0, void 0, void 0, function* () {
                var _a;
                try {
                    yield ((_a = params.emitInsightsUpdate) === null || _a === void 0 ? void 0 : _a.call(params));
                }
                catch (_b) {
                    // Ignore best-effort insight refresh failures.
                }
            }))();
        }
        return postId;
    }
    catch (error) {
        console.error('Create job announcement post error:', error);
        return null;
    }
});
exports.publishJobAnnouncementPost = publishJobAnnouncementPost;
