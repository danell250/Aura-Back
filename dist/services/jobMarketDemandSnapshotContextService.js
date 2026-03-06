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
exports.loadJobMarketDemandSnapshotSeedContexts = exports.invalidateJobMarketDemandSeedContextCache = void 0;
const jobMarketDemandSeedContextRegistryService_1 = require("./jobMarketDemandSeedContextRegistryService");
const jobMarketDemandStorageService_1 = require("./jobMarketDemandStorageService");
const JOB_MARKET_DEMAND_SNAPSHOT_SEED_CONTEXT_LIMIT = 120;
const JOB_MARKET_DEMAND_SEED_CONTEXT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ALLOWED_WORK_MODELS = new Set(['onsite', 'hybrid', 'remote']);
let snapshotSeedContextCache = null;
const buildSnapshotContextKey = (context) => {
    const normalized = (0, jobMarketDemandStorageService_1.buildJobMarketDemandSnapshotContext)({
        location: context.location,
        workModel: context.workModel,
    });
    return `${normalized.locationKey}::${normalized.workModelKey}`;
};
const queueSnapshotContext = (contexts, context) => {
    const key = buildSnapshotContextKey(context);
    if (!contexts.has(key)) {
        contexts.set(key, context);
    }
};
const readCachedSnapshotSeedContexts = () => {
    if (!snapshotSeedContextCache)
        return null;
    if (snapshotSeedContextCache.expiresAt <= Date.now()) {
        snapshotSeedContextCache = null;
        return null;
    }
    return snapshotSeedContextCache.contexts;
};
const storeSnapshotSeedContexts = (contexts) => {
    snapshotSeedContextCache = {
        contexts,
        expiresAt: Date.now() + JOB_MARKET_DEMAND_SEED_CONTEXT_CACHE_TTL_MS,
    };
};
const invalidateJobMarketDemandSeedContextCache = () => {
    snapshotSeedContextCache = null;
};
exports.invalidateJobMarketDemandSeedContextCache = invalidateJobMarketDemandSeedContextCache;
const loadJobMarketDemandSnapshotSeedContexts = (db) => __awaiter(void 0, void 0, void 0, function* () {
    const cached = readCachedSnapshotSeedContexts();
    if (cached)
        return cached;
    const contexts = new Map();
    queueSnapshotContext(contexts, {});
    ALLOWED_WORK_MODELS.forEach((workModel) => {
        queueSnapshotContext(contexts, { workModel });
    });
    const registeredContexts = yield (0, jobMarketDemandSeedContextRegistryService_1.listJobMarketDemandSeedContexts)({
        db,
        limit: JOB_MARKET_DEMAND_SNAPSHOT_SEED_CONTEXT_LIMIT,
    });
    registeredContexts.forEach((context) => {
        if (context.location) {
            queueSnapshotContext(contexts, { location: context.location });
            if (context.workModel) {
                queueSnapshotContext(contexts, {
                    location: context.location,
                    workModel: context.workModel,
                });
            }
        }
    });
    const nextContexts = Array.from(contexts.values());
    storeSnapshotSeedContexts(nextContexts);
    return nextContexts;
});
exports.loadJobMarketDemandSnapshotSeedContexts = loadJobMarketDemandSnapshotSeedContexts;
