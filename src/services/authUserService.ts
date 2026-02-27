import { getDB } from '../db';

export const normalizeUserHandle = (rawHandle: string): string => {
  const base = (rawHandle || '').trim().toLowerCase();
  const withoutAt = base.startsWith('@') ? base.slice(1) : base;
  const cleaned = withoutAt.replace(/[^a-z0-9_-]/g, '');
  if (!cleaned) return '';
  return `@${cleaned}`;
};

export const findUserByEmail = async (email: string) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;
  const db = getDB();
  return db.collection('users').findOne(
    { email: normalizedEmail },
    { collation: { locale: 'en', strength: 2 } }
  );
};

export const findUserByEmailAndMagicLinkHash = async (email: string, tokenHash: string) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedHash = String(tokenHash || '').trim().toLowerCase();
  if (!normalizedEmail || !normalizedHash) return null;

  const db = getDB();
  return db.collection('users').findOne(
    { email: normalizedEmail, magicLinkTokenHash: normalizedHash },
    { collation: { locale: 'en', strength: 2 } }
  );
};

export const validateHandleFormat = (handle: string): { ok: boolean; message?: string } => {
  const normalized = normalizeUserHandle(handle);
  if (!normalized) {
    return { ok: false, message: 'Handle is required' };
  }
  const core = normalized.slice(1);
  if (core.length < 3 || core.length > 21) {
    return { ok: false, message: 'Handle must be between 3 and 21 characters' };
  }
  if (!/^[a-z0-9_-]+$/.test(core)) {
    return { ok: false, message: 'Handle can only use letters, numbers, underscores and hyphens' };
  }
  return { ok: true };
};

export const generateUniqueHandle = async (firstName: string, lastName: string): Promise<string> => {
  const db = getDB();

  const firstNameSafe = (firstName || 'user').toLowerCase().trim().replace(/\s+/g, '');
  const lastNameSafe = (lastName || '').toLowerCase().trim().replace(/\s+/g, '');

  const baseHandle = `@${firstNameSafe}${lastNameSafe}`;

  try {
    const existingUser = await db.collection('users').findOne({ handle: baseHandle });
    const existingCompany = await db.collection('companies').findOne({ handle: baseHandle });
    if (!existingUser && !existingCompany) {
      console.log('✓ Handle available:', baseHandle);
      return baseHandle;
    }
  } catch (error) {
    console.error('Error checking base handle:', error);
  }

  const MAX_RANDOM_ATTEMPTS = 50;
  const BATCH_SIZE = 10;
  const generatedCandidates = new Set<string>();

  for (let offset = 0; offset < MAX_RANDOM_ATTEMPTS; offset += BATCH_SIZE) {
    const batch: string[] = [];
    while (batch.length < BATCH_SIZE && generatedCandidates.size < MAX_RANDOM_ATTEMPTS) {
      const randomNum = Math.floor(Math.random() * 100000);
      const candidateHandle = `${baseHandle}${randomNum}`;
      if (!generatedCandidates.has(candidateHandle)) {
        generatedCandidates.add(candidateHandle);
        batch.push(candidateHandle);
      }
    }
    if (!batch.length) break;

    try {
      const [existingUsers, existingCompanies] = await Promise.all([
        db.collection('users').find(
          { handle: { $in: batch } },
          { projection: { handle: 1, _id: 0 } }
        ).toArray(),
        db.collection('companies').find(
          { handle: { $in: batch } },
          { projection: { handle: 1, _id: 0 } }
        ).toArray(),
      ]);

      const takenHandles = new Set<string>([
        ...existingUsers.map((entry: any) => String(entry?.handle || '')),
        ...existingCompanies.map((entry: any) => String(entry?.handle || '')),
      ]);

      const availableHandle = batch.find((candidate) => !takenHandles.has(candidate));
      if (availableHandle) {
        console.log('✓ Handle available:', availableHandle);
        return availableHandle;
      }
    } catch (error) {
      console.error('Error checking handle batch availability:', error);
    }
  }

  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 9);
  const fallbackHandle = `@user${timestamp}${randomStr}`;
  console.log('⚠ Using fallback handle:', fallbackHandle);
  return fallbackHandle;
};
