import { buildJobAnnouncementMeta, publishJobAnnouncementPost } from './jobAnnouncementService';

const JOBS_COLLECTION = 'jobs';

export const runCompanyJobPostCreateHooks = async (params: {
  db: any;
  actorId: string;
  company: any;
  validatedInput: {
    title: string;
    summary: string;
    locationText: string;
    workModel: string;
    employmentType: string;
    tags: string[];
    createAnnouncement: boolean;
  };
  job: any;
  io?: { emit: (event: string, payload: any) => void } | null;
  emitInsightsUpdate?: () => Promise<unknown> | unknown;
}): Promise<void> => {
  if (!params.validatedInput.createAnnouncement) {
    return;
  }

  const announcementPostId = await publishJobAnnouncementPost({
    db: params.db,
    io: params.io,
    ownerId: params.actorId,
    company: buildJobAnnouncementMeta(params.company),
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
  await params.db.collection(JOBS_COLLECTION).updateOne(
    { id: params.job.id },
    {
      $set: {
        announcementPostId,
        updatedAt: new Date().toISOString(),
      },
    },
  );
};
