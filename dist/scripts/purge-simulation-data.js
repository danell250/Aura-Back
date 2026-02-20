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
const db_1 = require("../db");
const DEFAULT_SOURCES = ['demo-data', 'large-data', 'enterprise-simulation'];
const PRIMARY_COLLECTIONS = [
    'users',
    'companies',
    'company_members',
    'posts',
    'comments',
    'ads',
    'adAnalytics',
    'adAnalyticsDaily'
];
const CLEANUP_CONCURRENCY = 4;
const sanitizeSource = (value) => value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
const uniqueStrings = (values) => Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
const buildPrefixedValues = (prefixes, suffixes) => prefixes.flatMap((prefix) => suffixes.map((suffix) => `${prefix}-${suffix}`));
const parseListFlagValues = (args, flag) => {
    const values = [];
    args.forEach((arg, index) => {
        if (arg === flag) {
            const next = args[index + 1];
            if (next && !next.startsWith('--')) {
                values.push(next);
            }
            return;
        }
        if (arg.startsWith(`${flag}=`)) {
            values.push(arg.slice(flag.length + 1));
        }
    });
    return values
        .flatMap((value) => value.split(','))
        .map((value) => sanitizeSource(value))
        .filter((value) => value.length > 0);
};
const parseStringFlagValue = (args, flag) => {
    const directIndex = args.findIndex((arg) => arg === flag);
    if (directIndex !== -1) {
        const next = args[directIndex + 1];
        return next && !next.startsWith('--') ? next : undefined;
    }
    const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
    if (!prefixed)
        return undefined;
    return prefixed.slice(flag.length + 1);
};
const parseCliOptions = () => {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const includeSimulationFixtures = !args.includes('--no-simulation-fixtures');
    const sourceValues = parseListFlagValues(args, '--source');
    const sources = uniqueStrings(sourceValues.length > 0 ? sourceValues : DEFAULT_SOURCES);
    const legacyPrefixInput = parseStringFlagValue(args, '--legacy-prefix');
    const legacyPrefix = legacyPrefixInput ? sanitizeSource(legacyPrefixInput) : undefined;
    return {
        apply,
        includeSimulationFixtures,
        legacyPrefix: legacyPrefix && legacyPrefix.length > 0 ? legacyPrefix : undefined,
        sources
    };
};
const resolveLegacyBatchConfigs = (batchCollections, sources) => batchCollections
    .filter((name) => name.endsWith('_batches') && name !== 'data_batches')
    .map((name) => name.replace(/_batches$/, ''))
    .filter((prefix) => prefix.length > 0 && /^[a-z0-9_]+$/.test(prefix))
    .map((prefix) => ({
    batchCollection: `${prefix}_batches`,
    sourceKey: `${prefix}Source`,
    sourceValues: uniqueStrings(sources.flatMap((source) => [source, `${prefix}-${source}`]))
}));
const ensureCleanupIndexes = (db, legacyConfigs, batchCollections) => __awaiter(void 0, void 0, void 0, function* () {
    const indexPlans = [
        { collection: 'users', indexSpecs: [{ dataSource: 1 }, { id: 1 }] },
        { collection: 'companies', indexSpecs: [{ dataSource: 1 }, { id: 1 }] },
        { collection: 'company_members', indexSpecs: [{ dataSource: 1 }, { companyId: 1 }, { userId: 1 }] },
        { collection: 'posts', indexSpecs: [{ dataSource: 1 }, { id: 1 }, { 'author.id': 1 }, { authorId: 1 }, { ownerId: 1 }] },
        { collection: 'comments', indexSpecs: [{ dataSource: 1 }, { authorId: 1 }] },
        { collection: 'ads', indexSpecs: [{ dataSource: 1 }, { id: 1 }, { ownerId: 1 }] },
        { collection: 'adAnalytics', indexSpecs: [{ dataSource: 1 }, { adId: 1 }, { ownerId: 1 }] },
        { collection: 'adAnalyticsDaily', indexSpecs: [{ dataSource: 1 }, { adId: 1 }, { ownerId: 1 }] },
        { collection: 'data_batches', indexSpecs: [{ dataSource: 1 }, { batchId: 1 }] }
    ];
    const legacyPlans = legacyConfigs.map((config) => ({
        collection: config.batchCollection,
        indexSpecs: [{ [config.sourceKey]: 1 }]
    }));
    const existingCollections = new Set([
        ...PRIMARY_COLLECTIONS,
        ...batchCollections,
        'data_batches'
    ]);
    const plans = [...indexPlans, ...legacyPlans]
        .filter((plan) => existingCollections.has(plan.collection));
    yield Promise.all(plans.flatMap((plan) => plan.indexSpecs.map((indexSpec) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            yield db.collection(plan.collection).createIndex(indexSpec, { background: true });
        }
        catch (error) {
            console.warn(`⚠️  Skipped index for ${plan.collection}:`, error);
        }
    }))));
});
const buildSimulationFixtureRules = (prefixes) => {
    const postIds = buildPrefixedValues(prefixes, [
        'news-1',
        'news-2',
        'founder-1',
        'founder-2',
        'leadership-1',
        'leadership-2',
        'ad-business-1',
        'ad-business-2'
    ]);
    const adIds = buildPrefixedValues(prefixes, [
        'ad-b2b-podcast',
        'ad-saas-demos',
        'ad-founder-coaching'
    ]);
    const postAuthorIds = buildPrefixedValues(prefixes, [
        'editorial',
        'founder',
        'leadership',
        'agency'
    ]);
    const businessPrefixes = prefixes.map((prefix) => `business-${prefix}`);
    const adOwnerIds = buildPrefixedValues(businessPrefixes, ['1', '2', '3']);
    return [
        { collection: 'posts', label: 'simulation fixture posts by id', query: { id: { $in: postIds } } },
        { collection: 'posts', label: 'simulation fixture posts by author.id', query: { 'author.id': { $in: postAuthorIds } } },
        { collection: 'posts', label: 'simulation fixture posts by authorId', query: { authorId: { $in: postAuthorIds } } },
        { collection: 'posts', label: 'simulation fixture posts by ownerId', query: { ownerId: { $in: postAuthorIds } } },
        { collection: 'ads', label: 'simulation fixture ads by id', query: { id: { $in: adIds } } },
        { collection: 'ads', label: 'simulation fixture ads by ownerId', query: { ownerId: { $in: adOwnerIds } } },
        { collection: 'adAnalytics', label: 'simulation fixture ad analytics by adId', query: { adId: { $in: adIds } } },
        { collection: 'adAnalytics', label: 'simulation fixture ad analytics by ownerId', query: { ownerId: { $in: adOwnerIds } } },
        { collection: 'adAnalyticsDaily', label: 'simulation fixture daily analytics by adId', query: { adId: { $in: adIds } } },
        { collection: 'adAnalyticsDaily', label: 'simulation fixture daily analytics by ownerId', query: { ownerId: { $in: adOwnerIds } } }
    ];
};
const buildCleanupRules = (sources, includeSimulationFixtures, legacyPrefix, legacyConfigs, batchCollections) => {
    const rules = [];
    PRIMARY_COLLECTIONS.forEach((collection) => {
        rules.push({
            collection,
            label: 'tagged by dataSource',
            query: { dataSource: { $in: sources } }
        });
    });
    batchCollections.forEach((collection) => {
        rules.push({
            collection,
            label: 'batch tagged by dataSource',
            query: { dataSource: { $in: sources } }
        });
    });
    legacyConfigs.forEach((config) => {
        PRIMARY_COLLECTIONS.forEach((collection) => {
            rules.push({
                collection,
                label: `legacy source key ${config.sourceKey}`,
                query: { [config.sourceKey]: { $in: config.sourceValues } }
            });
        });
        rules.push({
            collection: config.batchCollection,
            label: `legacy batch source key ${config.sourceKey}`,
            query: { [config.sourceKey]: { $in: config.sourceValues } }
        });
    });
    if (includeSimulationFixtures) {
        const fixturePrefixes = uniqueStrings([
            'demo',
            ...(legacyPrefix ? [legacyPrefix] : [])
        ]);
        rules.push(...buildSimulationFixtureRules(fixturePrefixes));
    }
    return rules;
};
const runRule = (db, rule, apply) => __awaiter(void 0, void 0, void 0, function* () {
    const collection = db.collection(rule.collection);
    if (apply) {
        const result = yield collection.deleteMany(rule.query);
        return {
            collection: rule.collection,
            label: rule.label,
            affected: result.deletedCount || 0
        };
    }
    const matched = yield collection.countDocuments(rule.query);
    return {
        collection: rule.collection,
        label: rule.label,
        affected: matched
    };
});
const runRulesWithConcurrency = (db, rules, apply, concurrencyLimit) => __awaiter(void 0, void 0, void 0, function* () {
    if (rules.length === 0)
        return [];
    const safeConcurrency = Math.max(1, Math.min(concurrencyLimit, rules.length));
    const chunks = Array.from({ length: safeConcurrency }, () => []);
    rules.forEach((rule, index) => {
        chunks[index % safeConcurrency].push({ index, rule });
    });
    const chunkResults = yield Promise.all(chunks.map((chunk) => __awaiter(void 0, void 0, void 0, function* () {
        const partial = [];
        for (const item of chunk) {
            partial.push({
                index: item.index,
                result: yield runRule(db, item.rule, apply)
            });
        }
        return partial;
    })));
    const orderedResults = new Array(rules.length);
    chunkResults.flat().forEach((entry) => {
        orderedResults[entry.index] = entry.result;
    });
    return orderedResults.filter((entry) => Boolean(entry));
});
const runCleanup = (options) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, db_1.connectDB)();
    if (!(0, db_1.isDBConnected)()) {
        throw new Error('Database connection is unavailable.');
    }
    const db = (0, db_1.getDB)();
    const rawBatchCollections = (yield db.listCollections({}, { nameOnly: true }).toArray())
        .map((collection) => String(collection.name || ''))
        .filter((name) => name.endsWith('_batches'));
    const batchCollections = uniqueStrings(rawBatchCollections.includes('data_batches')
        ? rawBatchCollections
        : [...rawBatchCollections, 'data_batches']);
    const legacyConfigs = resolveLegacyBatchConfigs(batchCollections, options.sources);
    yield ensureCleanupIndexes(db, legacyConfigs, batchCollections);
    const rules = buildCleanupRules(options.sources, options.includeSimulationFixtures, options.legacyPrefix, legacyConfigs, batchCollections);
    const modeText = options.apply ? 'APPLY' : 'DRY RUN';
    console.log('');
    console.log(`=== Mongo Cleanup (${modeText}) ===`);
    const perCollectionTotal = new Map();
    const results = yield runRulesWithConcurrency(db, rules, options.apply, CLEANUP_CONCURRENCY);
    for (const result of results) {
        if (result.affected === 0)
            continue;
        const previous = perCollectionTotal.get(result.collection) || 0;
        perCollectionTotal.set(result.collection, previous + result.affected);
        console.log(`- ${result.collection}: ${result.label} -> ${result.affected}`);
    }
    const total = Array.from(perCollectionTotal.values()).reduce((sum, value) => sum + value, 0);
    if (options.apply) {
        console.log(`✅ Cleanup complete. Deleted ${total} documents.`);
    }
    else {
        console.log(`🔎 Dry run complete. Matched ${total} documents (rule-level totals).`);
        console.log('Run with `--apply` to execute deletions.');
    }
});
const main = () => __awaiter(void 0, void 0, void 0, function* () {
    const options = parseCliOptions();
    console.log(options.apply ? '🧹 Applying Mongo cleanup...' : '🔎 Previewing Mongo cleanup (dry run)...');
    console.log(`Dataset sources: ${options.sources.join(', ')}`);
    console.log(`Legacy prefix: ${options.legacyPrefix || '(none)'}`);
    console.log(`Include simulation fixture cleanup: ${options.includeSimulationFixtures ? 'yes' : 'no'}`);
    try {
        yield runCleanup(options);
    }
    finally {
        yield (0, db_1.closeDB)();
    }
});
if (require.main === module) {
    main().catch((error) => {
        console.error('❌ Mongo cleanup failed:', error);
        process.exitCode = 1;
    });
}
