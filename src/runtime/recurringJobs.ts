import { checkDBHealth, getDB, isDBConnected } from '../db';
import { recalculateAllTrustScores } from '../services/trustService';
import { createNotificationInDB } from '../controllers/notificationsController';

const NOTIFICATION_BATCH_SIZE = 25;

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

export const startRuntimeRecurringJobs = () => {
  startDatabaseHealthCheckJob();
  startTrustScoreRecalculationJob();
  startTimeCapsuleUnlockNotificationJob();
};
