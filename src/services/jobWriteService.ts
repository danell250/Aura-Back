import crypto from 'crypto';
import { buildJobRecommendationPrecomputedFields } from './jobRecommendationService';
import { buildDemandRoleFields, buildJobMarketDemandPrecomputedFields } from './openToWorkDemandService';
import { buildPersistentJobSlug } from './jobResponseService';
import { runCompanyJobPostCreateHooks } from './jobCreateHooksService';
import { recordJobPulseEventAsync } from './jobPulseService';
import { registerJobMarketDemandSeedContexts } from './jobMarketDemandSeedContextRegistryService';
import { normalizeJobSlugValue } from './jobSlugService';
import { normalizeEmailAddress, normalizeExternalUrl } from '../utils/contactNormalization';
import { readString } from '../utils/inputSanitizers';

const JOBS_COLLECTION = 'jobs';
const ALLOWED_JOB_STATUSES = new Set(['open', 'closed', 'archived']);
const ALLOWED_EMPLOYMENT_TYPES = new Set(['full_time', 'part_time', 'contract', 'internship', 'temporary']);
const ALLOWED_WORK_MODELS = new Set(['onsite', 'hybrid', 'remote']);

type CompanyJobWriteError = Error & { statusCode?: number };

const createJobWriteError = (statusCode: number, message: string): CompanyJobWriteError => {
  const error = new Error(message) as CompanyJobWriteError;
  error.statusCode = statusCode;
  return error;
};

const readStringList = (value: unknown, maxItems = 10, maxLength = 40): string[] => {
  if (!Array.isArray(value)) return [];
  const deduped = new Set<string>();
  const next: string[] = [];
  for (const item of value) {
    const normalized = readString(item, maxLength).toLowerCase();
    if (!normalized || deduped.has(normalized)) continue;
    deduped.add(normalized);
    next.push(normalized);
    if (next.length >= maxItems) break;
  }
  return next;
};

