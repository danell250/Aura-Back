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
exports.dispatchGroupedReverseMatchNotifications = exports.groupReverseMatchNotificationEntriesByUser = void 0;
const notificationsController_1 = require("../controllers/notificationsController");
const jobRecommendationService_1 = require("./jobRecommendationService");
const concurrencyUtils_1 = require("../utils/concurrencyUtils");
const runTasksInBatches = (tasks, batchSize) => __awaiter(void 0, void 0, void 0, function* () {
    for (let index = 0; index < tasks.length; index += batchSize) {
        const batch = tasks.slice(index, index + batchSize);
        yield Promise.allSettled(batch.map((task) => task()));
        yield (0, concurrencyUtils_1.yieldToEventLoop)();
    }
});
const groupReverseMatchNotificationEntriesByUser = (entries) => {
    const groupedByUser = new Map();
    entries.forEach((entry) => {
        if (!entry.userId)
            return;
        const bucket = groupedByUser.get(entry.userId) || [];
        bucket.push(entry);
        groupedByUser.set(entry.userId, bucket);
    });
    return groupedByUser;
};
exports.groupReverseMatchNotificationEntriesByUser = groupReverseMatchNotificationEntriesByUser;
const dispatchGroupedReverseMatchNotifications = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const tasks = [];
    for (const [userId, entries] of params.groupedByUser.entries()) {
        if (entries.length === 0)
            continue;
        tasks.push(() => __awaiter(void 0, void 0, void 0, function* () {
            const sortedEntries = [...entries].sort((left, right) => right.score - left.score);
            const topEntries = sortedEntries.slice(0, params.notificationTopJobs);
            const matchCount = entries.length;
            const message = `🔥 ${matchCount} new job${matchCount === 1 ? '' : 's'} match your profile`;
            const meta = {
                category: 'reverse_job_match',
                matchCount,
                jobs: topEntries.map((entry) => ({
                    jobId: entry.jobId,
                    slug: entry.jobSlug,
                    title: entry.title,
                    companyName: entry.companyName,
                    score: entry.score,
                    matchTier: (0, jobRecommendationService_1.resolveRecommendationMatchTier)(entry.score),
                    reasons: entry.reasons,
                    matchedSkills: entry.matchedSkills,
                })),
            };
            try {
                yield (0, notificationsController_1.createNotificationInDB)(userId, 'job_match_alert', 'system', message, undefined, undefined, meta, undefined, 'user');
            }
            catch (error) {
                console.error('Reverse match notification dispatch error:', error);
            }
        }));
    }
    if (tasks.length === 0)
        return;
    yield runTasksInBatches(tasks, params.notificationBatchSize);
});
exports.dispatchGroupedReverseMatchNotifications = dispatchGroupedReverseMatchNotifications;
