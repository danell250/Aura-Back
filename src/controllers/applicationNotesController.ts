import crypto from 'crypto';
import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';

const JOB_APPLICATIONS_COLLECTION = 'job_applications';
const JOB_APPLICATION_NOTES_COLLECTION = 'application_notes';
const COMPANIES_COLLECTION = 'companies';
const COMPANY_MEMBERS_COLLECTION = 'company_members';
const USERS_COLLECTION = 'users';

type CompanyAdminAccessResult = {
  allowed: boolean;
  status: number;
  error?: string;
};

const readString = (value: unknown, maxLength = 10000): string => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  return normalized.slice(0, maxLength);
};

const readStringOrNull = (value: unknown, maxLength = 10000): string | null => {
  const normalized = readString(value, maxLength);
  return normalized.length > 0 ? normalized : null;
};

const resolveUserDisplayName = (user: any): string => {
  if (!user || typeof user !== 'object') return '';
  return (
    readString(user?.name, 160) ||
    `${readString(user?.firstName, 80)} ${readString(user?.lastName, 80)}`.trim()
  );
};

const toApplicationNoteResponse = (note: any, authorName?: string | null) => ({
  id: String(note?.id || ''),
  applicationId: String(note?.applicationId || ''),
  authorId: String(note?.authorId || ''),
  authorName: authorName || readStringOrNull(note?.authorName, 160),
  content: String(note?.content || ''),
  createdAt: note?.createdAt || null,
  updatedAt: note?.updatedAt || null,
});

const resolveOwnerAdminCompanyAccess = async (
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
    return { allowed: true, status: 200 };
  }

  const membership = await db.collection(COMPANY_MEMBERS_COLLECTION).findOne({
    companyId,
    userId: authenticatedUserId,
    role: { $in: ['owner', 'admin'] },
  });

  if (!membership) {
    return { allowed: false, status: 403, error: 'Only company owner/admin can perform this action' };
  }

  return { allowed: true, status: 200 };
};

export const applicationNotesController = {
  // GET /api/applications/:applicationId/notes
  listApplicationNotes: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = (req.user as any)?.id;
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const applicationId = readString(req.params.applicationId, 120);
      if (!applicationId) {
        return res.status(400).json({ success: false, error: 'applicationId is required' });
      }

      const db = getDB();
      const application = await db.collection(JOB_APPLICATIONS_COLLECTION).findOne(
        { id: applicationId },
        { projection: { id: 1, companyId: 1 } },
      );
      if (!application) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }

      const access = await resolveOwnerAdminCompanyAccess(String(application.companyId || ''), currentUserId);
      if (!access.allowed) {
        return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
      }

      const notes = await db.collection(JOB_APPLICATION_NOTES_COLLECTION)
        .find({ applicationId })
        .sort({ createdAt: 1 })
        .limit(500)
        .toArray();

      if (notes.length === 0) {
        return res.json({ success: true, data: [] });
      }

      const authorIds = Array.from(
        new Set(
          notes
            .map((note: any) => readString(note?.authorId, 120))
            .filter((id: string) => id.length > 0),
        ),
      );

      const authorUsers = authorIds.length > 0
        ? await db.collection(USERS_COLLECTION)
            .find({ id: { $in: authorIds } })
            .project({ id: 1, name: 1, firstName: 1, lastName: 1 })
            .toArray()
        : [];
      const authorNameById = new Map<string, string>(
        authorUsers.map((user: any) => [String(user?.id || ''), resolveUserDisplayName(user)]),
      );

      return res.json({
        success: true,
        data: notes.map((note: any) =>
          toApplicationNoteResponse(note, authorNameById.get(String(note?.authorId || '')) || null),
        ),
      });
    } catch (error) {
      console.error('List application notes error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch application notes' });
    }
  },

  // POST /api/applications/:applicationId/notes
  createApplicationNote: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const currentUserId = (req.user as any)?.id;
      if (!currentUserId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const applicationId = readString(req.params.applicationId, 120);
      if (!applicationId) {
        return res.status(400).json({ success: false, error: 'applicationId is required' });
      }

      const content = readString((req.body as any)?.content, 4000);
      if (!content) {
        return res.status(400).json({ success: false, error: 'Note content is required' });
      }

      const db = getDB();
      const application = await db.collection(JOB_APPLICATIONS_COLLECTION).findOne(
        { id: applicationId },
        { projection: { id: 1, jobId: 1, companyId: 1 } },
      );
      if (!application) {
        return res.status(404).json({ success: false, error: 'Application not found' });
      }

      const access = await resolveOwnerAdminCompanyAccess(String(application.companyId || ''), currentUserId);
      if (!access.allowed) {
        return res.status(access.status).json({ success: false, error: access.error || 'Unauthorized' });
      }

      const author = await db.collection(USERS_COLLECTION).findOne(
        { id: currentUserId },
        { projection: { name: 1, firstName: 1, lastName: 1 } },
      );
      const authorName = resolveUserDisplayName(author) || null;
      const nowIso = new Date().toISOString();
      const note = {
        id: `jobnote-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        applicationId,
        jobId: readString(application.jobId, 120),
        companyId: readString(application.companyId, 120),
        authorId: currentUserId,
        authorName,
        content,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      await db.collection(JOB_APPLICATION_NOTES_COLLECTION).insertOne(note);

      return res.status(201).json({
        success: true,
        data: toApplicationNoteResponse(note, authorName),
      });
    } catch (error) {
      console.error('Create application note error:', error);
      return res.status(500).json({ success: false, error: 'Failed to create application note' });
    }
  },
};
