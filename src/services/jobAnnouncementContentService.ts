import { readString } from '../utils/inputSanitizers';

const toAnnouncementTag = (tag: string) => tag.replace(/[^a-z0-9]/gi, '').toLowerCase();

const normalizeAnnouncementText = (value: unknown, maxLength: number, fallback = ''): string =>
  readString(value, maxLength) || fallback;

const normalizeAnnouncementEnumText = (value: unknown, maxLength: number, fallback: string): string => {
  const normalized = normalizeAnnouncementText(value, maxLength)
    .replace(/_/g, ' ')
    .trim();
  return normalized || fallback;
};

export const buildJobAnnouncementContent = (job: {
  title: unknown;
  companyName: unknown;
  locationText: unknown;
  workModel: unknown;
  employmentType: unknown;
  summary: unknown;
  tags: unknown;
}) => {
  const title = normalizeAnnouncementText(job.title, 160, 'New role');
  const companyName = normalizeAnnouncementText(job.companyName, 160, 'Company');
  const locationText = normalizeAnnouncementText(job.locationText, 160, 'Flexible location');
  const workModel = normalizeAnnouncementEnumText(job.workModel, 60, 'flexible');
  const employmentType = normalizeAnnouncementEnumText(job.employmentType, 60, 'role');
  const summary = normalizeAnnouncementText(job.summary, 6000);
  const normalizedTags = Array.from(
    new Set(
      (Array.isArray(job.tags) ? job.tags : [])
        .map(toAnnouncementTag)
        .filter((value) => value.length > 0),
    ),
  ).slice(0, 5);

  const hashtagList = Array.from(new Set(['hiring', 'jobs', ...normalizedTags]))
    .map((tag) => `#${tag}`)
    .join(' ');

  return [
    `We're hiring: ${title}`,
    '',
    `${companyName} is opening a new role.`,
    `Location: ${locationText} • ${workModel} • ${employmentType}`,
    '',
    summary,
    '',
    'Apply directly from our Jobs tab on Aura.',
    hashtagList,
  ].join('\n');
};
