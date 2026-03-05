import {
  parseResumeBuffer,
  RESUME_SUPPORTED_MIME_TYPES,
  ResumeParseResult,
} from './resumeTextExtractionService';
import { resolveResumeBuffer } from './resumeStorageService';

const USERS_COLLECTION = 'users';

const readString = (value: unknown, maxLength = 10000): string => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  return normalized.slice(0, maxLength);
};

type ResumeEnrichmentInput = {
  userId: string;
  resumeKey: string;
  resumeMimeType: string;
  resumeFileName?: string;
  source?: string;
};

const buildResumeInsights = (params: {
  parsed: ResumeParseResult;
  resumeKey: string;
  resumeMimeType: string;
  resumeFileName?: string;
  source?: string;
  nowIso: string;
}) => ({
  parsedAt: params.nowIso,
  parser: params.parsed.parser,
  source: readString(params.source, 80) || 'resume_upload',
  resumeKey: params.resumeKey,
  resumeMimeType: params.resumeMimeType,
  resumeFileName: readString(params.resumeFileName, 200) || null,
  extractedEmail: params.parsed.email,
  extractedName: params.parsed.inferredName,
  extractedSkills: params.parsed.skills,
});

const persistUserResumeUpdates = async (params: {
  db: any;
  userId: string;
  parsed: ResumeParseResult;
  resumeKey: string;
  resumeMimeType: string;
  resumeFileName?: string;
  source?: string;
}): Promise<void> => {
  const nowIso = new Date().toISOString();
  const resumeInsights = buildResumeInsights({
    parsed: params.parsed,
    resumeKey: params.resumeKey,
    resumeMimeType: params.resumeMimeType,
    resumeFileName: params.resumeFileName,
    source: params.source,
    nowIso,
  });

  const parsedSkills = params.parsed.skills.slice(0, 100);
  const updateDoc: Record<string, unknown> = {
    $set: {
      updatedAt: nowIso,
      resumeInsights,
    },
  };
  if (parsedSkills.length > 0) {
    updateDoc.$addToSet = {
      skills: { $each: parsedSkills },
      profileSkills: { $each: parsedSkills },
    };
  }

  await params.db.collection(USERS_COLLECTION).updateOne(
    { id: params.userId },
    updateDoc,
  );
};

const normalizeResumeEnrichmentInput = (params: ResumeEnrichmentInput): ResumeEnrichmentInput | null => {
  const normalized: ResumeEnrichmentInput = {
    userId: readString(params.userId, 120),
    resumeKey: readString(params.resumeKey, 600),
    resumeMimeType: readString(params.resumeMimeType, 120).toLowerCase(),
    resumeFileName: readString(params.resumeFileName, 200),
    source: readString(params.source, 80),
  };

  if (
    !normalized.userId
    || !normalized.resumeKey
    || !normalized.resumeMimeType
    || !RESUME_SUPPORTED_MIME_TYPES.has(normalized.resumeMimeType)
  ) {
    return null;
  }

  return normalized;
};

const parseResumeFromStorage = async (db: any, input: ResumeEnrichmentInput): Promise<ResumeParseResult | null> => {
  const fileBuffer = await resolveResumeBuffer({ db, resumeKey: input.resumeKey });
  if (!fileBuffer) return null;

  const parsed = await parseResumeBuffer(fileBuffer, input.resumeMimeType);
  if (!parsed.fullText && parsed.skills.length === 0 && !parsed.email) return null;
  return parsed;
};

export const enrichUserProfileFromResume = async (params: {
  db: any;
  userId: string;
  resumeKey: string;
  resumeMimeType: string;
  resumeFileName?: string;
  source?: string;
}): Promise<void> => {
  const normalizedInput = normalizeResumeEnrichmentInput(params);
  if (!normalizedInput) return;

  const parsed = await parseResumeFromStorage(params.db, normalizedInput);
  if (!parsed) return;

  await persistUserResumeUpdates({
    db: params.db,
    userId: normalizedInput.userId,
    parsed,
    resumeKey: normalizedInput.resumeKey,
    resumeMimeType: normalizedInput.resumeMimeType,
    resumeFileName: normalizedInput.resumeFileName,
    source: normalizedInput.source,
  });
};
