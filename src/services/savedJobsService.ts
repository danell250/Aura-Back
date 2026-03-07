import crypto from 'crypto';
import { getPagination } from './jobDiscoveryQueryService';
import { recordJobPulseEvent } from './jobPulseService';
import { attachHeatFieldsToJobResponses, toJobResponse } from './jobResponseService';
import {
  getCachedSavedJobState,
  getCachedSavedJobStates,
  setCachedSavedJobState,
} from './savedJobStateCacheService';
import { readString } from '../utils/inputSanitizers';

const SAVED_JOBS_COLLECTION = 'saved_jobs';
const JOBS_COLLECTION = 'jobs';

const buildSavedJobId = (): string =>
  `savedjob-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

export type SavedJobState = {
  savedJobId: string;
  jobId: string;
  isSaved: boolean;
  savedAt: string | null;
};

type SavedJobListRow = {
  id?: string;
  jobId?: string;
  createdAt?: string;
  jobSnapshot?: Record<string, unknown> | null;
  liveJob?: any;
};

const toSavedJobState = (doc: any): SavedJobState => ({
  savedJobId: readString(doc?.id, 120),
  jobId: readString(doc?.jobId, 120),
  isSaved: true,
  savedAt: readString(doc?.createdAt, 80) || null,
});

const buildSavedJobSnapshot = (job: any): Record<string, unknown> => ({
  ...toJobResponse(job),
});

const buildSavedJobState = (jobId: string, createdAt: string): SavedJobState => ({
  savedJobId: buildSavedJobId(),
  jobId,
  isSaved: true,
  savedAt: createdAt,
});

const persistSavedJobInsertSideEffects = async (params: {
  db: any;
  currentUserId: string;
  jobId: string;
  savedState: SavedJobState;
}): Promise<void> => {
  setCachedSavedJobState({
    currentUserId: params.currentUserId,
    jobId: params.jobId,
    state: params.savedState,
  });
  await recordJobPulseEvent(params.db, {
    jobId: params.jobId,
    type: 'job_saved',
    userId: params.currentUserId,
    createdAt: params.savedState.savedAt || new Date().toISOString(),
  });
};

const fetchSavableJob = async (params: {
  db: any;
  jobId: string;
}): Promise<any | null> => {
  return params.db.collection(JOBS_COLLECTION).findOne({
    id: params.jobId,
    status: { $ne: 'archived' },
  });
};

const querySavedJobStatesByIds = async (params: {
  db: any;
  currentUserId: string;
  jobIds: string[];
}): Promise<Map<string, SavedJobState>> => {
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

  const rows = await params.db.collection(SAVED_JOBS_COLLECTION)
    .find(
      {
        userId: currentUserId,
        jobId: { $in: jobIds },
      },
      {
        projection: {
          id: 1,
          jobId: 1,
          createdAt: 1,
        },
      },
    )
    .toArray();

  return new Map(
    rows
      .map((row: any) => {
        const state = toSavedJobState(row);
        return state.jobId ? [state.jobId, state] as const : null;
      })
      .filter(Boolean) as Array<readonly [string, SavedJobState]>,
  );
};

const resolveSavedJobStates = async (params: {
  db: any;
  currentUserId: string;
  jobIds: string[];
}): Promise<Map<string, SavedJobState>> => {
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

  const { statesByJobId, missingJobIds } = getCachedSavedJobStates({
    currentUserId,
    jobIds,
  });
  if (missingJobIds.length === 0) {
    return statesByJobId;
  }

  const resolvedStates = await querySavedJobStatesByIds({
    db: params.db,
    currentUserId,
    jobIds: missingJobIds,
  });

  missingJobIds.forEach((jobId) => {
    const state = resolvedStates.get(jobId) || null;
    setCachedSavedJobState({
      currentUserId,
      jobId,
      state,
    });
    if (state) {
      statesByJobId.set(jobId, state);
    }
  });

  return statesByJobId;
};

const resolveSavedJobResponseRow = (row: SavedJobListRow): Record<string, unknown> | null => {
  const liveJob = row?.liveJob && typeof row.liveJob === 'object' ? row.liveJob : null;
  const baseJob =
    (liveJob && typeof liveJob === 'object' ? toJobResponse(liveJob) : null)
    || (row?.jobSnapshot && typeof row.jobSnapshot === 'object' ? row.jobSnapshot : null);
  if (!baseJob || typeof baseJob !== 'object') {
    return null;
  }

  return {
    ...baseJob,
    isSaved: true,
    savedAt: readString(row?.createdAt, 80) || null,
    savedJobId: readString(row?.id, 120) || null,
    savedJobIsSnapshot: !liveJob,
  };
};

export const getSavedJobStateForUser = async (params: {
  db: any;
  currentUserId: string;
  jobId: string;
}): Promise<SavedJobState | null> => {
  const currentUserId = readString(params.currentUserId, 120);
  const jobId = readString(params.jobId, 120);
  if (!currentUserId || !jobId) return null;

  const cachedState = getCachedSavedJobState({
    currentUserId,
    jobId,
  });
  if (cachedState !== undefined) {
    return cachedState;
  }

  return (await resolveSavedJobStates({
    db: params.db,
    currentUserId,
    jobIds: [jobId],
  })).get(jobId) || null;
};

export const listSavedJobStatesByUser = async (params: {
  db: any;
  currentUserId: string;
  jobIds: string[];
}): Promise<Map<string, SavedJobState>> => {
  return resolveSavedJobStates({
    db: params.db,
    currentUserId: params.currentUserId,
    jobIds: params.jobIds,
  });
};

export const attachSavedStateToJobResponses = async (params: {
  db: any;
  currentUserId?: string | null;
  jobs: Array<Record<string, unknown>>;
}): Promise<Array<Record<string, unknown>>> => {
  const currentUserId = readString(params.currentUserId, 120);
  if (!currentUserId || params.jobs.length === 0) {
    return params.jobs;
  }

  const savedStatesByJobId = await resolveSavedJobStates({
    db: params.db,
    currentUserId,
    jobIds: params.jobs
      .map((job) => readString(job?.id, 120))
      .filter((jobId) => jobId.length > 0),
  });

  return params.jobs.map((job) => {
    const jobId = readString(job?.id, 120);
    const savedState = savedStatesByJobId.get(jobId);
    return {
      ...job,
      isSaved: Boolean(savedState),
      savedAt: savedState?.savedAt || null,
      savedJobId: savedState?.savedJobId || null,
    };
  });
};

export const saveJobForUser = async (params: {
  db: any;
  currentUserId: string;
  jobId: string;
}): Promise<{
  created: boolean;
  state?: SavedJobState;
  statusCode?: number;
  error?: string;
}> => {
  const currentUserId = readString(params.currentUserId, 120);
  const jobId = readString(params.jobId, 120);
  if (!currentUserId || !jobId) {
    return {
      created: false,
      statusCode: 400,
      error: 'jobId is required',
    };
  }

  const existingState = await getSavedJobStateForUser({
    db: params.db,
    currentUserId,
    jobId,
  });
  if (existingState) {
    return {
      created: false,
      state: existingState,
    };
  }

  const job = await fetchSavableJob({
    db: params.db,
    jobId,
  });
  if (!job) {
    return {
      created: false,
      statusCode: 404,
      error: 'Job not found',
    };
  }

  const now = new Date().toISOString();
  const savedState = buildSavedJobState(jobId, now);
  const savedJobDoc = {
    id: savedState.savedJobId,
    userId: currentUserId,
    jobId,
    createdAt: now,
    updatedAt: now,
    jobSnapshot: buildSavedJobSnapshot(job),
  };

  try {
    await params.db.collection(SAVED_JOBS_COLLECTION).insertOne(savedJobDoc);
    await persistSavedJobInsertSideEffects({
      db: params.db,
      currentUserId,
      jobId,
      savedState,
    });
    return {
      created: true,
      state: savedState,
    };
  } catch (error: any) {
    if (error?.code !== 11000) {
      throw error;
    }
  }

  const duplicateState = await getSavedJobStateForUser({
    db: params.db,
    currentUserId,
    jobId,
  });
  if (!duplicateState) {
    return {
      created: false,
      statusCode: 500,
      error: 'Failed to save job',
    };
  }

  return {
    created: false,
    state: duplicateState,
  };
};

export const unsaveJobForUser = async (params: {
  db: any;
  currentUserId: string;
  jobId: string;
}): Promise<{ removed: boolean }> => {
  const currentUserId = readString(params.currentUserId, 120);
  const jobId = readString(params.jobId, 120);
  if (!currentUserId || !jobId) {
    return { removed: false };
  }

  const result = await params.db.collection(SAVED_JOBS_COLLECTION).deleteOne({
    userId: currentUserId,
    jobId,
  });
  setCachedSavedJobState({
    currentUserId,
    jobId,
    state: null,
  });

  return {
    removed: Number(result.deletedCount || 0) > 0,
  };
};

export const listSavedJobsForUser = async (params: {
  db: any;
  currentUserId: string;
  query: Record<string, unknown>;
}): Promise<{
  data: Array<Record<string, unknown>>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}> => {
  const currentUserId = readString(params.currentUserId, 120);
  const pagination = getPagination(params.query);
  if (!currentUserId) {
    return {
      data: [],
      pagination: { page: pagination.page, limit: pagination.limit, total: 0, pages: 0 },
    };
  }

  const [rows, total] = await Promise.all([
    params.db.collection(SAVED_JOBS_COLLECTION)
      .aggregate([
        { $match: { userId: currentUserId } },
        { $sort: { createdAt: -1, id: -1 } },
        { $skip: pagination.skip },
        { $limit: pagination.limit },
        {
          $lookup: {
            from: JOBS_COLLECTION,
            localField: 'jobId',
            foreignField: 'id',
            as: 'liveJob',
          },
        },
        {
          $project: {
            id: 1,
            jobId: 1,
            createdAt: 1,
            jobSnapshot: 1,
            liveJob: { $arrayElemAt: ['$liveJob', 0] },
          },
        },
      ])
      .toArray(),
    params.db.collection(SAVED_JOBS_COLLECTION).countDocuments({ userId: currentUserId }),
  ]);

  const jobsWithSavedState = rows
    .map((row: SavedJobListRow) => resolveSavedJobResponseRow(row))
    .filter(Boolean) as Array<Record<string, unknown>>;
  const data = await attachHeatFieldsToJobResponses({
    db: params.db,
    jobs: jobsWithSavedState,
  });

  return {
    data,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: Math.ceil(total / pagination.limit),
    },
  };
};
