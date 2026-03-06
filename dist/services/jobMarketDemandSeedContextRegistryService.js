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
exports.listJobMarketDemandSeedContexts = exports.registerJobMarketDemandSeedContexts = exports.ensureJobMarketDemandSeedContextRegistryIndexes = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
const jobMarketDemandStorageService_1 = require("./jobMarketDemandStorageService");
const JOB_MARKET_DEMAND_SEED_CONTEXTS_COLLECTION = 'job_market_demand_seed_contexts';
let jobMarketDemandSeedContextIndexesPromise = null;
const buildRegistryEntries = (params) => {
    const status = (0, inputSanitizers_1.readString)(params.status, 40).toLowerCase();
    if (status && status !== 'open')
        return [];
    const location = (0, inputSanitizers_1.readString)(params.locationText, 160);
    const workModel = (0, inputSanitizers_1.readString)(params.workModel, 40).toLowerCase() || null;
    if (!location)
        return [];
    const contexts = [
        (0, jobMarketDemandStorageService_1.buildJobMarketDemandSnapshotContext)({ location }),
        (0, jobMarketDemandStorageService_1.buildJobMarketDemandSnapshotContext)({ location, workModel }),
    ];
    return Array.from(new Map(contexts
        .filter((context) => Boolean(context.location))
        .map((context) => [context.locationKey + '::' + context.workModelKey, {
            contextKey: `${context.locationKey}::${context.workModelKey}`,
            location: context.location || undefined,
            workModel: context.workModel,
        }])).values());
};
const ensureJobMarketDemandSeedContextRegistryIndexes = (db) => __awaiter(void 0, void 0, void 0, function* () {
    if (!jobMarketDemandSeedContextIndexesPromise) {
        jobMarketDemandSeedContextIndexesPromise = (() => __awaiter(void 0, void 0, void 0, function* () {
            yield db.collection(JOB_MARKET_DEMAND_SEED_CONTEXTS_COLLECTION).createIndex({ contextKey: 1 }, { unique: true, name: 'job_market_demand_seed_contexts_key_idx' });
        }))().catch((error) => {
            jobMarketDemandSeedContextIndexesPromise = null;
            throw error;
        });
    }
    return jobMarketDemandSeedContextIndexesPromise;
});
exports.ensureJobMarketDemandSeedContextRegistryIndexes = ensureJobMarketDemandSeedContextRegistryIndexes;
const registerJobMarketDemandSeedContexts = (params) => __awaiter(void 0, void 0, void 0, function* () {
    if (params.jobs.length === 0)
        return;
    yield (0, exports.ensureJobMarketDemandSeedContextRegistryIndexes)(params.db);
    const entries = params.jobs.flatMap((job) => buildRegistryEntries(job));
    if (entries.length === 0)
        return;
    const nowIso = new Date().toISOString();
    const operations = entries.map((entry) => ({
        updateOne: {
            filter: { contextKey: entry.contextKey },
            update: {
                $setOnInsert: {
                    createdAt: nowIso,
                },
                $set: {
                    contextKey: entry.contextKey,
                    location: entry.location || null,
                    workModel: entry.workModel || null,
                    refreshedAt: nowIso,
                },
            },
            upsert: true,
        },
    }));
    yield params.db.collection(JOB_MARKET_DEMAND_SEED_CONTEXTS_COLLECTION).bulkWrite(operations, { ordered: false });
});
exports.registerJobMarketDemandSeedContexts = registerJobMarketDemandSeedContexts;
const listJobMarketDemandSeedContexts = (params) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, exports.ensureJobMarketDemandSeedContextRegistryIndexes)(params.db);
    const docs = yield params.db.collection(JOB_MARKET_DEMAND_SEED_CONTEXTS_COLLECTION)
        .find({}, { projection: { location: 1, workModel: 1 } })
        .sort({ refreshedAt: -1, createdAt: -1 })
        .limit(params.limit)
        .toArray();
    return docs.map((doc) => ({
        location: (0, inputSanitizers_1.readString)(doc === null || doc === void 0 ? void 0 : doc.location, 160) || undefined,
        workModel: (0, inputSanitizers_1.readString)(doc === null || doc === void 0 ? void 0 : doc.workModel, 40).toLowerCase() || null,
    }));
});
exports.listJobMarketDemandSeedContexts = listJobMarketDemandSeedContexts;
