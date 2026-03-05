import crypto from 'crypto';

const LEARNING_RESOURCES_COLLECTION = 'learning_resources';
const LEARNING_RESOURCES_CACHE_COLLECTION = 'learning_resources_cache';
const LEARNING_RESOURCES_CACHE_TTL_MS = 5 * 60 * 1000;
const JOB_SKILL_METADATA_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_JOB_SKILL_METADATA_CACHE_ENTRIES = 400;
const JOB_SKILL_METADATA_CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

type LearningResourceResponse = {
  id: string;
  skill: string;
  title: string;
  provider: string;
  url: string;
  level?: string | null;
  duration?: string | null;
  source: 'db' | 'fallback';
};

type JobSkillGapResponse = {
  userSkills: string[];
  jobSkills: string[];
  matchedSkills: string[];
  missingSkills: string[];
  learningResources: LearningResourceResponse[];
};

type SkillMatchResult = {
  jobSkills: string[];
  matchedSkills: string[];
  missingSkills: string[];
  skillLabelByToken: Map<string, string>;
};

type JobSkillMetadata = {
  jobSkills: string[];
  skillLabelByToken: Map<string, string>;
};

const jobSkillMetadataCache = new Map<string, { expiresAt: number; metadata: JobSkillMetadata }>();

const cleanupExpiredJobSkillMetadataCache = (nowTs = Date.now()): void => {
  for (const [cacheKey, cacheRow] of jobSkillMetadataCache.entries()) {
    if (cacheRow.expiresAt < nowTs) {
      jobSkillMetadataCache.delete(cacheKey);
    }
  }
};

const jobSkillMetadataCleanupTimer = setInterval(
  () => cleanupExpiredJobSkillMetadataCache(),
  JOB_SKILL_METADATA_CACHE_CLEANUP_INTERVAL_MS,
);
if (typeof (jobSkillMetadataCleanupTimer as any)?.unref === 'function') {
  (jobSkillMetadataCleanupTimer as any).unref();
}

const readString = (value: unknown, maxLength = 10000): string => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  return normalized.slice(0, maxLength);
};

const readStringOrNull = (value: unknown, maxLength = 10000): string | null => {
  const normalized = readString(value, maxLength);
  return normalized.length > 0 ? normalized : null;
};

