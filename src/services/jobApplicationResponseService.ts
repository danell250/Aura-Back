import crypto from 'crypto';

export const ALLOWED_APPLICATION_STATUSES = new Set([
  'submitted',
  'in_review',
  'shortlisted',
  'rejected',
  'hired',
  'withdrawn',
]);

export const ALLOWED_RESUME_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export const hashSecureToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

export const toApplicationResponse = (application: any) => ({
  id: String(application?.id || ''),
  jobId: String(application?.jobId || ''),
  companyId: String(application?.companyId || ''),
  applicantUserId: String(application?.applicantUserId || ''),
  applicantName: String(application?.applicantName || ''),
  applicantEmail: String(application?.applicantEmail || ''),
  applicantPhone: String(application?.applicantPhone || ''),
  coverLetter: String(application?.coverLetter || ''),
  portfolioUrl: String(application?.portfolioUrl || ''),
  resumeKey: String(application?.resumeKey || ''),
  resumeFileName: String(application?.resumeFileName || ''),
  resumeMimeType: String(application?.resumeMimeType || ''),
  resumeSize: Number.isFinite(application?.resumeSize) ? Number(application.resumeSize) : 0,
  status: String(application?.status || 'submitted'),
  createdAt: application?.createdAt || null,
  updatedAt: application?.updatedAt || null,
  reviewedByUserId: application?.reviewedByUserId || null,
  reviewedAt: application?.reviewedAt || null,
  statusNote: application?.statusNote || null,
});

export const toApplicationCompanySummaryResponse = (company: any) =>
  company
    ? {
        id: String(company.id || ''),
        name: String(company.name || ''),
        handle: String(company.handle || ''),
        avatar: String(company.avatar || ''),
        avatarType: String(company.avatarType || 'image'),
      }
    : null;
