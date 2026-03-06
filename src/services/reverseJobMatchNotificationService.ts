import { createNotificationInDB } from '../controllers/notificationsController';
import { resolveRecommendationMatchTier } from './jobRecommendationService';
import { yieldToEventLoop } from '../utils/concurrencyUtils';

export type ReverseMatchNotificationEntry = {
  userId: string;
  jobId: string;
  jobSlug: string;
  title: string;
  companyName: string;
  score: number;
  reasons: string[];
  matchedSkills: string[];
};

const runTasksInBatches = async (
  tasks: Array<() => Promise<void>>,
  batchSize: number,
): Promise<void> => {
  for (let index = 0; index < tasks.length; index += batchSize) {
    const batch = tasks.slice(index, index + batchSize);
    await Promise.allSettled(batch.map((task) => task()));
    await yieldToEventLoop();
  }
};

export const groupReverseMatchNotificationEntriesByUser = (
  entries: ReverseMatchNotificationEntry[],
): Map<string, ReverseMatchNotificationEntry[]> => {
  const groupedByUser = new Map<string, ReverseMatchNotificationEntry[]>();
  entries.forEach((entry) => {
    if (!entry.userId) return;
    const bucket = groupedByUser.get(entry.userId) || [];
    bucket.push(entry);
    groupedByUser.set(entry.userId, bucket);
  });
  return groupedByUser;
};

export const dispatchGroupedReverseMatchNotifications = async (params: {
  groupedByUser: Map<string, ReverseMatchNotificationEntry[]>;
  notificationTopJobs: number;
  notificationBatchSize: number;
}): Promise<void> => {
  const tasks: Array<() => Promise<void>> = [];
  for (const [userId, entries] of params.groupedByUser.entries()) {
    if (entries.length === 0) continue;
    tasks.push(async () => {
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
          matchTier: resolveRecommendationMatchTier(entry.score),
          reasons: entry.reasons,
          matchedSkills: entry.matchedSkills,
        })),
      };

      try {
        await createNotificationInDB(
          userId,
          'job_match_alert',
          'system',
          message,
          undefined,
          undefined,
          meta,
          undefined,
          'user',
        );
      } catch (error) {
        console.error('Reverse match notification dispatch error:', error);
      }
    });
  }

  if (tasks.length === 0) return;
  await runTasksInBatches(tasks, params.notificationBatchSize);
};
