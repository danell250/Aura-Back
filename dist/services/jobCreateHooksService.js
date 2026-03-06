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
exports.runCompanyJobPostCreateHooks = void 0;
const jobAnnouncementService_1 = require("./jobAnnouncementService");
const JOBS_COLLECTION = 'jobs';
const runCompanyJobPostCreateHooks = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (!params.validatedInput.createAnnouncement) {
        return;
    }
    const announcementPostId = yield (0, jobAnnouncementService_1.publishJobAnnouncementPost)({
        db: params.db,
        io: params.io,
        ownerId: params.actorId,
        company: (0, jobAnnouncementService_1.buildJobAnnouncementMeta)(params.company),
        job: {
            id: params.job.id,
            title: params.validatedInput.title,
            locationText: params.validatedInput.locationText,
            workModel: params.validatedInput.workModel,
            employmentType: params.validatedInput.employmentType,
            summary: params.validatedInput.summary,
            tags: params.validatedInput.tags,
        },
        emitInsightsUpdate: params.emitInsightsUpdate,
    });
    if (!announcementPostId) {
        return;
    }
    params.job.announcementPostId = announcementPostId;
    yield params.db.collection(JOBS_COLLECTION).updateOne({ id: params.job.id }, {
        $set: {
            announcementPostId,
            updatedAt: new Date().toISOString(),
        },
    });
});
exports.runCompanyJobPostCreateHooks = runCompanyJobPostCreateHooks;
