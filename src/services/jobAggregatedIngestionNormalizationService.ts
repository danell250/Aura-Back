import crypto from 'crypto';

import { normalizeEmailAddress, normalizeExternalUrl } from '../utils/contactNormalization';
import { readString } from '../utils/inputSanitizers';
import { normalizeJobText } from './jobTextNormalizationService';
import { buildAggregatedJobDerivedFields } from './jobAggregatedIngestionEnrichmentService';

const ALLOWED_JOB_STATUSES = new Set(['open', 'closed', 'archived']);
const ALLOWED_EMPLOYMENT_TYPES = new Set(['full_time', 'part_time', 'contract', 'internship', 'temporary']);
const ALLOWED_WORK_MODELS = new Set(['onsite', 'hybrid', 'remote']);

export type NormalizedAggregatedIngestPayload = {
  filter: Record<string, unknown>;
  setFields: Record<string, unknown>;
  setOnInsertFields: Record<string, unknown>;
};

type AggregatedIngestCoreFields = {
  source: string;
  originalId: string;
  originalUrl: string | null;
  title: string;
  companyName: string;
  locationText: string;
  summary: string;
  description: string;
  workModel: string;
  employmentType: string;
  status: string;
  tags: string[];
};

type AggregatedIngestCompensationFields = {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  applicationCount: number;
};

type AggregatedIngestMetaFields = {
  publishedAt: string;
  createdAt: string;
  applicationUrl: string | null;
  applicationEmail: string | null;
  companyId: string;
  companyHandle: string;
  companyIsVerified: boolean;
  createdByUserId: string;
  providedJobId: string;
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

const parseFiniteNumberOrNull = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
};

const summarizeNormalizedText = (value: string, maxLength = 240): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
};

const normalizeWorkModel = (rawValue: unknown, locationText: string): string => {
  const candidate = readString(rawValue, 40).toLowerCase();
  if (ALLOWED_WORK_MODELS.has(candidate)) return candidate;
  if (/\bremote\b/i.test(locationText)) return 'remote';
  if (/\bhybrid\b/i.test(locationText)) return 'hybrid';
  return 'onsite';
};

const normalizeEmploymentType = (rawValue: unknown): string => {
  const candidate = readString(rawValue, 40).toLowerCase();
  if (ALLOWED_EMPLOYMENT_TYPES.has(candidate)) return candidate;
  return 'full_time';
};

const normalizeIngestStatus = (rawValue: unknown): string => {
  const candidate = readString(rawValue, 40).toLowerCase();
  if (!ALLOWED_JOB_STATUSES.has(candidate)) return 'open';
  return candidate;
};

const normalizeSalaryFields = (rawPayload: Record<string, unknown>): AggregatedIngestCompensationFields => {
  let salaryMin = parseFiniteNumberOrNull(rawPayload.salaryMin);
  let salaryMax = parseFiniteNumberOrNull(rawPayload.salaryMax);
  if (salaryMin != null && salaryMin < 0) salaryMin = null;
  if (salaryMax != null && salaryMax < 0) salaryMax = null;
  if (salaryMin != null && salaryMax != null && salaryMax < salaryMin) {
    const lower = Math.min(salaryMin, salaryMax);
    const upper = Math.max(salaryMin, salaryMax);
    salaryMin = lower;
    salaryMax = upper;
  }

  const parsedApplicationCount = parseFiniteNumberOrNull(rawPayload.applicationCount);
  const applicationCount =
    parsedApplicationCount != null && parsedApplicationCount >= 0
      ? Math.floor(parsedApplicationCount)
      : 0;

  return {
    salaryMin,
    salaryMax,
    salaryCurrency: readString(rawPayload.salaryCurrency, 10).toUpperCase(),
    applicationCount,
  };
};

const normalizeAggregatedCoreFields = (
  rawPayload: Record<string, unknown>,
): { fields: AggregatedIngestCoreFields } | { skipReason: string } => {
  const source = readString(rawPayload.source, 60).toLowerCase() || 'aggregated';
  const originalId = readString(rawPayload.originalId, 220);
  const originalUrl = normalizeExternalUrl(rawPayload.originalUrl);
  const title = readString(rawPayload.title, 120);
  const companyName = readString(rawPayload.companyName, 120);
  const locationText = readString(rawPayload.locationText, 160);
  const rawSummary = normalizeJobText(rawPayload.summary, 240);
  const rawDescription = normalizeJobText(rawPayload.description, 15000);
  const summary = rawSummary || summarizeNormalizedText(rawDescription, 240);
  const description = rawDescription || rawSummary;

  if (!title || !companyName || !locationText || !summary || !description) {
    return { skipReason: 'missing_required_fields' };
  }

  return {
    fields: {
      source,
      originalId,
      originalUrl,
      title,
      companyName,
      locationText,
      summary,
      description,
      workModel: normalizeWorkModel(rawPayload.workModel, locationText),
      employmentType: normalizeEmploymentType(rawPayload.employmentType),
      status: normalizeIngestStatus(rawPayload.status),
      tags: readStringList(rawPayload.tags, 12, 40),
    },
  };
};

