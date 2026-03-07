import { readString } from '../utils/inputSanitizers';

export const JOB_ALERT_CATEGORIES = [
  'all',
  'engineering',
  'design',
  'marketing',
  'data',
  'product',
  'operations',
  'sales',
] as const;

export type JobAlertCategory = (typeof JOB_ALERT_CATEGORIES)[number];

const CATEGORY_HINTS: Array<{ category: Exclude<JobAlertCategory, 'all'>; tokens: string[] }> = [
  { category: 'engineering', tokens: ['developer', 'engineer', 'frontend', 'backend', 'devops', 'qa', 'platform', 'infrastructure', 'software', 'react', 'node', 'java', 'python', 'golang'] },
  { category: 'design', tokens: ['design', 'designer', 'ux', 'ui', 'visual', 'brand', 'figma', 'product-design', 'motion', 'creative'] },
  { category: 'marketing', tokens: ['marketing', 'growth', 'paid media', 'seo', 'content', 'social', 'brand', 'demand gen', 'ads', 'performance'] },
  { category: 'data', tokens: ['data', 'analyst', 'analytics', 'scientist', 'machine learning', 'bi', 'sql', 'ai', 'insights'] },
  { category: 'product', tokens: ['product manager', 'product owner', 'roadmap', 'strategy', 'pm', 'product-marketing'] },
  { category: 'operations', tokens: ['operations', 'customer success', 'support', 'hr', 'finance', 'admin', 'people', 'workforce'] },
  { category: 'sales', tokens: ['sales', 'account executive', 'business development', 'revenue', 'partnerships', 'sdr', 'bdr'] },
];

const ROLE_FAMILY_CATEGORY_HINTS: Array<{ category: Exclude<JobAlertCategory, 'all'>; tokens: string[] }> = [
  { category: 'engineering', tokens: ['software', 'frontend', 'backend', 'full-stack', 'fullstack', 'engineering', 'devops', 'platform', 'qa', 'security'] },
  { category: 'design', tokens: ['design', 'ux', 'ui', 'brand', 'creative'] },
  { category: 'marketing', tokens: ['marketing', 'seo', 'growth', 'content', 'paid-media', 'performance'] },
  { category: 'data', tokens: ['data', 'analytics', 'machine-learning', 'ai', 'bi'] },
  { category: 'product', tokens: ['product', 'product-management', 'product-design'] },
  { category: 'operations', tokens: ['customer-success', 'operations', 'support', 'finance', 'people', 'workforce'] },
  { category: 'sales', tokens: ['sales', 'revenue', 'partnerships', 'account-executive', 'business-development'] },
];

const normalizeCategoryValue = (value: unknown): string =>
  readString(String(value || ''), 80)
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-');

const readJobAlertComparableString = (value: unknown, maxLength: number): string => (
  typeof value === 'string'
    ? readString(value, maxLength)
    : ''
)
  .trim()
  .toLowerCase();

export const normalizeJobAlertCategory = (value: unknown): JobAlertCategory => {
  const normalized = normalizeCategoryValue(value);
  if (!normalized) return 'all';
  if (normalized === 'all') return 'all';
  const matched = CATEGORY_HINTS.find((entry) => entry.category === normalized);
  return matched?.category || 'all';
};

const readStoredJobAlertCategory = (value: unknown): JobAlertCategory | null => {
  const normalized = normalizeCategoryValue(value);
  if (!normalized) return null;
  const matched = JOB_ALERT_CATEGORIES.find((category) => category === normalized);
  return matched || null;
};

const resolveDemandRoleCategory = (value: unknown): JobAlertCategory | null => {
  const roleFamily = readJobAlertComparableString(value, 120);
  if (!roleFamily) return null;
  const matched = ROLE_FAMILY_CATEGORY_HINTS.find((entry) =>
    entry.tokens.some((token) => token.length > 0 && roleFamily.includes(token)));
  return matched?.category || null;
};

type JobAlertCategoryResolvable = {
  jobAlertCategory?: unknown;
  demandRoleFamily?: unknown;
  roleFamily?: unknown;
  title?: unknown;
  summary?: unknown;
  tags?: unknown;
};

export const resolveJobAlertCategory = (job: JobAlertCategoryResolvable): JobAlertCategory => {
  const storedCategory = readStoredJobAlertCategory(job?.jobAlertCategory);
  if (storedCategory) return storedCategory;

  const roleFamilyCategory = resolveDemandRoleCategory(job?.demandRoleFamily || job?.roleFamily);
  if (roleFamilyCategory) return roleFamilyCategory;

  const haystack = [
    readString(job?.title, 240),
    readString(job?.summary, 800),
    ...(Array.isArray(job?.tags) ? job.tags.map((tag) => readString(tag, 80)) : []),
  ]
    .join(' ')
    .toLowerCase();

  if (!haystack) return 'all';

  for (const category of CATEGORY_HINTS) {
    const matched = category.tokens.some((token) => token.length > 0 && haystack.includes(token));
    if (matched) return category.category;
  }

  return 'all';
};

export const resolveStoredJobAlertCategory = (job: JobAlertCategoryResolvable): JobAlertCategory =>
  readStoredJobAlertCategory(job?.jobAlertCategory)
  || resolveDemandRoleCategory(job?.demandRoleFamily || job?.roleFamily)
  || 'all';

export const buildJobAlertCategoryFields = (job: JobAlertCategoryResolvable): { jobAlertCategory: JobAlertCategory } => ({
  jobAlertCategory: resolveJobAlertCategory(job),
});
