"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestAggregatedJobsBatch = exports.MAX_INTERNAL_AGGREGATED_INGEST_ITEMS = void 0;
const crypto_1 = __importDefault(require("crypto"));
const inputSanitizers_1 = require("../utils/inputSanitizers");
const JOBS_COLLECTION = 'jobs';
exports.MAX_INTERNAL_AGGREGATED_INGEST_ITEMS = 500;
const NORMALIZATION_YIELD_INTERVAL = 10;
const ALLOWED_JOB_STATUSES = new Set(['open', 'closed', 'archived']);
const ALLOWED_EMPLOYMENT_TYPES = new Set(['full_time', 'part_time', 'contract', 'internship', 'temporary']);
const ALLOWED_WORK_MODELS = new Set(['onsite', 'hybrid', 'remote']);
const readStringList = (value, maxItems = 10, maxLength = 40) => {
    if (!Array.isArray(value))
        return [];
    const deduped = new Set();
    const next = [];
    for (const item of value) {
        const normalized = (0, inputSanitizers_1.readString)(item, maxLength).toLowerCase();
        if (!normalized || deduped.has(normalized))
            continue;
        deduped.add(normalized);
        next.push(normalized);
        if (next.length >= maxItems)
            break;
    }
    return next;
};
const parseIsoOrNull = (value) => {
    if (value == null)
        return null;
    const asString = (0, inputSanitizers_1.readString)(String(value), 100);
    if (!asString)
        return null;
    const parsed = new Date(asString);
    if (Number.isNaN(parsed.getTime()))
        return null;
    return parsed.toISOString();
};
const parseFiniteNumberOrNull = (value) => {
    if (value == null || value === '')
        return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return null;
    return numeric;
};
const summarizeText = (value, maxLength = 240) => {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized)
        return '';
    if (normalized.length <= maxLength)
        return normalized;
    return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
};
const normalizeExternalUrl = (value) => {
    const raw = (0, inputSanitizers_1.readString)(String(value || ''), 600);
    if (!raw)
        return null;
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
        const parsed = new URL(withProtocol);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            return null;
        return parsed.toString();
    }
    catch (_a) {
        return null;
    }
};
const normalizeEmailAddress = (value) => {
    const raw = (0, inputSanitizers_1.readString)(String(value || ''), 200).toLowerCase();
    if (!raw)
        return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw))
        return null;
    return raw;
};
const normalizeWorkModel = (rawValue, locationText) => {
    const candidate = (0, inputSanitizers_1.readString)(rawValue, 40).toLowerCase();
    if (ALLOWED_WORK_MODELS.has(candidate))
        return candidate;
    if (/\bremote\b/i.test(locationText))
        return 'remote';
    if (/\bhybrid\b/i.test(locationText))
        return 'hybrid';
    return 'onsite';
};
const normalizeEmploymentType = (rawValue) => {
    const candidate = (0, inputSanitizers_1.readString)(rawValue, 40).toLowerCase();
    if (ALLOWED_EMPLOYMENT_TYPES.has(candidate))
        return candidate;
    return 'full_time';
};
const normalizeIngestStatus = (rawValue) => {
    const candidate = (0, inputSanitizers_1.readString)(rawValue, 40).toLowerCase();
    if (!ALLOWED_JOB_STATUSES.has(candidate))
        return 'open';
    return candidate;
};
const normalizeSalaryFields = (rawPayload) => {
    let salaryMin = parseFiniteNumberOrNull(rawPayload.salaryMin);
    let salaryMax = parseFiniteNumberOrNull(rawPayload.salaryMax);
    if (salaryMin != null && salaryMin < 0)
        salaryMin = null;
    if (salaryMax != null && salaryMax < 0)
        salaryMax = null;
    if (salaryMin != null && salaryMax != null && salaryMax < salaryMin) {
        const lower = Math.min(salaryMin, salaryMax);
        const upper = Math.max(salaryMin, salaryMax);
        salaryMin = lower;
        salaryMax = upper;
    }
    const parsedApplicationCount = parseFiniteNumberOrNull(rawPayload.applicationCount);
    const applicationCount = parsedApplicationCount != null && parsedApplicationCount >= 0
        ? Math.floor(parsedApplicationCount)
        : 0;
    return {
        salaryMin,
        salaryMax,
        salaryCurrency: (0, inputSanitizers_1.readString)(rawPayload.salaryCurrency, 10).toUpperCase(),
        applicationCount,
    };
};
const normalizeAggregatedCoreFields = (rawPayload) => {
    const source = (0, inputSanitizers_1.readString)(rawPayload.source, 60).toLowerCase() || 'aggregated';
    const originalId = (0, inputSanitizers_1.readString)(rawPayload.originalId, 220);
    const originalUrl = normalizeExternalUrl(rawPayload.originalUrl);
    const title = (0, inputSanitizers_1.readString)(rawPayload.title, 120);
    const companyName = (0, inputSanitizers_1.readString)(rawPayload.companyName, 120);
    const locationText = (0, inputSanitizers_1.readString)(rawPayload.locationText, 160);
    const rawSummary = (0, inputSanitizers_1.readString)(rawPayload.summary, 240);
    const rawDescription = (0, inputSanitizers_1.readString)(rawPayload.description, 15000);
    const summary = rawSummary || summarizeText(rawDescription, 240);
    const description = rawDescription || summary;
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
const normalizeAggregatedMetaFields = (rawPayload, nowIso, originalUrl) => {
    const publishedAt = parseIsoOrNull(rawPayload.publishedAt) || nowIso;
    const createdAt = parseIsoOrNull(rawPayload.createdAt) || publishedAt;
    return {
        publishedAt,
        createdAt,
        applicationUrl: normalizeExternalUrl(rawPayload.applicationUrl) || originalUrl,
        applicationEmail: normalizeEmailAddress(rawPayload.applicationEmail),
        companyId: (0, inputSanitizers_1.readString)(rawPayload.companyId, 120),
        companyHandle: (0, inputSanitizers_1.readString)(rawPayload.companyHandle, 80),
        companyIsVerified: Boolean(rawPayload.companyIsVerified),
        createdByUserId: (0, inputSanitizers_1.readString)(rawPayload.createdByUserId, 120) || 'system',
        providedJobId: (0, inputSanitizers_1.readString)(rawPayload.id, 120),
    };
};
const buildAggregatedIngestFilter = (params) => {
    if (params.source && params.originalId) {
        return { source: params.source, originalId: params.originalId };
    }
    if (params.source && params.originalUrl) {
        return { source: params.source, originalUrl: params.originalUrl };
    }
    return null;
};
const buildAggregatedIngestMutation = (params) => {
    const filter = buildAggregatedIngestFilter({
        source: params.core.source,
        originalId: params.core.originalId,
        originalUrl: params.core.originalUrl,
    });
    const jobId = params.meta.providedJobId || `job-${Date.now()}-${crypto_1.default.randomBytes(4).toString('hex')}`;
    const setFields = {
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
            updatedAt: params.nowIso,
            announcementPostId: null,
            viewCount: 0,
        },
    };
};
const normalizeAggregatedIngestPayload = (raw, nowIso) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { skipReason: 'invalid_payload' };
    }
    const sourcePayload = raw;
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
const createIngestionStats = () => ({
    inserted: 0,
    updated: 0,
    skipped: 0,
    skippedReasons: {},
    errorSamples: [],
});
const yieldToEventLoop = () => __awaiter(void 0, void 0, void 0, function* () { return new Promise((resolve) => setImmediate(resolve)); });
const incrementSkipReason = (stats, reason, count = 1) => {
    if (count <= 0)
        return;
    stats.skipped += count;
    stats.skippedReasons[reason] = (stats.skippedReasons[reason] || 0) + count;
};
const buildBulkIngestionOperations = (jobs, nowIso, stats) => __awaiter(void 0, void 0, void 0, function* () {
    const operations = [];
    const operationSourceIndexes = [];
    for (let index = 0; index < jobs.length; index += 1) {
        const normalized = normalizeAggregatedIngestPayload(jobs[index], nowIso);
        if ('skipReason' in normalized) {
            incrementSkipReason(stats, normalized.skipReason, 1);
            continue;
        }
        operations.push({
            updateOne: {
                filter: normalized.payload.filter,
                update: {
                    $set: normalized.payload.setFields,
                    $setOnInsert: normalized.payload.setOnInsertFields,
                },
                upsert: true,
            },
        });
        operationSourceIndexes.push(index);
        if ((index + 1) % NORMALIZATION_YIELD_INTERVAL === 0) {
            yield yieldToEventLoop();
        }
    }
    return { operations, operationSourceIndexes };
});
const applyBulkWriteResultToStats = (stats, result) => {
    const upsertedCount = Number(result.upsertedCount || 0);
    const modifiedCount = Number(result.modifiedCount || 0);
    const matchedCount = Number(result.matchedCount || 0);
    stats.inserted += upsertedCount;
    stats.updated += modifiedCount;
    const unchangedCount = Math.max(0, matchedCount - modifiedCount);
    if (unchangedCount > 0) {
        incrementSkipReason(stats, 'no_changes', unchangedCount);
    }
};
const addWriteErrorsToStats = (stats, writeErrors, operationSourceIndexes) => {
    if (writeErrors.length > 0) {
        incrementSkipReason(stats, 'database_error', writeErrors.length);
    }
    for (const writeError of writeErrors) {
        if (stats.errorSamples.length >= 5)
            break;
        const opIndex = Number.isFinite(writeError === null || writeError === void 0 ? void 0 : writeError.index) ? Number(writeError.index) : -1;
        const sourceIndex = opIndex >= 0 && opIndex < operationSourceIndexes.length
            ? operationSourceIndexes[opIndex]
            : opIndex;
        stats.errorSamples.push({
            index: sourceIndex,
            message: (0, inputSanitizers_1.readString)(writeError === null || writeError === void 0 ? void 0 : writeError.errmsg, 300) ||
                (0, inputSanitizers_1.readString)(writeError === null || writeError === void 0 ? void 0 : writeError.message, 300) ||
                'Bulk ingestion write error',
        });
    }
};
const addWriteConcernErrorSample = (stats, writeConcernErrors) => {
    var _a, _b;
    if (writeConcernErrors.length === 0 || stats.errorSamples.length >= 5)
        return;
    stats.errorSamples.push({
        index: -1,
        message: (0, inputSanitizers_1.readString)((_a = writeConcernErrors[0]) === null || _a === void 0 ? void 0 : _a.errmsg, 300) ||
            (0, inputSanitizers_1.readString)((_b = writeConcernErrors[0]) === null || _b === void 0 ? void 0 : _b.message, 300) ||
            'Bulk ingestion write concern error',
    });
};
const ingestAggregatedJobsBatch = (db, jobs, nowIso) => __awaiter(void 0, void 0, void 0, function* () {
    const stats = createIngestionStats();
    const { operations, operationSourceIndexes } = yield buildBulkIngestionOperations(jobs, nowIso, stats);
    if (operations.length === 0) {
        return stats;
    }
    try {
        const result = yield db.collection(JOBS_COLLECTION).bulkWrite(operations, { ordered: false });
        applyBulkWriteResultToStats(stats, result);
        return stats;
    }
    catch (bulkError) {
        const partialResult = bulkError === null || bulkError === void 0 ? void 0 : bulkError.result;
        if (!partialResult) {
            incrementSkipReason(stats, 'database_error', operations.length);
            if (stats.errorSamples.length < 5) {
                stats.errorSamples.push({
                    index: -1,
                    message: (0, inputSanitizers_1.readString)(bulkError === null || bulkError === void 0 ? void 0 : bulkError.message, 300) ||
                        'Bulk ingestion failed before MongoDB returned partial results',
                });
            }
            console.error('Internal aggregated jobs ingest non-bulk error:', bulkError);
            throw bulkError;
        }
        applyBulkWriteResultToStats(stats, partialResult);
        const writeErrors = Array.isArray(bulkError === null || bulkError === void 0 ? void 0 : bulkError.writeErrors) ? bulkError.writeErrors : [];
        addWriteErrorsToStats(stats, writeErrors, operationSourceIndexes);
        const writeConcernErrors = Array.isArray(bulkError === null || bulkError === void 0 ? void 0 : bulkError.writeConcernErrors)
            ? bulkError.writeConcernErrors
            : [];
        addWriteConcernErrorSample(stats, writeConcernErrors);
        console.error('Internal aggregated jobs ingest bulk write error:', bulkError);
        return stats;
    }
});
exports.ingestAggregatedJobsBatch = ingestAggregatedJobsBatch;