const normalizeAggregatedMetaFields = (
  rawPayload: Record<string, unknown>,
  nowIso: string,
  originalUrl: string | null,
): AggregatedIngestMetaFields => {
  const publishedAt = parseIsoOrNull(rawPayload.publishedAt) || nowIso;
  const createdAt = parseIsoOrNull(rawPayload.createdAt) || publishedAt;
  return {
    publishedAt,
    createdAt,
    applicationUrl: normalizeExternalUrl(rawPayload.applicationUrl) || originalUrl,
    applicationEmail: normalizeEmailAddress(rawPayload.applicationEmail),
    companyId: readString(rawPayload.companyId, 120),
    companyHandle: readString(rawPayload.companyHandle, 80),
    companyIsVerified: Boolean(rawPayload.companyIsVerified),
    createdByUserId: readString(rawPayload.createdByUserId, 120) || 'system',
    providedJobId: readString(rawPayload.id, 120),
  };
};

const buildAggregatedIngestFilter = (params: {
  source: string;
  originalId: string;
  originalUrl: string | null;
}): Record<string, unknown> | null => {
  if (params.source && params.originalId) {
    return { source: params.source, originalId: params.originalId };
  }
  if (params.source && params.originalUrl) {
    return { source: params.source, originalUrl: params.originalUrl };
  }
  return null;
};

const buildAggregatedIngestMutation = (params: {
  core: AggregatedIngestCoreFields;
  compensation: AggregatedIngestCompensationFields;
  meta: AggregatedIngestMetaFields;
  nowIso: string;
}): NormalizedAggregatedIngestPayload => {
  const filter = buildAggregatedIngestFilter({
    source: params.core.source,
    originalId: params.core.originalId,
    originalUrl: params.core.originalUrl,
  }) as Record<string, unknown>;

  const jobId = params.meta.providedJobId || `job-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  const setFields: Record<string, unknown> = {
    source: params.core.source,
    title: params.core.title,
    companyName: params.core.companyName,
    companyId: params.meta.companyId,
    companyHandle: params.meta.companyHandle,
    companyIsVerified: params.meta.companyIsVerified,
    summary: params.core.summary,
    description: params.core.description,
    locationText: params.core.locationText,
    workModel: params.core.workModel,
    employmentType: params.core.employmentType,
    salaryMin: params.compensation.salaryMin,
    salaryMax: params.compensation.salaryMax,
    salaryCurrency: params.compensation.salaryCurrency,
    status: params.core.status,
    tags: params.core.tags,
    publishedAt: params.meta.publishedAt,
    applicationUrl: params.meta.applicationUrl,
    applicationEmail: params.meta.applicationEmail,
    applicationCount: params.compensation.applicationCount,
    updatedAt: params.nowIso,
  };
  Object.assign(
    setFields,
    buildAggregatedJobDerivedFields({
      title: params.core.title,
      summary: params.core.summary,
      description: params.core.description,
      locationText: params.core.locationText,
      tags: params.core.tags,
      workModel: params.core.workModel,
      salaryMin: params.compensation.salaryMin,
      salaryMax: params.compensation.salaryMax,
      createdAt: params.meta.createdAt,
      publishedAt: params.meta.publishedAt,
    }),
  );

  if (params.core.originalId) {
    setFields.originalId = params.core.originalId;
  }
  if (params.core.originalUrl) {
    setFields.originalUrl = params.core.originalUrl;
  }

  return {
    filter,
    setFields,
    setOnInsertFields: {
      id: jobId,
      slug: '',
      createdByUserId: params.meta.createdByUserId,
      createdAt: params.meta.createdAt,
      discoveredAt: params.nowIso,
      announcementPostId: null,
      viewCount: 0,
    },
  };
};

export const normalizeAggregatedIngestPayload = (
  raw: unknown,
  nowIso: string,
): { payload: NormalizedAggregatedIngestPayload } | { skipReason: string } => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { skipReason: 'invalid_payload' };
  }

  const sourcePayload = raw as Record<string, unknown>;
  const core = normalizeAggregatedCoreFields(sourcePayload);
  if ('skipReason' in core) {
    return core;
  }
  const meta = normalizeAggregatedMetaFields(sourcePayload, nowIso, core.fields.originalUrl);
  const compensation = normalizeSalaryFields(sourcePayload);

  const filter = buildAggregatedIngestFilter({
    source: core.fields.source,
    originalId: core.fields.originalId,
    originalUrl: core.fields.originalUrl,
  });
  if (!filter) {
    return { skipReason: 'missing_identity' };
  }

  return {
    payload: buildAggregatedIngestMutation({
      core: core.fields,
      compensation,
      meta,
      nowIso,
    }),
  };
};
