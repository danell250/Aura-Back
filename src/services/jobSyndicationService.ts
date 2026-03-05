const readString = (value: unknown, maxLength = 10000): string => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  return normalized.slice(0, maxLength);
};

const getFrontendBaseUrl = (): string => {
  const configured =
    readString(process.env.FRONTEND_URL || '', 300) ||
    readString(process.env.VITE_FRONTEND_URL || '', 300);
  return configured ? configured.replace(/\/$/, '') : 'https://www.aurasocial.world';
};

const getBackendBaseUrl = (): string => {
  const configured =
    readString(process.env.BACKEND_URL || '', 300) ||
    readString(process.env.PUBLIC_BACKEND_URL || '', 300);
  return configured ? configured.replace(/\/$/, '') : 'https://api.aurasocial.world';
};

const toCompactText = (value: unknown, maxLength = 16000): string =>
  readString(String(value || ''), maxLength).replace(/\s+/g, ' ').trim();

const toSyndicationItem = (job: any) => {
  const frontendBaseUrl = getFrontendBaseUrl();
  const slug = readString(job?.slug, 220) || readString(job?.id, 220) || 'job';
  const jobUrl = `${frontendBaseUrl}/jobs/${encodeURIComponent(slug)}`;
  const publishedAt = readString(String(job?.publishedAt || job?.createdAt || ''), 80) || null;
  const updatedAt = readString(String(job?.updatedAt || job?.createdAt || ''), 80) || null;
  const companyHandle = readString(job?.companyHandle, 120).replace(/^@/, '');
  const companyUrl = companyHandle
    ? `${frontendBaseUrl}/company/${encodeURIComponent(companyHandle)}`
    : undefined;
  const applicationUrl = readString(job?.applicationUrl, 600);
  const applicationEmail = readString(job?.applicationEmail, 200);
  const externalUrl = applicationUrl || (applicationEmail ? `mailto:${applicationEmail}` : undefined);

  return {
    id: readString(job?.id, 120),
    url: jobUrl,
    ...(externalUrl ? { external_url: externalUrl } : {}),
    title: readString(job?.title, 200),
    content_text: toCompactText(job?.description || job?.summary || ''),
    summary: toCompactText(job?.summary || '', 500),
    date_published: publishedAt,
    date_modified: updatedAt,
    tags: Array.isArray(job?.tags) ? job.tags : [],
    authors: [
      {
        name: readString(job?.companyName, 200) || 'Company',
        ...(companyUrl ? { url: companyUrl } : {}),
      },
    ],
    _aura: {
      jobId: readString(job?.id, 120),
      slug,
      companyId: readString(job?.companyId, 120),
      companyHandle: readString(job?.companyHandle, 120),
      companyIsVerified: Boolean(job?.companyIsVerified),
      locationText: readString(job?.locationText, 200),
      workModel: readString(job?.workModel, 40),
      employmentType: readString(job?.employmentType, 40),
      salaryMin: typeof job?.salaryMin === 'number' ? job.salaryMin : null,
      salaryMax: typeof job?.salaryMax === 'number' ? job.salaryMax : null,
      salaryCurrency: readString(job?.salaryCurrency, 12),
      applicationUrl: applicationUrl || null,
      applicationEmail: applicationEmail || null,
    },
  };
};

export const buildJobsSyndicationFeed = (jobs: any[]) => ({
  version: 'https://jsonfeed.org/version/1.1',
  title: 'Aura Jobs Feed',
  home_page_url: `${getFrontendBaseUrl()}/jobs`,
  feed_url: `${getBackendBaseUrl()}/api/partner/jobs`,
  description: 'Latest jobs published on Aura.',
  language: 'en',
  generated_at: new Date().toISOString(),
  items: jobs.map(toSyndicationItem),
});
