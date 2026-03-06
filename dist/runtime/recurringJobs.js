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
exports.startRuntimeRecurringJobs = void 0;
const db_1 = require("../db");
const trustService_1 = require("../services/trustService");
const notificationsController_1 = require("../controllers/notificationsController");
const jobMarketDemandSnapshotService_1 = require("../services/jobMarketDemandSnapshotService");
const reverseJobMatchDigestService_1 = require("../services/reverseJobMatchDigestService");
const jobSeoSitemapService_1 = require("../services/jobSeoSitemapService");
const runtimeRecurringTaskService_1 = require("../services/runtimeRecurringTaskService");
const NOTIFICATION_BATCH_SIZE = 25;
const JOB_MARKET_DEMAND_SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const JOBS_SITEMAP_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const JOB_MARKET_DEMAND_SNAPSHOT_LOCK_TTL_MS = 90 * 60 * 1000;
const JOBS_SITEMAP_REFRESH_LOCK_TTL_MS = 30 * 60 * 1000;
const runInBatches = (items, batchSize, task) => __awaiter(void 0, void 0, void 0, function* () {
    for (let index = 0; index < items.length; index += batchSize) {
        const batch = items.slice(index, index + batchSize);
        yield Promise.allSettled(batch.map((item) => task(item)));
    }
});
const startDatabaseHealthCheckJob = () => {
    setInterval(() => __awaiter(void 0, void 0, void 0, function* () {
        const isHealthy = yield (0, db_1.checkDBHealth)();
        if (!isHealthy && (0, db_1.isDBConnected)()) {
            console.warn('⚠️  Database health check failed - connection may be unstable');
        }
    }), 60000);
};
const startTrustScoreRecalculationJob = () => {
    setInterval(() => __awaiter(void 0, void 0, void 0, function* () {
        try {
            if (!(0, db_1.isDBConnected)())
                return;
            console.log('🔄 Running daily trust score recalculation job...');
            yield (0, trustService_1.recalculateAllTrustScores)();
            console.log('✅ Daily trust score recalculation complete');
        }
        catch (error) {
            console.error('❌ Failed daily trust score recalculation job:', error);
        }
    }), 24 * 60 * 60 * 1000);
};
const startTimeCapsuleUnlockNotificationJob = () => {
    setInterval(() => __awaiter(void 0, void 0, void 0, function* () {
        try {
            if (!(0, db_1.isDBConnected)())
                return;
            const db = (0, db_1.getDB)();
            const now = Date.now();
            const recentlyUnlocked = yield db
                .collection('posts')
                .find({
                isTimeCapsule: true,
                unlockDate: {
                    $lte: now,
                    $gte: now - (5 * 60 * 1000),
                },
                unlockNotificationSent: { $ne: true },
            })
                .toArray();
            for (const post of recentlyUnlocked) {
                try {
                    yield (0, notificationsController_1.createNotificationInDB)(post.author.id, 'time_capsule_unlocked', 'system', `Your Time Capsule \"${post.timeCapsuleTitle || 'Untitled'}\" has been unlocked!`, post.id);
                    if (post.timeCapsuleType === 'group' && post.invitedUsers) {
                        const normalizedInvitedUsers = Array.isArray(post.invitedUsers)
                            ? post.invitedUsers.reduce((acc, userId) => {
                                if (typeof userId === 'string' && userId.trim().length > 0) {
                                    acc.push(userId);
                                }
                                return acc;
                            }, [])
                            : [];
                        const invitedUsers = Array.from(new Set(normalizedInvitedUsers));
                        yield runInBatches(invitedUsers, NOTIFICATION_BATCH_SIZE, (userId) => __awaiter(void 0, void 0, void 0, function* () {
                            yield (0, notificationsController_1.createNotificationInDB)(userId, 'time_capsule_unlocked', post.author.id, `A Time Capsule from ${post.author.name} has been unlocked!`, post.id);
                        }));
                    }
                    yield db.collection('posts').updateOne({ id: post.id }, { $set: { unlockNotificationSent: true } });
                    console.log(`📬 Sent unlock notifications for Time Capsule: ${post.id}`);
                }
                catch (error) {
                    console.error(`Failed to send notification for Time Capsule ${post.id}:`, error);
                }
            }
        }
        catch (error) {
            console.error('Error checking Time Capsule unlocks:', error);
        }
    }), 5 * 60 * 1000);
};
const startReverseJobMatchDigestJob = () => {
    setInterval(() => __awaiter(void 0, void 0, void 0, function* () {
        try {
            if (!(0, db_1.isDBConnected)())
                return;
            const db = (0, db_1.getDB)();
            yield (0, reverseJobMatchDigestService_1.sendDailyReverseJobMatchDigests)(db);
        }
        catch (error) {
            console.error('Error running reverse job match digest job:', error);
        }
    }), 24 * 60 * 60 * 1000);
};
const startJobMarketDemandSnapshotJob = () => {
    (0, runtimeRecurringTaskService_1.startRecurringTaskRunner)({
        intervalMs: JOB_MARKET_DEMAND_SNAPSHOT_INTERVAL_MS,
        run: () => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const result = yield (0, runtimeRecurringTaskService_1.runLockedRecurringTask)({
                    jobKey: 'job-market-demand-snapshots',
                    ttlMs: JOB_MARKET_DEMAND_SNAPSHOT_LOCK_TTL_MS,
                    task: (db) => (0, jobMarketDemandSnapshotService_1.syncJobMarketDemandSnapshots)({ db }),
                });
                if (!result) {
                    console.log('⏭️ Skipped job market demand snapshots sync (lock held by another instance)');
                    return;
                }
                console.log(`🧭 Job market demand snapshots synced (${result.contexts} contexts for ${result.bucketDate})`);
            }
            catch (error) {
                console.error('❌ Failed job market demand snapshot sync:', error);
            }
        }),
    });
};
const startJobsSitemapRefreshJob = () => {
    (0, runtimeRecurringTaskService_1.startRecurringTaskRunner)({
        intervalMs: JOBS_SITEMAP_REFRESH_INTERVAL_MS,
        run: () => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const filePath = yield (0, runtimeRecurringTaskService_1.runLockedRecurringTask)({
                    jobKey: 'jobs-sitemap-refresh',
                    ttlMs: JOBS_SITEMAP_REFRESH_LOCK_TTL_MS,
                    task: () => __awaiter(void 0, void 0, void 0, function* () { return (0, jobSeoSitemapService_1.refreshJobsSitemapCache)(); }),
                });
                if (!filePath) {
                    console.log('⏭️ Skipped jobs sitemap cache refresh (lock held by another instance)');
                    return;
                }
                console.log('🗺️ Jobs sitemap cache refreshed');
            }
            catch (error) {
                console.error('❌ Failed jobs sitemap cache refresh:', error);
            }
        }),
    });
};
const startRuntimeRecurringJobs = () => {
    startDatabaseHealthCheckJob();
    startTrustScoreRecalculationJob();
    startTimeCapsuleUnlockNotificationJob();
    startReverseJobMatchDigestJob();
    startJobMarketDemandSnapshotJob();
    startJobsSitemapRefreshJob();
};
exports.startRuntimeRecurringJobs = startRuntimeRecurringJobs;