const parseIsoOrNull = (value: unknown): string | null => {
  if (value == null) return null;
  const asString = readString(String(value), 100);
  if (!asString) return null;
  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const buildRecommendationSource = (source: {
  id: string;
  title: unknown;
  summary: unknown;
  description: unknown;
  locationText: unknown;
  tags: unknown;
  workModel: unknown;
  salaryMin: unknown;
  salaryMax: unknown;
  createdAt: unknown;
  publishedAt: unknown;
}) => ({
  id: source.id,
  title: readString(source.title, 120),
  summary: readString(source.summary, 240),
  description: readString(source.description, 15000),
  locationText: readString(source.locationText, 160),
  tags: Array.isArray(source.tags) ? source.tags : [],
  workModel: readString(source.workModel, 40),
  salaryMin: source.salaryMin,
  salaryMax: source.salaryMax,
  createdAt: source.createdAt,
  publishedAt: source.publishedAt,
});

const applyJobPrecomputedFields = (job: any): void => {
  const recommendationSource = buildRecommendationSource({
    id: job.id,
    title: job.title,
    summary: job.summary,
    description: job.description,
    locationText: job.locationText,
    tags: job.tags,
    workModel: job.workModel,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    createdAt: job.createdAt,
    publishedAt: job.publishedAt,
  });
  Object.assign(job, buildJobRecommendationPrecomputedFields(recommendationSource));
  Object.assign(job, buildDemandRoleFields(job.title) || {});
  Object.assign(job, buildJobMarketDemandPrecomputedFields(recommendationSource));
};

const persistCreatedJob = async (params: {
  db: any;
  job: any;
  currentUserId: string;
}) => {
  await params.db.collection(JOBS_COLLECTION).insertOne(params.job);
  void registerJobMarketDemandSeedContexts({
    db: params.db,
    jobs: [{
      locationText: params.job.locationText,
      workModel: params.job.workModel,
      status: params.job.status,
    }],
  }).catch((error) => {
    console.warn('Register job market demand seed context error:', error);
  });
  recordJobPulseEventAsync(params.db, {
    jobId: params.job.id,
    type: 'job_discovered',
    userId: params.currentUserId,
    createdAt: params.job.createdAt,
  });
};

const buildCompanyJobUpdatePatch = (params: {
  existingJob: any;
  payload: Record<string, unknown>;
}): Record<string, unknown> => {
  const updates: Record<string, unknown> = {};

  if (params.payload.title !== undefined) {
    const value = readString(params.payload.title, 120);
    if (!value) throw createJobWriteError(400, 'title cannot be empty');
    updates.title = value;
  }

  if (params.payload.summary !== undefined) {
    const value = readString(params.payload.summary, 240);
    if (!value) throw createJobWriteError(400, 'summary cannot be empty');
    updates.summary = value;
  }

  if (params.payload.description !== undefined) {
    const value = readString(params.payload.description, 15000);
    if (!value) throw createJobWriteError(400, 'description cannot be empty');
    updates.description = value;
  }

  if (params.payload.locationText !== undefined) {
    const value = readString(params.payload.locationText, 160);
    if (!value) throw createJobWriteError(400, 'locationText cannot be empty');
    updates.locationText = value;
  }

  if (params.payload.workModel !== undefined) {
    const value = readString(params.payload.workModel, 40).toLowerCase();
    if (!ALLOWED_WORK_MODELS.has(value)) throw createJobWriteError(400, 'Invalid workModel');
    updates.workModel = value;
  }

  if (params.payload.employmentType !== undefined) {
    const value = readString(params.payload.employmentType, 40).toLowerCase();
    if (!ALLOWED_EMPLOYMENT_TYPES.has(value)) {
      throw createJobWriteError(400, 'Invalid employmentType');
    }
    updates.employmentType = value;
  }

  if (params.payload.salaryMin !== undefined) {
    const value = Number(params.payload.salaryMin);
    if (!Number.isFinite(value) || value < 0) {
      throw createJobWriteError(400, 'salaryMin must be a non-negative number');
    }
    updates.salaryMin = value;
  }

  if (params.payload.salaryMax !== undefined) {
    const value = Number(params.payload.salaryMax);
    if (!Number.isFinite(value) || value < 0) {
      throw createJobWriteError(400, 'salaryMax must be a non-negative number');
    }
    updates.salaryMax = value;
  }

  const nextSalaryMin =
    updates.salaryMin !== undefined
      ? Number(updates.salaryMin)
      : (Number.isFinite(params.existingJob.salaryMin) ? Number(params.existingJob.salaryMin) : null);
  const nextSalaryMax =
    updates.salaryMax !== undefined
      ? Number(updates.salaryMax)
      : (Number.isFinite(params.existingJob.salaryMax) ? Number(params.existingJob.salaryMax) : null);
  if (nextSalaryMin != null && nextSalaryMax != null && nextSalaryMax < nextSalaryMin) {
    throw createJobWriteError(400, 'salaryMax cannot be less than salaryMin');
  }

  if (params.payload.salaryCurrency !== undefined) {
    updates.salaryCurrency = readString(params.payload.salaryCurrency, 10).toUpperCase();
  }

  if (params.payload.applicationDeadline !== undefined) {
    updates.applicationDeadline = parseIsoOrNull(params.payload.applicationDeadline);
  }

  if (params.payload.applicationUrl !== undefined) {
    const parsedUrl = normalizeExternalUrl(params.payload.applicationUrl);
    const raw = readString(String(params.payload.applicationUrl || ''), 600);
    if (raw && !parsedUrl) {
      throw createJobWriteError(400, 'applicationUrl must be a valid http(s) URL');
    }
    updates.applicationUrl = parsedUrl;
  }

  if (params.payload.applicationEmail !== undefined) {
    const parsedEmail = normalizeEmailAddress(params.payload.applicationEmail);
    const raw = readString(String(params.payload.applicationEmail || ''), 200);
    if (raw && !parsedEmail) {
      throw createJobWriteError(400, 'applicationEmail must be a valid email address');
    }
    updates.applicationEmail = parsedEmail;
  }

  if (params.payload.tags !== undefined) {
    updates.tags = readStringList(params.payload.tags, 10, 40);
  }

  if (Object.keys(updates).length === 0) {
    throw createJobWriteError(400, 'No valid fields to update');
  }

  if (!normalizeJobSlugValue(params.existingJob?.slug, 220)) {
    updates.slug = buildPersistentJobSlug({ ...params.existingJob, ...updates, id: params.existingJob.id });
  }

  return updates;
};

const applyUpdatedJobDerivedFields = (params: {
  existingJob: any;
  updates: Record<string, unknown>;
}) => {
  const recommendationSource = buildRecommendationSource({
    id: params.existingJob.id,
    title: (params.updates.title as string | undefined) ?? params.existingJob.title,
    summary: (params.updates.summary as string | undefined) ?? params.existingJob.summary,
    description: (params.updates.description as string | undefined) ?? params.existingJob.description,
    locationText: (params.updates.locationText as string | undefined) ?? params.existingJob.locationText,
    tags: Array.isArray(params.updates.tags) ? params.updates.tags : params.existingJob.tags,
    workModel: (params.updates.workModel as string | undefined) ?? params.existingJob.workModel,
    salaryMin: params.updates.salaryMin !== undefined ? params.updates.salaryMin : params.existingJob.salaryMin,
    salaryMax: params.updates.salaryMax !== undefined ? params.updates.salaryMax : params.existingJob.salaryMax,
    createdAt: params.existingJob.createdAt,
    publishedAt: params.updates.publishedAt !== undefined ? params.updates.publishedAt : params.existingJob.publishedAt,
  });

  params.updates.updatedAt = new Date().toISOString();
  Object.assign(params.updates, buildJobRecommendationPrecomputedFields(recommendationSource));
  if (
    params.updates.title !== undefined
    || !readString(params.existingJob.demandRoleFamily, 120)
    || !readString(params.existingJob.demandRoleLabel, 120)
  ) {
    Object.assign(params.updates, buildDemandRoleFields(recommendationSource.title) || {});
  }
  if (
    params.updates.salaryMin !== undefined
    || params.updates.salaryMax !== undefined
    || params.updates.publishedAt !== undefined
    || !Number.isFinite(Number(params.existingJob.marketDemandFreshnessTs))
    || params.existingJob.marketDemandSalaryValue == null
  ) {
    Object.assign(params.updates, buildJobMarketDemandPrecomputedFields(recommendationSource));
  }
};

const persistUpdatedJob = async (params: {
  db: any;
  existingJob: any;
  updates: Record<string, unknown>;
}) => {
  await params.db.collection(JOBS_COLLECTION).updateOne({ id: params.existingJob.id }, { $set: params.updates });
  const updatedJob = await params.db.collection(JOBS_COLLECTION).findOne({ id: params.existingJob.id });
  void registerJobMarketDemandSeedContexts({
    db: params.db,
    jobs: [{
      locationText: (updatedJob as any)?.locationText ?? params.updates.locationText ?? params.existingJob.locationText,
      workModel: (updatedJob as any)?.workModel ?? params.updates.workModel ?? params.existingJob.workModel,
      status: (updatedJob as any)?.status ?? params.updates.status ?? params.existingJob.status,
    }],
  }).catch((error) => {
    console.warn('Register job market demand seed context error:', error);
  });
  return updatedJob;
};

const validateCreateCompanyJobInput = (payload: Record<string, unknown>) => {
  const title = readString(payload?.title, 120);
  const summary = readString(payload?.summary, 240);
  const description = readString(payload?.description, 15000);
  const locationText = readString(payload?.locationText, 160);
  const workModel = readString(payload?.workModel, 40).toLowerCase();
  const employmentType = readString(payload?.employmentType, 40).toLowerCase();
  const tags = readStringList(payload?.tags, 10, 40);

  if (!title || !summary || !description || !locationText) {
    throw createJobWriteError(400, 'title, summary, description, and locationText are required');
  }
  if (!ALLOWED_WORK_MODELS.has(workModel)) {
    throw createJobWriteError(400, 'Invalid workModel');
  }
  if (!ALLOWED_EMPLOYMENT_TYPES.has(employmentType)) {
    throw createJobWriteError(400, 'Invalid employmentType');
  }

  const salaryMinRaw = payload?.salaryMin;
  const salaryMaxRaw = payload?.salaryMax;
  const salaryMin = Number.isFinite(Number(salaryMinRaw)) ? Number(salaryMinRaw) : null;
  const salaryMax = Number.isFinite(Number(salaryMaxRaw)) ? Number(salaryMaxRaw) : null;
  const salaryCurrency = readString(payload?.salaryCurrency, 10).toUpperCase();
  const applicationDeadline = parseIsoOrNull(payload?.applicationDeadline);
  const hasApplicationUrlPayload = payload?.applicationUrl !== undefined;
  const hasApplicationEmailPayload = payload?.applicationEmail !== undefined;
  const applicationUrl = normalizeExternalUrl(payload?.applicationUrl);
  const applicationEmail = normalizeEmailAddress(payload?.applicationEmail);
  const createAnnouncement = Boolean(payload?.createAnnouncement ?? payload?.announceInFeed);

  if (salaryMin != null && salaryMin < 0) {
    throw createJobWriteError(400, 'salaryMin cannot be negative');
  }
  if (salaryMax != null && salaryMax < 0) {
    throw createJobWriteError(400, 'salaryMax cannot be negative');
  }
  if (salaryMin != null && salaryMax != null && salaryMax < salaryMin) {
    throw createJobWriteError(400, 'salaryMax cannot be less than salaryMin');
  }
  if (hasApplicationUrlPayload && !applicationUrl) {
    throw createJobWriteError(400, 'applicationUrl must be a valid http(s) URL');
  }
  if (hasApplicationEmailPayload && !applicationEmail) {
    throw createJobWriteError(400, 'applicationEmail must be a valid email address');
  }

  return {
    title,
    summary,
    description,
    locationText,
    workModel,
    employmentType,
    tags,
    salaryMin,
    salaryMax,
    salaryCurrency,
    applicationDeadline,
    applicationUrl,
    applicationEmail,
    createAnnouncement,
  };
};

const buildCompanyJobDocument = (params: {
  actorId: string;
  currentUserId: string;
  company: any;
  validatedInput: ReturnType<typeof validateCreateCompanyJobInput>;
  nowIso: string;
}) => {
  const jobId = `job-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const job = {
    id: jobId,
    slug: '',
    companyId: params.actorId,
    companyName: readString(params.company?.name, 120) || 'Company',
    companyHandle: readString(params.company?.handle, 80),
    companyIsVerified: Boolean(params.company?.isVerified),
    companyWebsite: normalizeExternalUrl(params.company?.website),
    companyEmail: normalizeEmailAddress(params.company?.email),
    title: params.validatedInput.title,
    summary: params.validatedInput.summary,
    description: params.validatedInput.description,
    locationText: params.validatedInput.locationText,
    workModel: params.validatedInput.workModel,
    employmentType: params.validatedInput.employmentType,
    salaryMin: params.validatedInput.salaryMin,
    salaryMax: params.validatedInput.salaryMax,
    salaryCurrency: params.validatedInput.salaryCurrency,
    applicationDeadline: params.validatedInput.applicationDeadline,
    status: 'open',
    source: 'aura:company',
    tags: params.validatedInput.tags,
    createdByUserId: params.currentUserId,
    createdAt: params.nowIso,
    discoveredAt: params.nowIso,
    updatedAt: params.nowIso,
    publishedAt: params.nowIso,
    announcementPostId: null as string | null,
    applicationUrl: params.validatedInput.applicationUrl,
    applicationEmail: params.validatedInput.applicationEmail,
    applicationCount: 0,
    viewCount: 0,
  };
  job.slug = buildPersistentJobSlug(job);
  return job;
};

const finalizeCreatedCompanyJob = async (params: {
  db: any;
  job: any;
  currentUserId: string;
}) => {
  applyJobPrecomputedFields(params.job);
  await persistCreatedJob({
    db: params.db,
    job: params.job,
    currentUserId: params.currentUserId,
  });
};

export const createCompanyJob = async (params: {
  db: any;
  actorId: string;
  currentUserId: string;
  company: any;
  payload: Record<string, unknown>;
  io?: { emit: (event: string, payload: any) => void } | null;
  emitInsightsUpdate?: () => Promise<unknown> | unknown;
}): Promise<any> => {
  const validatedInput = validateCreateCompanyJobInput(params.payload);

  const nowIso = new Date().toISOString();
  const job = buildCompanyJobDocument({
    actorId: params.actorId,
    currentUserId: params.currentUserId,
    company: params.company,
    validatedInput,
    nowIso,
  });

  await finalizeCreatedCompanyJob({
    db: params.db,
    job,
    currentUserId: params.currentUserId,
  });
  await runCompanyJobPostCreateHooks({
    db: params.db,
    actorId: params.actorId,
    company: params.company,
    validatedInput,
    job,
    io: params.io,
    emitInsightsUpdate: params.emitInsightsUpdate,
  });

  return job;
};

export const updateCompanyJob = async (params: {
  db: any;
  existingJob: any;
  payload: Record<string, unknown>;
}): Promise<any> => {
  const updates = buildCompanyJobUpdatePatch(params);
  applyUpdatedJobDerivedFields({
    existingJob: params.existingJob,
    updates,
  });
  return persistUpdatedJob({
    db: params.db,
    existingJob: params.existingJob,
    updates,
  });
};

export const updateCompanyJobStatus = async (params: {
  db: any;
  existingJob: any;
  nextStatus: string;
}): Promise<any> => {
  if (!ALLOWED_JOB_STATUSES.has(params.nextStatus)) {
    throw createJobWriteError(400, 'Invalid status');
  }

  const nextUpdate: Record<string, unknown> = {
    status: params.nextStatus,
    updatedAt: new Date().toISOString(),
  };
  if (params.nextStatus === 'open' && !params.existingJob.publishedAt) {
    nextUpdate.publishedAt = new Date().toISOString();
  }

  const recommendationSource = {
    id: params.existingJob.id,
    title: readString(params.existingJob.title, 120),
    summary: readString(params.existingJob.summary, 240),
    description: readString(params.existingJob.description, 15000),
    locationText: readString(params.existingJob.locationText, 160),
    tags: Array.isArray(params.existingJob.tags) ? params.existingJob.tags : [],
    workModel: readString(params.existingJob.workModel, 40),
    salaryMin: params.existingJob.salaryMin,
    salaryMax: params.existingJob.salaryMax,
    createdAt: params.existingJob.createdAt,
    publishedAt:
      params.nextStatus === 'open'
        ? (nextUpdate.publishedAt !== undefined ? nextUpdate.publishedAt : params.existingJob.publishedAt)
        : null,
  };

  if (params.nextStatus === 'open') {
    Object.assign(nextUpdate, buildJobRecommendationPrecomputedFields(recommendationSource));
  }
  if (!readString(params.existingJob.demandRoleFamily, 120) || !readString(params.existingJob.demandRoleLabel, 120)) {
    Object.assign(nextUpdate, buildDemandRoleFields(recommendationSource.title) || {});
  }
  if (
    params.nextStatus === 'open'
    && (nextUpdate.publishedAt !== undefined || !Number.isFinite(Number(params.existingJob.marketDemandFreshnessTs)))
  ) {
    Object.assign(nextUpdate, buildJobMarketDemandPrecomputedFields(recommendationSource));
  } else if (params.nextStatus !== 'open') {
    nextUpdate.marketDemandFreshnessTs = 0;
  }

  await params.db.collection(JOBS_COLLECTION).updateOne({ id: params.existingJob.id }, { $set: nextUpdate });
  const updatedJob = await params.db.collection(JOBS_COLLECTION).findOne({ id: params.existingJob.id });
  void registerJobMarketDemandSeedContexts({
    db: params.db,
    jobs: [{
      locationText: (updatedJob as any)?.locationText ?? params.existingJob.locationText,
      workModel: (updatedJob as any)?.workModel ?? params.existingJob.workModel,
      status: (updatedJob as any)?.status ?? nextUpdate.status ?? params.existingJob.status,
    }],
  }).catch((error) => {
    console.warn('Register job market demand seed context error:', error);
  });

  return updatedJob;
};
