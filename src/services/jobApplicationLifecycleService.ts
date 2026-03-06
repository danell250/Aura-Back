import { Request } from 'express';
import { getDB } from '../db';
import { getCompanyApplicationRoom } from '../realtime/roomNames';
import { queueJobApplicationReviewEmails } from './jobApplicationReviewService';
import { enqueueResumeEnrichmentJob } from './resumeEnrichmentQueueService';
import { enrichUserProfileFromResume } from './resumeParsingService';
import { awardApplicationMilestoneBadges } from './userBadgeService';
import { readString } from '../utils/inputSanitizers';

const COMPANIES_COLLECTION = 'companies';
const COMPANY_MEMBERS_COLLECTION = 'company_members';
const USERS_COLLECTION = 'users';

export type CompanyAdminAccessResult = {
  allowed: boolean;
  status: number;
  error?: string;
  company?: any;
};

export const resolveOwnerAdminCompanyAccess = async (
  companyId: string,
  authenticatedUserId: string,
): Promise<CompanyAdminAccessResult> => {
  const db = getDB();
  const company = await db.collection(COMPANIES_COLLECTION).findOne({
    id: companyId,
    legacyArchived: { $ne: true },
  });

  if (!company) {
    return { allowed: false, status: 404, error: 'Company not found' };
  }

  if (company.ownerId === authenticatedUserId) {
    return { allowed: true, status: 200, company };
  }

  const membership = await db.collection(COMPANY_MEMBERS_COLLECTION).findOne({
    companyId,
    userId: authenticatedUserId,
    role: { $in: ['owner', 'admin'] },
  });

  if (!membership) {
    return { allowed: false, status: 403, error: 'Only company owner/admin can perform this action' };
  }

  return { allowed: true, status: 200, company };
};

export const canReadJobApplication = async (
  application: any,
  authenticatedUserId: string,
): Promise<boolean> => {
  if (!application) return false;
  const applicantUserId = readString(application?.applicantUserId, 120);
  if (applicantUserId && applicantUserId === authenticatedUserId) return true;
  const companyId = readString(application?.companyId, 120);
  if (!companyId) return false;
  const access = await resolveOwnerAdminCompanyAccess(companyId, authenticatedUserId);
  return access.allowed;
};

export const listOwnerAdminCompanyIdsForUser = async (
  authenticatedUserId: string,
): Promise<string[]> => {
  const userId = readString(authenticatedUserId, 120);
  if (!userId) return [];

  const db = getDB();
  const [ownedCompanies, memberships] = await Promise.all([
    db.collection(COMPANIES_COLLECTION).find(
      {
        ownerId: userId,
        legacyArchived: { $ne: true },
      },
      { projection: { id: 1 } },
    ).toArray(),
    db.collection(COMPANY_MEMBERS_COLLECTION).find(
      {
        userId,
        role: { $in: ['owner', 'admin'] },
      },
      { projection: { companyId: 1 } },
    ).toArray(),
  ]);

  return Array.from(
    new Set(
      [
        ...ownedCompanies.map((company: any) => readString(company?.id, 120)),
        ...memberships.map((membership: any) => readString(membership?.companyId, 120)),
      ].filter((companyId) => companyId.length > 0),
    ),
  );
};

export const incrementApplicantApplicationCount = async (
  db: any,
  userId: string,
  nowIso: string,
): Promise<number | null> => {
  try {
    const updateResult = await db.collection(USERS_COLLECTION).findOneAndUpdate(
      { id: userId },
      {
        $inc: { jobApplicationsCount: 1 },
        $set: { updatedAt: nowIso },
      },
      {
        returnDocument: 'after',
        projection: { jobApplicationsCount: 1 },
      },
    );
    const updatedUser = (updateResult as any)?.value ?? updateResult;
    const parsedCount = Number((updatedUser as any)?.jobApplicationsCount);
    return Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : null;
  } catch (counterError) {
    console.error('Increment user jobApplicationsCount error:', counterError);
    return null;
  }
};

const emitNewApplicationEvent = (
  req: Request,
  params: {
    companyId: string;
    applicationId: string;
    jobTitle: string;
    applicantName: string;
    createdAt: string;
  },
): void => {
  const io = req.app.get('io');
  const targetCompanyId = readString(params.companyId, 120);
  if (!io || !targetCompanyId) return;

  io.to(getCompanyApplicationRoom(targetCompanyId)).emit('new_application', {
    applicationId: params.applicationId,
    jobTitle: params.jobTitle,
    applicantName: params.applicantName,
    companyId: targetCompanyId,
    createdAt: params.createdAt,
  });
};

export const scheduleJobApplicationPostCreateEffects = (params: {
  req: Request;
  db: any;
  currentUserId: string;
  applicantApplicationCount: number | null;
  jobId: string;
  job: any;
  application: any;
  nowIso: string;
}): void => {
  void awardApplicationMilestoneBadges({
    db: params.db,
    userId: params.currentUserId,
    applicationId: params.application.id,
    applicationCount: params.applicantApplicationCount ?? undefined,
  }).catch((badgeError) => {
    console.error('Award application milestone badges error:', badgeError);
  });

  emitNewApplicationEvent(params.req, {
    companyId: String(params.job.companyId || ''),
    applicationId: String(params.application.id || ''),
    jobTitle: String(params.job.title || ''),
    applicantName: String(params.application.applicantName || ''),
    createdAt: params.nowIso,
  });

  void queueJobApplicationReviewEmails({
    db: params.db,
    companyId: String(params.job.companyId || ''),
    jobId: params.jobId,
    application: params.application,
    job: params.job,
  }).catch((emailError) => {
    console.error('Job application review email dispatch error:', emailError);
  });

  setImmediate(() => {
    enqueueResumeEnrichmentJob(async () => {
      await enrichUserProfileFromResume({
        db: params.db,
        userId: params.currentUserId,
        resumeKey: readString(params.application?.resumeKey, 600),
        resumeMimeType: readString(params.application?.resumeMimeType, 120).toLowerCase(),
        resumeFileName: readString(params.application?.resumeFileName, 200),
        source: 'job_application_submission',
      });
    });
  });
};
