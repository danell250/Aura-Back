import { Db } from 'mongodb';
import { closeDB, connectDB, getDB, isDBConnected } from '../db';

interface CliOptions {
  apply: boolean;
  includeSimulationFixtures: boolean;
  legacyPrefix?: string;
  sources: string[];
}

interface LegacyBatchConfig {
  batchCollection: string;
  sourceKey: string;
  sourceValues: string[];
}

interface CleanupRule {
  collection: string;
  label: string;
  query: Record<string, unknown>;
}

interface RuleResult {
  collection: string;
  label: string;
  affected: number;
}

interface CollectionIndexPlan {
  collection: string;
  indexSpecs: Array<Record<string, 1 | -1>>;
}

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

const sanitizeSource = (value: string): string => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9-_]/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 64);

const uniqueStrings = (values: string[]): string[] => Array.from(
  new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
);

const buildPrefixedValues = (prefixes: string[], suffixes: string[]): string[] => prefixes.flatMap((prefix) =>
  suffixes.map((suffix) => `${prefix}-${suffix}`)
);

const parseListFlagValues = (args: string[], flag: string): string[] => {
  const values: string[] = [];

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

const parseStringFlagValue = (args: string[], flag: string): string | undefined => {
  const directIndex = args.findIndex((arg) => arg === flag);
  if (directIndex !== -1) {
    const next = args[directIndex + 1];
    return next && !next.startsWith('--') ? next : undefined;
  }

  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  if (!prefixed) return undefined;
  return prefixed.slice(flag.length + 1);
};

const parseCliOptions = (): CliOptions => {
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

const resolveLegacyBatchConfigs = (batchCollections: string[], sources: string[]): LegacyBatchConfig[] => batchCollections
  .filter((name) => name.endsWith('_batches') && name !== 'data_batches')
  .map((name) => name.replace(/_batches$/, ''))
  .filter((prefix) => prefix.length > 0 && /^[a-z0-9_]+$/.test(prefix))
  .map((prefix) => ({
    batchCollection: `${prefix}_batches`,
    sourceKey: `${prefix}Source`,
    sourceValues: uniqueStrings(
      sources.flatMap((source) => [source, `${prefix}-${source}`])
    )
  }));

const ensureCleanupIndexes = async (
  db: Db,
  legacyConfigs: LegacyBatchConfig[],
  batchCollections: string[]
): Promise<void> => {
  const indexPlans: CollectionIndexPlan[] = [
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

  const legacyPlans: CollectionIndexPlan[] = legacyConfigs.map((config) => ({
    collection: config.batchCollection,
    indexSpecs: [{ [config.sourceKey]: 1 }]
  }));

  const existingCollections = new Set<string>([
    ...PRIMARY_COLLECTIONS,
    ...batchCollections,
    'data_batches'
  ]);
  const plans = [...indexPlans, ...legacyPlans]
    .filter((plan) => existingCollections.has(plan.collection));

  await Promise.all(plans.flatMap((plan) => plan.indexSpecs.map(async (indexSpec) => {
    try {
      await db.collection(plan.collection).createIndex(indexSpec, { background: true });
    } catch (error) {
      console.warn(`⚠️  Skipped index for ${plan.collection}:`, error);
    }
  })));
};

const buildSimulationFixtureRules = (prefixes: string[]): CleanupRule[] => {
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

const buildCleanupRules = (
  sources: string[],
  includeSimulationFixtures: boolean,
  legacyPrefix: string | undefined,
  legacyConfigs: LegacyBatchConfig[],
  batchCollections: string[]
): CleanupRule[] => {
  const rules: CleanupRule[] = [];

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

const runRule = async (db: Db, rule: CleanupRule, apply: boolean): Promise<RuleResult> => {
  const collection = db.collection(rule.collection);
  if (apply) {
    const result = await collection.deleteMany(rule.query);
    return {
      collection: rule.collection,
      label: rule.label,
      affected: result.deletedCount || 0
    };
  }

  const matched = await collection.countDocuments(rule.query);
  return {
    collection: rule.collection,
    label: rule.label,
    affected: matched
  };
};

const runRulesWithConcurrency = async (
  db: Db,
  rules: CleanupRule[],
  apply: boolean,
  concurrencyLimit: number
): Promise<RuleResult[]> => {
  if (rules.length === 0) return [];

  const safeConcurrency = Math.max(1, Math.min(concurrencyLimit, rules.length));
  const chunks: Array<Array<{ index: number; rule: CleanupRule }>> = Array.from(
    { length: safeConcurrency },
    () => []
  );

  rules.forEach((rule, index) => {
    chunks[index % safeConcurrency].push({ index, rule });
  });

  const chunkResults = await Promise.all(chunks.map(async (chunk) => {
    const partial: Array<{ index: number; result: RuleResult }> = [];
    for (const item of chunk) {
      partial.push({
        index: item.index,
        result: await runRule(db, item.rule, apply)
      });
    }
    return partial;
  }));

  const orderedResults: RuleResult[] = new Array(rules.length);
  chunkResults.flat().forEach((entry) => {
    orderedResults[entry.index] = entry.result;
  });

  return orderedResults.filter((entry): entry is RuleResult => Boolean(entry));
};

const runCleanup = async (options: CliOptions): Promise<void> => {
  await connectDB();
  if (!isDBConnected()) {
    throw new Error('Database connection is unavailable.');
  }
  const db = getDB();

  const rawBatchCollections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((collection) => String(collection.name || ''))
    .filter((name) => name.endsWith('_batches'));
  const batchCollections = uniqueStrings(
    rawBatchCollections.includes('data_batches')
      ? rawBatchCollections
      : [...rawBatchCollections, 'data_batches']
  );

  const legacyConfigs = resolveLegacyBatchConfigs(batchCollections, options.sources);
  await ensureCleanupIndexes(db, legacyConfigs, batchCollections);
  const rules = buildCleanupRules(
    options.sources,
    options.includeSimulationFixtures,
    options.legacyPrefix,
    legacyConfigs,
    batchCollections
  );

  const modeText = options.apply ? 'APPLY' : 'DRY RUN';
  console.log('');
  console.log(`=== Mongo Cleanup (${modeText}) ===`);

  const perCollectionTotal = new Map<string, number>();
  const results = await runRulesWithConcurrency(db, rules, options.apply, CLEANUP_CONCURRENCY);
  for (const result of results) {
    if (result.affected === 0) continue;

    const previous = perCollectionTotal.get(result.collection) || 0;
    perCollectionTotal.set(result.collection, previous + result.affected);
    console.log(`- ${result.collection}: ${result.label} -> ${result.affected}`);
  }

  const total = Array.from(perCollectionTotal.values()).reduce((sum, value) => sum + value, 0);
  if (options.apply) {
    console.log(`✅ Cleanup complete. Deleted ${total} documents.`);
  } else {
    console.log(`🔎 Dry run complete. Matched ${total} documents (rule-level totals).`);
    console.log('Run with `--apply` to execute deletions.');
  }
};

const main = async (): Promise<void> => {
  const options = parseCliOptions();
  console.log(options.apply ? '🧹 Applying Mongo cleanup...' : '🔎 Previewing Mongo cleanup (dry run)...');
  console.log(`Dataset sources: ${options.sources.join(', ')}`);
  console.log(`Legacy prefix: ${options.legacyPrefix || '(none)'}`);
  console.log(`Include simulation fixture cleanup: ${options.includeSimulationFixtures ? 'yes' : 'no'}`);

  try {
    await runCleanup(options);
  } finally {
    await closeDB();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Mongo cleanup failed:', error);
    process.exitCode = 1;
  });
}
