import { buildJobHeatResponseFields, listJobPulseSnapshots } from './jobPulseSnapshotService';
import { readString, readStringOrNull } from '../utils/inputSanitizers';

const CAREER_PAGE_SOURCE_SITES = new Set(['greenhouse', 'lever', 'workday', 'smartrecruiters', 'careers']);

const normalizeSlugValue = (value: unknown, maxLength = 220): string => {
  const raw = readString(String(value || ''), maxLength)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!raw) return '';
  return raw
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const slugifySegment = (value: unknown, maxLength = 80): string => {
  const normalized = readString(String(value || ''), 240)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.slice(0, maxLength).replace(/-+$/g, '');
};

const buildJobSlug = (job: any): string => {
  const titlePart = slugifySegment(job?.title, 90);
  const locationPart = slugifySegment(job?.locationText, 70);
  const companyPart = slugifySegment(job?.companyName || job?.companyHandle, 70);
  const parts = [titlePart, locationPart || companyPart].filter((part) => part.length > 0);
  return parts.join('-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
};

export const buildPersistentJobSlug = (job: any): string => {
  if (!job || typeof job !== 'object') return 'job';
  const stored = normalizeSlugValue(job?.slug, 220);
  if (stored) return stored;

  const baseSlug = buildJobSlug(job) || 'job';
  const idSlug = slugifySegment(job?.id, 120);
  const rawSlug = idSlug ? `${baseSlug}--${idSlug}` : baseSlug;
  return normalizeSlugValue(rawSlug, 220) || 'job';
};

const parseSourceSite = (value: unknown): string => {
  const source = readString(value, 120).toLowerCase();
  if (!source) return '';
  const [, suffix = source] = source.split(':', 2);
  return readString(suffix, 120).toLowerCase();
};

export const toJobResponse = (job: any) => ({
  id: String(job?.id || ''),
  slug: buildPersistentJobSlug(job),
  source: readString(job?.source, 120) || null,
  sourceSite: parseSourceSite(job?.source) || null,
  isCareerPageSource: CAREER_PAGE_SOURCE_SITES.has(parseSourceSite(job?.source)),
  companyId: String(job?.companyId || ''),
  companyName: String(job?.companyName || ''),
  companyHandle: String(job?.companyHandle || ''),
  companyIsVerified: Boolean(job?.companyIsVerified),
  companyWebsite: readStringOrNull(job?.companyWebsite, 600),
  companyEmail: readStringOrNull(job?.companyEmail, 200),
  title: String(job?.title || ''),
  summary: String(job?.summary || ''),
  description: String(job?.description || ''),
  locationText: String(job?.locationText || ''),
  workModel: String(job?.workModel || 'onsite'),
  employmentType: String(job?.employmentType || 'full_time'),
  salaryMin: typeof job?.salaryMin === 'number' ? job.salaryMin : null,
  salaryMax: typeof job?.salaryMax === 'number' ? job.salaryMax : null,
  salaryCurrency: String(job?.salaryCurrency || ''),
  applicationDeadline: job?.applicationDeadline || null,
  status: String(job?.status || 'open'),
  tags: Array.isArray(job?.tags) ? job.tags : [],
  createdByUserId: String(job?.createdByUserId || ''),
  createdAt: job?.createdAt || null,
  discoveredAt: job?.discoveredAt || null,
  updatedAt: job?.updatedAt || null,
  publishedAt: job?.publishedAt || null,
  announcementPostId: job?.announcementPostId || null,
  applicationUrl: readStringOrNull(job?.applicationUrl, 600),
  applicationEmail: readStringOrNull(job?.applicationEmail, 200),
  applicationCount: Number.isFinite(job?.applicationCount) ? Number(job.applicationCount) : 0,
  viewCount: Number.isFinite(job?.viewCount) ? Number(job.viewCount) : 0,
});

const indexPulseSnapshotsByJobId = (
  snapshots: Awaited<ReturnType<typeof listJobPulseSnapshots>>,
): Map<string, (typeof snapshots)[number]> =>
  new Map(
    snapshots.map((snapshot) => [readString(snapshot?.jobId, 120), snapshot] as const).filter(([jobId]) => jobId.length > 0),
  );

export const attachHeatFieldsToJobResponses = async (params: {
  db: any;
  jobs: Array<Record<string, unknown>>;
}): Promise<Array<Record<string, unknown>>> => {
  const jobIds = params.jobs
    .map((job) => readString(job?.id, 120))
    .filter((jobId) => jobId.length > 0);
  if (jobIds.length === 0) return params.jobs;

  const pulseSnapshotsByJobId = indexPulseSnapshotsByJobId(
    await listJobPulseSnapshots({
      db: params.db,
      requestedJobIds: jobIds,
      limit: jobIds.length,
    }),
  );

  return params.jobs.map((job) => ({
    ...job,
    ...buildJobHeatResponseFields({ snapshot: pulseSnapshotsByJobId.get(readString(job?.id, 120)) }),
  }));
};
