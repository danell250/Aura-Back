import crypto from 'crypto';
import { sendJobApplicationReviewEmail } from './emailService';

const COMPANIES_COLLECTION = 'companies';
const COMPANY_MEMBERS_COLLECTION = 'company_members';
const USERS_COLLECTION = 'users';
const JOB_APPLICATION_REVIEW_LINKS_COLLECTION = 'job_application_review_links';

type JobReviewRecipient = {
  userId: string;
  email: string;
  displayName: string;
};

type JobApplicationReviewLinkRecord = {
  id: string;
  tokenHash: string;
  companyId: string;
  jobId: string;
  applicationId: string;
  recipientUserId: string;
  recipientEmail: string;
  createdAt: string;
  expiresAt: string;
  lastResolvedAt: string | null;
  lastResolvedByUserId: string | null;
};

const readString = (value: unknown, maxLength = 10000): string => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  return normalized.slice(0, maxLength);
};

const hashSecureToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

const getReviewLinkTtlHours = (): number => {
  const raw = Number(process.env.JOB_REVIEW_LINK_TTL_HOURS || 72);
  if (!Number.isFinite(raw)) return 72;
  return Math.min(168, Math.max(1, Math.round(raw)));
};

const getReviewPortalBaseUrl = (): string => {
  const configured =
    readString(process.env.FRONTEND_URL || '', 300) ||
    readString(process.env.VITE_FRONTEND_URL || '', 300);
  return configured ? configured.replace(/\/$/, '') : 'https://www.aurasocial.world';
};

const buildReviewPortalUrl = (rawToken: string): string => {
  const baseUrl = getReviewPortalBaseUrl();
  return `${baseUrl}/company/manage?applicationReviewToken=${encodeURIComponent(rawToken)}`;
};

const resolveJobReviewRecipients = async (
  db: any,
  companyId: string,
): Promise<{ company: any | null; recipients: JobReviewRecipient[] }> => {
  if (!companyId) return { company: null, recipients: [] };

  const [company, memberRows] = await Promise.all([
    db.collection(COMPANIES_COLLECTION).findOne(
      { id: companyId, legacyArchived: { $ne: true } },
      { projection: { id: 1, name: 1, ownerId: 1 } },
    ),
    db.collection(COMPANY_MEMBERS_COLLECTION)
      .find(
        { companyId, role: { $in: ['owner', 'admin'] } },
        { projection: { userId: 1 } },
      )
      .toArray(),
  ]);
  if (!company) return { company: null, recipients: [] };

  const reviewerIds = new Set<string>();
  for (const member of memberRows) {
    const reviewerUserId = readString(member?.userId, 120);
    if (reviewerUserId) reviewerIds.add(reviewerUserId);
  }
  const ownerId = readString(company.ownerId, 120);
  if (ownerId) reviewerIds.add(ownerId);

  if (reviewerIds.size === 0) {
    return { company, recipients: [] };
  }

  const reviewerUsers = await db.collection(USERS_COLLECTION)
    .find({ id: { $in: Array.from(reviewerIds) } })
    .project({ id: 1, email: 1, name: 1, firstName: 1, lastName: 1 })
    .toArray();

  const emailDedupe = new Set<string>();
  const recipients: JobReviewRecipient[] = [];

  for (const reviewer of reviewerUsers) {
    const email = readString(reviewer?.email, 160).toLowerCase();
    if (!email || emailDedupe.has(email)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    emailDedupe.add(email);

    const displayName =
      readString(reviewer?.name, 120) ||
      `${readString(reviewer?.firstName, 80)} ${readString(reviewer?.lastName, 80)}`.trim() ||
      'Team';

    recipients.push({
      userId: String(reviewer?.id || ''),
      email,
      displayName,
    });
  }

  return { company, recipients };
};

export const queueJobApplicationReviewEmails = async (params: {
  db: any;
  companyId: string;
  jobId: string;
  application: any;
  job: any;
}): Promise<void> => {
  const companyId = readString(params.companyId, 120);
  const jobId = readString(params.jobId, 120);
  const application = params.application;
  const job = params.job;

  if (!companyId || !jobId || !application || !job) return;

  const { company, recipients } = await resolveJobReviewRecipients(params.db, companyId);
  if (!company || recipients.length === 0) return;

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const ttlHours = getReviewLinkTtlHours();
  const expiresAtIso = new Date(now + ttlHours * 60 * 60 * 1000).toISOString();

  const linkRows: Array<{ recipient: JobReviewRecipient; rawToken: string; record: JobApplicationReviewLinkRecord }> = [];

  for (const recipient of recipients) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    linkRows.push({
      recipient,
      rawToken,
      record: {
        id: `jobreview-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        tokenHash: hashSecureToken(rawToken),
        companyId,
        jobId,
        applicationId: String(application?.id || ''),
        recipientUserId: recipient.userId,
        recipientEmail: recipient.email,
        createdAt: nowIso,
        expiresAt: expiresAtIso,
        lastResolvedAt: null,
        lastResolvedByUserId: null,
      },
    });
  }

  if (linkRows.length === 0) return;

  await params.db.collection(JOB_APPLICATION_REVIEW_LINKS_COLLECTION).insertMany(linkRows.map((row) => row.record));

  await Promise.allSettled(
    linkRows.map((row) =>
      sendJobApplicationReviewEmail(row.recipient.email, {
        reviewerName: row.recipient.displayName,
        companyName: readString(company?.name, 160) || readString(job?.companyName, 160) || 'Aura Company',
        jobTitle: readString(job?.title, 160) || 'Open role',
        applicantName: readString(application?.applicantName, 160) || 'Applicant',
        applicantEmail: readString(application?.applicantEmail, 160),
        applicantPhone: readString(application?.applicantPhone, 60),
        submittedAt: readString(application?.createdAt, 80) || nowIso,
        securePortalUrl: buildReviewPortalUrl(row.rawToken),
        expiresAt: expiresAtIso,
      }),
    ),
  );
};
