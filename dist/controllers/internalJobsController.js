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
Object.defineProperty(exports, "__esModule", { value: true });
exports.internalJobsController = void 0;
const db_1 = require("../db");
const internalJobIngestionService_1 = require("../services/internalJobIngestionService");
const reverseJobMatchService_1 = require("../services/reverseJobMatchService");
const REVERSE_MATCH_BACKGROUND_RETRY_LIMIT = Number.isFinite(Number(process.env.REVERSE_MATCH_BACKGROUND_RETRY_LIMIT))
    ? Math.max(0, Math.round(Number(process.env.REVERSE_MATCH_BACKGROUND_RETRY_LIMIT)))
    : 1;
const REVERSE_MATCH_BACKGROUND_RETRY_DELAY_MS = Number.isFinite(Number(process.env.REVERSE_MATCH_BACKGROUND_RETRY_DELAY_MS))
    ? Math.max(500, Math.round(Number(process.env.REVERSE_MATCH_BACKGROUND_RETRY_DELAY_MS)))
    : 5000;
const scheduleReverseMatchProcessing = (params) => {
    const attempt = Number.isFinite(Number(params.attempt)) ? Math.max(0, Number(params.attempt)) : 0;
    setImmediate(() => {
        void (0, reverseJobMatchService_1.processReverseJobMatchesForIngestedPayload)({
            db: params.db,
            rawJobs: params.rawJobs,
            nowIso: params.nowIso,
        }).catch((error) => {
            if (attempt < REVERSE_MATCH_BACKGROUND_RETRY_LIMIT) {
                setTimeout(() => {
                    scheduleReverseMatchProcessing(Object.assign(Object.assign({}, params), { attempt: attempt + 1 }));
                }, REVERSE_MATCH_BACKGROUND_RETRY_DELAY_MS);
            }
            console.error('Reverse match background processing error:', {
                attempt,
                retryLimit: REVERSE_MATCH_BACKGROUND_RETRY_LIMIT,
                telemetry: params.telemetry,
                error,
            });
        });
    });
};
exports.internalJobsController = {
    // POST /api/internal/jobs/aggregated
    ingestAggregatedJobs: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            if (!(0, db_1.isDBConnected)()) {
                return res.status(503).json({ success: false, error: 'Database service unavailable' });
            }
            const jobs = (_a = req.body) === null || _a === void 0 ? void 0 : _a.jobs;
            if (!Array.isArray(jobs)) {
                return res.status(400).json({
                    success: false,
                    error: 'jobs array is required',
                });
            }
            if (jobs.length > internalJobIngestionService_1.MAX_INTERNAL_AGGREGATED_INGEST_ITEMS) {
                return res.status(413).json({
                    success: false,
                    error: `A maximum of ${internalJobIngestionService_1.MAX_INTERNAL_AGGREGATED_INGEST_ITEMS} jobs can be ingested per request`,
                });
            }
            if (jobs.length === 0) {
                return res.json({
                    success: true,
                    data: {
                        received: 0,
                        inserted: 0,
                        updated: 0,
                        skipped: 0,
                        skippedReasons: {},
                    },
                });
            }
            const db = (0, db_1.getDB)();
            const nowIso = new Date().toISOString();
            const stats = yield (0, internalJobIngestionService_1.ingestAggregatedJobsBatch)(db, jobs, nowIso);
            scheduleReverseMatchProcessing({
                db,
                rawJobs: jobs,
                nowIso,
                telemetry: {
                    correlationId: typeof req.headers['x-request-id'] === 'string'
                        ? req.headers['x-request-id']
                        : undefined,
                    received: jobs.length,
                    inserted: stats.inserted,
                    updated: stats.updated,
                    skipped: stats.skipped,
                },
            });
            return res.json({
                success: true,
                data: {
                    received: jobs.length,
                    inserted: stats.inserted,
                    updated: stats.updated,
                    skipped: stats.skipped,
                    skippedReasons: stats.skippedReasons,
                    errors: stats.errorSamples,
                },
            });
        }
        catch (error) {
            console.error('Internal aggregated jobs ingest error:', error);
            return res.status(500).json({ success: false, error: 'Failed to ingest aggregated jobs' });
        }
    }),
};
