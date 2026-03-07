"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildJobAlertCategoryFields = exports.resolveStoredJobAlertCategory = exports.resolveJobAlertCategory = exports.normalizeJobAlertCategory = exports.JOB_ALERT_CATEGORIES = void 0;
const inputSanitizers_1 = require("../utils/inputSanitizers");
exports.JOB_ALERT_CATEGORIES = [
    'all',
    'engineering',
    'design',
    'marketing',
    'data',
    'product',
    'operations',
    'sales',
];
const CATEGORY_HINTS = [
    { category: 'engineering', tokens: ['developer', 'engineer', 'frontend', 'backend', 'devops', 'qa', 'platform', 'infrastructure', 'software', 'react', 'node', 'java', 'python', 'golang'] },
    { category: 'design', tokens: ['design', 'designer', 'ux', 'ui', 'visual', 'brand', 'figma', 'product-design', 'motion', 'creative'] },
    { category: 'marketing', tokens: ['marketing', 'growth', 'paid media', 'seo', 'content', 'social', 'brand', 'demand gen', 'ads', 'performance'] },
    { category: 'data', tokens: ['data', 'analyst', 'analytics', 'scientist', 'machine learning', 'bi', 'sql', 'ai', 'insights'] },
    { category: 'product', tokens: ['product manager', 'product owner', 'roadmap', 'strategy', 'pm', 'product-marketing'] },
    { category: 'operations', tokens: ['operations', 'customer success', 'support', 'hr', 'finance', 'admin', 'people', 'workforce'] },
    { category: 'sales', tokens: ['sales', 'account executive', 'business development', 'revenue', 'partnerships', 'sdr', 'bdr'] },
];
const ROLE_FAMILY_CATEGORY_HINTS = [
    { category: 'engineering', tokens: ['software', 'frontend', 'backend', 'full-stack', 'fullstack', 'engineering', 'devops', 'platform', 'qa', 'security'] },
    { category: 'design', tokens: ['design', 'ux', 'ui', 'brand', 'creative'] },
    { category: 'marketing', tokens: ['marketing', 'seo', 'growth', 'content', 'paid-media', 'performance'] },
    { category: 'data', tokens: ['data', 'analytics', 'machine-learning', 'ai', 'bi'] },
    { category: 'product', tokens: ['product', 'product-management', 'product-design'] },
    { category: 'operations', tokens: ['customer-success', 'operations', 'support', 'finance', 'people', 'workforce'] },
    { category: 'sales', tokens: ['sales', 'revenue', 'partnerships', 'account-executive', 'business-development'] },
];
const normalizeCategoryValue = (value) => (0, inputSanitizers_1.readString)(String(value || ''), 80)
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-');
const readJobAlertComparableString = (value, maxLength) => (typeof value === 'string'
    ? (0, inputSanitizers_1.readString)(value, maxLength)
    : '')
    .trim()
    .toLowerCase();
const normalizeJobAlertCategory = (value) => {
    const normalized = normalizeCategoryValue(value);
    if (!normalized)
        return 'all';
    if (normalized === 'all')
        return 'all';
    const matched = CATEGORY_HINTS.find((entry) => entry.category === normalized);
    return (matched === null || matched === void 0 ? void 0 : matched.category) || 'all';
};
exports.normalizeJobAlertCategory = normalizeJobAlertCategory;
const readStoredJobAlertCategory = (value) => {
    const normalized = normalizeCategoryValue(value);
    if (!normalized)
        return null;
    const matched = exports.JOB_ALERT_CATEGORIES.find((category) => category === normalized);
    return matched || null;
};
const resolveDemandRoleCategory = (value) => {
    const roleFamily = readJobAlertComparableString(value, 120);
    if (!roleFamily)
        return null;
    const matched = ROLE_FAMILY_CATEGORY_HINTS.find((entry) => entry.tokens.some((token) => token.length > 0 && roleFamily.includes(token)));
    return (matched === null || matched === void 0 ? void 0 : matched.category) || null;
};
const resolveJobAlertCategory = (job) => {
    const storedCategory = readStoredJobAlertCategory(job === null || job === void 0 ? void 0 : job.jobAlertCategory);
    if (storedCategory)
        return storedCategory;
    const roleFamilyCategory = resolveDemandRoleCategory((job === null || job === void 0 ? void 0 : job.demandRoleFamily) || (job === null || job === void 0 ? void 0 : job.roleFamily));
    if (roleFamilyCategory)
        return roleFamilyCategory;
    const haystack = [
        (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.title, 240),
        (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.summary, 800),
        (0, inputSanitizers_1.readString)(job === null || job === void 0 ? void 0 : job.description, 2000),
        ...(Array.isArray(job === null || job === void 0 ? void 0 : job.tags) ? job.tags.map((tag) => (0, inputSanitizers_1.readString)(tag, 80)) : []),
    ]
        .join(' ')
        .toLowerCase();
    if (!haystack)
        return 'all';
    for (const category of CATEGORY_HINTS) {
        const matched = category.tokens.some((token) => token.length > 0 && haystack.includes(token));
        if (matched)
            return category.category;
    }
    return 'all';
};
exports.resolveJobAlertCategory = resolveJobAlertCategory;
const resolveStoredJobAlertCategory = (job) => readStoredJobAlertCategory(job === null || job === void 0 ? void 0 : job.jobAlertCategory)
    || resolveDemandRoleCategory((job === null || job === void 0 ? void 0 : job.demandRoleFamily) || (job === null || job === void 0 ? void 0 : job.roleFamily))
    || 'all';
exports.resolveStoredJobAlertCategory = resolveStoredJobAlertCategory;
const buildJobAlertCategoryFields = (job) => ({
    jobAlertCategory: (0, exports.resolveJobAlertCategory)(job),
});
exports.buildJobAlertCategoryFields = buildJobAlertCategoryFields;