const normalizeExternalUrl = (value: unknown): string | null => {
  const raw = readString(String(value || ''), 600);
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const normalizeSkillToken = (value: unknown): string => {
  const base = readString(String(value || ''), 80)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!base) return '';
  return base.replace(/[^a-z0-9+.#\-/\s]/g, '').replace(/\s+/g, ' ').trim();
};

const readSkillArray = (value: unknown, maxItems = 60): string[] => {
  if (!Array.isArray(value)) return [];
  const dedupe = new Set<string>();
  const next: string[] = [];
  for (const item of value) {
    const normalized = normalizeSkillToken(item);
    if (!normalized || dedupe.has(normalized)) continue;
    dedupe.add(normalized);
    next.push(normalized);
    if (next.length >= maxItems) break;
  }
  return next;
};

const toLearningResourceResponse = (
  resource: any,
  skillLabelByToken: Map<string, string>,
): LearningResourceResponse | null => {
  if (!resource || typeof resource !== 'object') return null;

  const url = normalizeExternalUrl(resource.url);
  const title = readString(resource.title, 180);
  if (!url || !title) return null;

  const provider = readString(resource.provider, 120) || 'Learning Platform';
  const normalizedSkill = normalizeSkillToken(resource.skill);
  const skill = normalizedSkill
    ? (skillLabelByToken.get(normalizedSkill) || normalizedSkill)
    : 'general';

  return {
    id: readString(resource.id, 140) || `learning-${crypto.randomBytes(4).toString('hex')}`,
    skill,
    title,
    provider,
    url,
    level: readStringOrNull(resource.level, 80),
    duration: readStringOrNull(resource.duration, 80),
    source: 'db',
  };
};

const buildFallbackLearningResources = (missingSkills: string[]): LearningResourceResponse[] =>
  missingSkills.slice(0, 4).map((skill) => ({
    id: `learning-fallback-${normalizeSkillToken(skill) || crypto.randomBytes(4).toString('hex')}`,
    skill,
    title: `Learn ${skill}`,
    provider: 'Coursera',
    url: `https://www.coursera.org/search?query=${encodeURIComponent(skill)}`,
    source: 'fallback',
  }));

const buildJobSkillMetadata = (job: any): JobSkillMetadata => {
  const jobSkills: string[] = Array.isArray(job?.tags)
    ? Array.from(
        new Set<string>(
          job.tags
            .map((tag: unknown) => readString(tag, 80))
            .filter((tag: string) => tag.length > 0),
        ),
      ).slice(0, 60)
    : [];

  const skillLabelByToken = new Map<string, string>();
  for (const skill of jobSkills) {
    const normalized = normalizeSkillToken(skill);
    if (!normalized || skillLabelByToken.has(normalized)) continue;
    skillLabelByToken.set(normalized, skill);
  }

  return { jobSkills, skillLabelByToken };
};

const getJobSkillMetadataCacheKey = (job: any): string => {
  const jobId = readString(job?.id, 120) || 'unknown-job';
  const version = readString(job?.updatedAt, 80) || readString(job?.publishedAt, 80) || '';
  return `${jobId}|${version}`;
};

const getJobSkillMetadata = (job: any): JobSkillMetadata => {
  const key = getJobSkillMetadataCacheKey(job);
  const now = Date.now();
  const cached = jobSkillMetadataCache.get(key);
  if (cached && cached.expiresAt >= now) {
    return cached.metadata;
  }

  const metadata = buildJobSkillMetadata(job);

  cleanupExpiredJobSkillMetadataCache(now);
  while (jobSkillMetadataCache.size >= MAX_JOB_SKILL_METADATA_CACHE_ENTRIES) {
    const oldestKey = jobSkillMetadataCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    jobSkillMetadataCache.delete(oldestKey);
  }
  jobSkillMetadataCache.set(key, {
    expiresAt: now + JOB_SKILL_METADATA_CACHE_TTL_MS,
    metadata,
  });

  return metadata;
};

const buildSkillMatch = (job: any, userSkillSet: Set<string>): SkillMatchResult => {
  const metadata = getJobSkillMetadata(job);
  const { jobSkills, skillLabelByToken } = metadata;

  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];
  for (const [normalized, displayLabel] of skillLabelByToken.entries()) {
    if (userSkillSet.has(normalized)) {
      matchedSkills.push(displayLabel);
    } else {
      missingSkills.push(displayLabel);
    }
  }

  return {
    jobSkills,
    matchedSkills,
    missingSkills,
    skillLabelByToken,
  };
};

const resolveViewerSkillSet = (viewer: any): Set<string> | null => {
  const viewerSkills = new Set<string>([
    ...readSkillArray(viewer?.skills, 80),
    ...readSkillArray(viewer?.profileSkills, 80),
  ]);
  return viewerSkills.size > 0 ? viewerSkills : null;
};

const toMissingSkillTokens = (missingSkills: string[]): string[] =>
  missingSkills
    .map((skill) => normalizeSkillToken(skill))
    .filter((token) => token.length > 0);

type LearningResourceGateway = {
  readCache: (cacheKey: string, now: Date, signal?: AbortSignal) => Promise<LearningResourceResponse[] | null>;
  queryResources: (missingSkillTokens: string[], signal?: AbortSignal) => Promise<any[]>;
  writeCache: (cacheKey: string, rows: LearningResourceResponse[], now: Date, signal?: AbortSignal) => Promise<void>;
};

const createMongoLearningResourceGateway = (db: any): LearningResourceGateway => ({
  readCache: async (cacheKey: string, now: Date, signal?: AbortSignal) => {
    const cachedDoc = await db.collection(LEARNING_RESOURCES_CACHE_COLLECTION).findOne(
      {
        cacheKey,
        expiresAt: { $gt: now },
      },
      {
        projection: { rows: 1 },
        signal,
      },
    );

    if (!Array.isArray(cachedDoc?.rows)) return null;
    return cachedDoc.rows as LearningResourceResponse[];
  },
  queryResources: async (missingSkillTokens: string[], signal?: AbortSignal) => {
    return await db.collection(LEARNING_RESOURCES_COLLECTION)
      .find({
        $or: [
          { skill: { $in: missingSkillTokens } },
          { skills: { $in: missingSkillTokens } },
        ],
      }, { signal })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(20)
      .toArray();
  },
  writeCache: async (cacheKey: string, rows: LearningResourceResponse[], now: Date, signal?: AbortSignal) => {
    await db.collection(LEARNING_RESOURCES_CACHE_COLLECTION).updateOne(
      { cacheKey },
      {
        $set: {
          cacheKey,
          rows,
          expiresAt: new Date(Date.now() + LEARNING_RESOURCES_CACHE_TTL_MS),
          updatedAt: now.toISOString(),
        },
        $setOnInsert: {
          createdAt: now.toISOString(),
        },
      },
      { upsert: true, signal },
    );
  },
});

const transformLearningResourceRows = (
  resourceRows: any[],
  skillLabelByToken: Map<string, string>,
): LearningResourceResponse[] => {
  const dedupeByUrl = new Set<string>();
  const transformedRows: LearningResourceResponse[] = [];
  for (const row of resourceRows) {
    const transformed = toLearningResourceResponse(row, skillLabelByToken);
    if (!transformed) continue;
    if (dedupeByUrl.has(transformed.url)) continue;
    dedupeByUrl.add(transformed.url);
    transformedRows.push(transformed);
    if (transformedRows.length >= 8) break;
  }
  return transformedRows;
};

const fetchLearningResourcesByMissingSkills = async (
  gateway: LearningResourceGateway,
  missingSkills: string[],
  skillLabelByToken: Map<string, string>,
  signal?: AbortSignal,
): Promise<LearningResourceResponse[]> => {
  const missingSkillTokens = toMissingSkillTokens(missingSkills);
  if (missingSkillTokens.length === 0) return [];

  const cacheKey = missingSkillTokens.slice().sort().join('|');
  const now = new Date();
  const cachedRows = await gateway.readCache(cacheKey, now, signal);
  if (cachedRows && cachedRows.length > 0) {
    return cachedRows;
  }

  const resourceRows = await gateway.queryResources(missingSkillTokens, signal);
  const learningResources = transformLearningResourceRows(resourceRows, skillLabelByToken);

  const finalRows =
    learningResources.length > 0
      ? learningResources
      : buildFallbackLearningResources(missingSkills);

  try {
    await gateway.writeCache(cacheKey, finalRows, now, signal);
  } catch {
    // Cache write failures should not block skill-gap response generation.
  }

  return finalRows;
};

export const buildJobSkillGap = async (
  params: {
    db: any;
    currentUserId: string;
    viewer?: any;
    job: any;
    signal?: AbortSignal;
  },
): Promise<JobSkillGapResponse | null> => {
  const { db, currentUserId, viewer, job, signal } = params;
  const userId = readString(currentUserId, 120);
  if (!userId) return null;

  const userSkillSet = resolveViewerSkillSet(viewer);
  if (!userSkillSet || !job || typeof job !== 'object') return null;

  const skillMatch = buildSkillMatch(job, userSkillSet);
  const gateway = createMongoLearningResourceGateway(db);
  const learningResources = await fetchLearningResourcesByMissingSkills(
    gateway,
    skillMatch.missingSkills,
    skillMatch.skillLabelByToken,
    signal,
  );

  return {
    userSkills: Array.from(userSkillSet),
    jobSkills: skillMatch.jobSkills,
    matchedSkills: skillMatch.matchedSkills,
    missingSkills: skillMatch.missingSkills,
    learningResources,
  };
};
