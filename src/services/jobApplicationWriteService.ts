import crypto from 'crypto';
import { readString, readStringOrNull } from '../utils/inputSanitizers';
import { ALLOWED_RESUME_MIME_TYPES } from './jobApplicationResponseService';

const JOBS_COLLECTION = 'jobs';
const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const USERS_COLLECTION = 'users';

type JobApplicationWriteError = Error & { statusCode?: number };

const createJobApplicationWriteError = (statusCode: number, message: string): JobApplicationWriteError => {
  const error = new Error(message) as JobApplicationWriteError;
  error.statusCode = statusCode;
  return error;
};

const validateAndResolveApplicantIdentity = (params: {
  payload: Record<string, unknown>;
  useProfile: boolean;
  profileUser: any;
}): { applicantName: string; applicantEmail: string } => {
  if (params.useProfile) {
    if (!params.profileUser) {
      throw createJobApplicationWriteError(400, 'Your Aura profile could not be loaded for this application');
    }
    const derivedProfileName =
      `${readString((params.profileUser as any)?.firstName, 80)} ${readString((params.profileUser as any)?.lastName, 80)}`.trim()
      || readString((params.profileUser as any)?.name, 120);
    const derivedProfileEmail = readString((params.profileUser as any)?.email, 160).toLowerCase();

    if (!derivedProfileName || !derivedProfileEmail) {
      throw createJobApplicationWriteError(
        400,
        'Your Aura profile is missing a name or email. Update your profile and retry.',
      );
    }

    return {
      applicantName: derivedProfileName,
      applicantEmail: derivedProfileEmail,
    };
  }

  return {
    applicantName: readString(params.payload?.applicantName, 120),
    applicantEmail: readString(params.payload?.applicantEmail, 160).toLowerCase(),
  };
};

const resolveResumePayload = (params: {
  payload: Record<string, unknown>;
  useProfile: boolean;
  profileUser: any;
}) => {
  let resumeKey = readString(params.payload?.resumeKey, 500);
  let resumeFileName = readString(params.payload?.resumeFileName, 200);
  let resumeMimeType = readString(params.payload?.resumeMimeType, 120);
  let resumeSize = Number(params.payload?.resumeSize);

  if (params.useProfile && params.profileUser) {
    const defaultResumeKey = readString((params.profileUser as any)?.defaultResumeKey, 500);
    if (defaultResumeKey) {
      resumeKey = defaultResumeKey;
      resumeFileName = readString((params.profileUser as any)?.defaultResumeFileName, 200);
      resumeMimeType = readString((params.profileUser as any)?.defaultResumeMimeType, 120);
      resumeSize = Number((params.profileUser as any)?.defaultResumeSize);
    }
  }

  return {
    resumeKey,
    resumeFileName,
    resumeMimeType,
    resumeSize,
  };
};

export const prepareJobApplicationSubmission = async (params: {
  db: any;
  currentUserId: string;
  jobId: string;
  payload: Record<string, unknown>;
}): Promise<{
  job: any;
  application: any;
  nowIso: string;
}> => {
  const job = await params.db.collection(JOBS_COLLECTION).findOne({ id: params.jobId });
  if (!job || job.status !== 'open') {
    throw createJobApplicationWriteError(404, 'Job not available for applications');
  }

  const duplicate = await params.db.collection(JOB_APPLICATIONS_COLLECTION).findOne({
    jobId: params.jobId,
    applicantUserId: params.currentUserId,
  });
  if (duplicate) {
    throw createJobApplicationWriteError(409, 'You have already applied to this job');
  }

  const useProfile = Boolean(params.payload?.useProfile);
  const profileUser = useProfile
    ? await params.db.collection(USERS_COLLECTION).findOne(
        { id: params.currentUserId },
        {
          projection: {
            firstName: 1,
            lastName: 1,
            name: 1,
            email: 1,
            defaultResumeKey: 1,
            defaultResumeFileName: 1,
            defaultResumeMimeType: 1,
            defaultResumeSize: 1,
          },
        },
      )
    : null;

  const applicantPhone = readStringOrNull(params.payload?.applicantPhone, 40);
  const coverLetter = readStringOrNull(params.payload?.coverLetter, 5000);
  const portfolioUrl = readStringOrNull(params.payload?.portfolioUrl, 300);
  const { applicantName, applicantEmail } = validateAndResolveApplicantIdentity({
    payload: params.payload,
    useProfile,
    profileUser,
  });
  const { resumeKey, resumeFileName, resumeMimeType, resumeSize } = resolveResumePayload({
    payload: params.payload,
    useProfile,
    profileUser,
  });

  if (useProfile && (!resumeKey || !resumeFileName || !resumeMimeType || !Number.isFinite(resumeSize) || resumeSize <= 0)) {
    throw createJobApplicationWriteError(
      400,
      'No default resume found on your Aura profile. Add one in your profile and retry.',
    );
  }

  if (!applicantName || !applicantEmail || !resumeKey || !resumeFileName || !resumeMimeType) {
    throw createJobApplicationWriteError(
      400,
      'applicantName, applicantEmail, resumeKey, resumeFileName and resumeMimeType are required',
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicantEmail)) {
    throw createJobApplicationWriteError(400, 'Invalid applicantEmail format');
  }

  if (!ALLOWED_RESUME_MIME_TYPES.has(resumeMimeType)) {
    throw createJobApplicationWriteError(400, 'Unsupported resume file type');
  }

  if (!Number.isFinite(resumeSize) || resumeSize <= 0 || resumeSize > 10 * 1024 * 1024) {
    throw createJobApplicationWriteError(400, 'resumeSize must be between 1 byte and 10MB');
  }

  const nowIso = new Date().toISOString();
  const nowDate = new Date(nowIso);
  const application = {
    id: `jobapp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    jobId: params.jobId,
    companyId: String(job.companyId || ''),
    jobTitleSnapshot: readString(job.title, 180) || null,
    applicantUserId: params.currentUserId,
    applicantName,
    applicantNameNormalized: applicantName.toLowerCase(),
    applicantEmail,
    applicantEmailNormalized: applicantEmail.toLowerCase(),
    applicantPhone,
    coverLetter,
    portfolioUrl,
    resumeKey,
    resumeFileName,
    resumeMimeType,
    resumeSize,
    status: 'submitted',
    createdAt: nowIso,
    createdAtDate: nowDate,
    updatedAt: nowIso,
    updatedAtDate: nowDate,
    reviewedByUserId: null as string | null,
    reviewedAt: null as string | null,
    reviewedAtDate: null as Date | null,
    statusNote: null as string | null,
  };

  return {
    job,
    application,
    nowIso,
  };
};
