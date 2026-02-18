const MENTION_HANDLE_PATTERN = /(^|[^a-zA-Z0-9_])@([a-zA-Z0-9_-]{3,21})(?=$|[^a-zA-Z0-9_-])/g;
const MENTION_CACHE_TTL_MS = 5 * 60 * 1000;

type MentionCacheEntry = {
  ids: string[];
  expiresAt: number;
};

const mentionHandleCache = new Map<string, MentionCacheEntry>();

const readMentionCache = (handle: string): string[] | null => {
  const entry = mentionHandleCache.get(handle);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    mentionHandleCache.delete(handle);
    return null;
  }
  return entry.ids;
};

const writeMentionCache = (handle: string, ids: string[]) => {
  mentionHandleCache.set(handle, {
    ids: Array.from(new Set(ids)),
    expiresAt: Date.now() + MENTION_CACHE_TTL_MS,
  });
};

export const normalizeMentionHandle = (rawHandle: unknown): string => {
  if (typeof rawHandle !== 'string') return '';
  const base = rawHandle.trim().toLowerCase();
  if (!base) return '';
  const withoutAt = base.startsWith('@') ? base.slice(1) : base;
  const cleaned = withoutAt.replace(/[^a-z0-9_-]/g, '');
  if (!cleaned) return '';
  return `@${cleaned}`;
};

export const extractMentionHandles = (text: unknown): string[] => {
  if (typeof text !== 'string' || !text.trim()) return [];
  const uniqueHandles = new Set<string>();

  let match: RegExpExecArray | null;
  const matcher = new RegExp(MENTION_HANDLE_PATTERN.source, 'g');
  while ((match = matcher.exec(text)) !== null) {
    const normalized = normalizeMentionHandle(match[2]);
    if (normalized) uniqueHandles.add(normalized);
  }

  return Array.from(uniqueHandles);
};

export const normalizeTaggedIdentityIds = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  const uniqueIds = new Set<string>();

  for (const value of input) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (id) uniqueIds.add(id);
  }

  return Array.from(uniqueIds);
};

export const resolveMentionedIdentityIds = async (
  db: any,
  text: unknown,
  maxHandles = 8
): Promise<string[]> => {
  const handles = extractMentionHandles(text).slice(0, Math.max(1, maxHandles));
  if (handles.length === 0) return [];

  const combinedIds = new Set<string>();
  const missingHandles: string[] = [];

  for (const handle of handles) {
    const cachedIds = readMentionCache(handle);
    if (cachedIds) {
      for (const id of cachedIds) {
        if (id) combinedIds.add(id);
      }
      continue;
    }
    missingHandles.push(handle);
  }

  if (missingHandles.length > 0) {
    const resolvedEntries = await db.collection('users')
      .aggregate([
        { $match: { handle: { $in: missingHandles } } },
        { $project: { id: 1, handle: 1 } },
        {
          $unionWith: {
            coll: 'companies',
            pipeline: [
              { $match: { handle: { $in: missingHandles }, legacyArchived: { $ne: true } } },
              { $project: { id: 1, handle: 1 } },
            ],
          },
        },
      ])
      .toArray();

    const idsByHandle = new Map<string, string[]>();
    for (const handle of missingHandles) {
      idsByHandle.set(handle, []);
    }

    for (const entry of resolvedEntries) {
      const handle = normalizeMentionHandle(entry?.handle);
      const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
      if (!handle || !id) continue;
      const current = idsByHandle.get(handle) || [];
      current.push(id);
      idsByHandle.set(handle, current);
      combinedIds.add(id);
    }

    for (const [handle, ids] of idsByHandle.entries()) {
      writeMentionCache(handle, ids);
    }
  }

  return Array.from(combinedIds);
};
