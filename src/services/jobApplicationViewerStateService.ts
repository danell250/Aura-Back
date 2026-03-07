import { readString } from '../utils/inputSanitizers';

const JOB_APPLICATIONS_COLLECTION = 'job_applications';

type ViewerApplicationState = {
  viewerHasApplied: boolean;
  viewerApplicationId: string | null;
  viewerApplicationStatus: string | null;
  viewerAppliedAt: string | null;
};

const EMPTY_VIEWER_APPLICATION_STATE: ViewerApplicationState = {
  viewerHasApplied: false,
  viewerApplicationId: null,
  viewerApplicationStatus: null,
  viewerAppliedAt: null,
};

const resolveViewerApplicationStates = async (params: {
  db: any;
  currentUserId?: string | null;
  jobIds: string[];
}): Promise<Map<string, ViewerApplicationState>> => {
  const currentUserId = readString(params.currentUserId, 120);
  const jobIds = Array.from(
    new Set(
      (Array.isArray(params.jobIds) ? params.jobIds : [])
        .map((jobId) => readString(jobId, 120))
        .filter((jobId) => jobId.length > 0),
    ),
  );

  if (!currentUserId || jobIds.length === 0) {
    return new Map();
  }

  const rows = await params.db.collection(JOB_APPLICATIONS_COLLECTION)
    .find(
      {
        applicantUserId: currentUserId,
        jobId: { $in: jobIds },
      },
      {
        projection: {
          id: 1,
          jobId: 1,
          status: 1,
          createdAt: 1,
        },
      },
    )
    .sort({ createdAt: -1 })
    .toArray();

  const statesByJobId = new Map<string, ViewerApplicationState>();
  rows.forEach((row: any) => {
    const jobId = readString(row?.jobId, 120);
    if (!jobId || statesByJobId.has(jobId)) return;

    statesByJobId.set(jobId, {
      viewerHasApplied: true,
      viewerApplicationId: readString(row?.id, 120) || null,
      viewerApplicationStatus: readString(row?.status, 40) || null,
      viewerAppliedAt: readString(row?.createdAt, 80) || null,
    });
  });

  return statesByJobId;
};

export const attachViewerApplicationStateToJobResponses = async (params: {
  db: any;
  currentUserId?: string | null;
  jobs: Array<Record<string, unknown>>;
}): Promise<Array<Record<string, unknown>>> => {
  const jobs = Array.isArray(params.jobs) ? params.jobs : [];
  if (jobs.length === 0) return [];

  const statesByJobId = await resolveViewerApplicationStates({
    db: params.db,
    currentUserId: params.currentUserId,
    jobIds: jobs
      .map((job) => readString(job?.id, 120))
      .filter((jobId) => jobId.length > 0),
  });

  return jobs.map((job) => {
    const jobId = readString(job?.id, 120);
    const viewerApplicationState = statesByJobId.get(jobId) || EMPTY_VIEWER_APPLICATION_STATE;
    return {
      ...job,
      ...viewerApplicationState,
    };
  });
};
