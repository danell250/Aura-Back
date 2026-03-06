import { checkDBHealth, getDB, isDBConnected } from '../db';
import { recalculateAllTrustScores } from '../services/trustService';
import { createNotificationInDB } from '../controllers/notificationsController';
import { syncJobMarketDemandSnapshots } from '../services/jobMarketDemandSnapshotService';
import { sendDailyReverseJobMatchDigests } from '../services/reverseJobMatchDigestService';
import { refreshJobsSitemapCache } from '../services/jobSeoSitemapService';
import { runLockedRecurringTask, startRecurringTaskRunner } from '../services/runtimeRecurringTaskService';

const NOTIFICATION_BATCH_SIZE = 25;
const JOB_MARKET_DEMAND_SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const JOBS_SITEMAP_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const JOB_MARKET_DEMAND_SNAPSHOT_LOCK_TTL_MS = 90 * 60 * 1000;
const JOBS_SITEMAP_REFRESH_LOCK_TTL_MS = 30 * 60 * 1000;

const runInBatches = async <T>(
  items: T[],
  batchSize: number,
  task: (item: T) => Promise<void>
) => {
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    await Promise.allSettled(batch.map((item) => task(item)));
  }
};

const startDatabaseHealthCheckJob = () => {
  setInterval(async () => {
    const isHealthy = await checkDBHealth();
    if (!isHealthy && isDBConnected()) {
      console.warn('⚠️  Database health check failed - connection may be unstable');
    }
  }, 60000);
};

const startTrustScoreRecalculationJob = () => {
  setInterval(async () => {
    try {
      if (!isDBConnected()) return;
      console.log('🔄 Running daily trust score recalculation job...');
      await recalculateAllTrustScores();
      console.log('✅ Daily trust score recalculation complete');
    } catch (error) {
      console.error('❌ Failed daily trust score recalculation job:', error);
    }
  }, 24 * 60 * 60 * 1000);
};

const startTimeCapsuleUnlockNotificationJob = () => {
  setInterval(async () => {
    try {
      if (!isDBConnected()) return;
      const db = getDB();
      const now = Date.now();

      const recentlyUnlocked = await db
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
          await createNotificationInDB(
            post.author.id,
            'time_capsule_unlocked',
            'system',
            `Your Time Capsule \"${post.timeCapsuleTitle || 'Untitled'}\" has been unlocked!`,
            post.id
          );

          if (post.timeCapsuleType === 'group' && post.invitedUsers) {
            const normalizedInvitedUsers = Array.isArray(post.invitedUsers)
              ? post.invitedUsers.reduce<string[]>((acc, userId) => {
                  if (typeof userId === 'string' && userId.trim().length > 0) {
                    acc.push(userId);
                  }
                  return acc;
                }, [])
              : [];
            const invitedUsers = Array.from(new Set(normalizedInvitedUsers));

            await runInBatches(invitedUsers, NOTIFICATION_BATCH_SIZE, async (userId) => {
              await createNotificationInDB(
                userId,
                'time_capsule_unlocked',
                post.author.id,
                `A Time Capsule from ${post.author.name} has been unlocked!`,
                post.id
              );
            });
          }

          await db.collection('posts').updateOne({ id: post.id }, { $set: { unlockNotificationSent: true } });
          console.log(`📬 Sent unlock notifications for Time Capsule: ${post.id}`);
        } catch (error) {
          console.error(`Failed to send notification for Time Capsule ${post.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error checking Time Capsule unlocks:', error);
    }
  }, 5 * 60 * 1000);
};

const startReverseJobMatchDigestJob = () => {
  setInterval(async () => {
    try {
      if (!isDBConnected()) return;
      const db = getDB();
      await sendDailyReverseJobMatchDigests(db);
    } catch (error) {
      console.error('Error running reverse job match digest job:', error);
    }
  }, 24 * 60 * 60 * 1000);
};

const startJobMarketDemandSnapshotJob = () => {
  startRecurringTaskRunner({
    intervalMs: JOB_MARKET_DEMAND_SNAPSHOT_INTERVAL_MS,
    run: async () => {
      try {
        const result = await runLockedRecurringTask({
          jobKey: 'job-market-demand-snapshots',
          ttlMs: JOB_MARKET_DEMAND_SNAPSHOT_LOCK_TTL_MS,
          task: (db) => syncJobMarketDemandSnapshots({ db }),
        });
        if (!result) {
          console.log('⏭️ Skipped job market demand snapshots sync (lock held by another instance)');
          return;
        }
        console.log(`🧭 Job market demand snapshots synced (${result.contexts} contexts for ${result.bucketDate})`);
      } catch (error) {
        console.error('❌ Failed job market demand snapshot sync:', error);
      }
    },
  });
};

const startJobsSitemapRefreshJob = () => {
  startRecurringTaskRunner({
    intervalMs: JOBS_SITEMAP_REFRESH_INTERVAL_MS,
    run: async () => {
      try {
        const filePath = await runLockedRecurringTask({
          jobKey: 'jobs-sitemap-refresh',
          ttlMs: JOBS_SITEMAP_REFRESH_LOCK_TTL_MS,
          task: async () => refreshJobsSitemapCache(),
        });
        if (!filePath) {
          console.log('⏭️ Skipped jobs sitemap cache refresh (lock held by another instance)');
          return;
        }
        console.log('🗺️ Jobs sitemap cache refreshed');
      } catch (error) {
        console.error('❌ Failed jobs sitemap cache refresh:', error);
      }
    },
  });
};

export const startRuntimeRecurringJobs = () => {
  startDatabaseHealthCheckJob();
  startTrustScoreRecalculationJob();
  startTimeCapsuleUnlockNotificationJob();
  startReverseJobMatchDigestJob();
  startJobMarketDemandSnapshotJob();
  startJobsSitemapRefreshJob();
};
