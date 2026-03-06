import crypto from 'crypto';
import { getHashtagsFromText } from '../utils/hashtagUtils';
import { readString } from '../utils/inputSanitizers';
import { buildJobAnnouncementContent } from './jobAnnouncementContentService';

export const buildJobAnnouncementMeta = (company: any) => ({
  name: readString(company?.name, 120) || 'Company',
  handle: readString(company?.handle, 80) || '',
  avatar: readString(company?.avatar, 500) || '',
  avatarKey: readString(company?.avatarKey, 500) || '',
  avatarType: company?.avatarType === 'video' ? 'video' : 'image',
  activeGlow: readString(company?.activeGlow, 40) || 'none',
});

export const publishJobAnnouncementPost = async (params: {
  db: any;
  io?: { emit: (event: string, payload: any) => void } | null;
  ownerId: string;
  company: ReturnType<typeof buildJobAnnouncementMeta>;
  job: {
    id: string;
    title: string;
    locationText: string;
    workModel: string;
    employmentType: string;
    summary: string;
    tags: string[];
  };
  emitInsightsUpdate?: () => Promise<unknown> | unknown;
}): Promise<string | null> => {
  const nowTimestamp = Date.now();
  const postId = `post-job-${nowTimestamp}-${crypto.randomBytes(4).toString('hex')}`;
  const announcementContent = buildJobAnnouncementContent({
    title: params.job.title,
    companyName: params.company.name,
    locationText: params.job.locationText,
    workModel: params.job.workModel,
    employmentType: params.job.employmentType,
    summary: params.job.summary,
    tags: params.job.tags,
  });
  const hashtags = getHashtagsFromText(announcementContent);

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
    reactions: {} as Record<string, number>,
    reactionUsers: {} as Record<string, string[]>,
    userReactions: [] as string[],
    comments: [] as any[],
    isBoosted: false,
    viewCount: 0,
    hashtags,
    taggedUserIds: [] as string[],
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
    await params.db.collection('posts').insertOne(announcementPost);
    params.io?.emit('new_post', announcementPost);
    if (params.emitInsightsUpdate) {
      void (async () => {
        try {
          await params.emitInsightsUpdate?.();
        } catch {
          // Ignore best-effort insight refresh failures.
        }
      })();
    }
    return postId;
  } catch (error) {
    console.error('Create job announcement post error:', error);
    return null;
  }
};
