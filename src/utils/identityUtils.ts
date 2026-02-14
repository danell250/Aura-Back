import { getDB } from '../db';

export interface IdentityActor {
  type: 'user' | 'company';
  id: string;
}

/**
 * Validates if a user has access to a specific identity (personal or company).
 * @param userId The ID of the authenticated user
 * @param identityId The ID of the identity to check access for
 * @returns true if the user is the identity (personal) or a member of the company identity
 */
export const validateIdentityAccess = async (userId: string, identityId: string): Promise<boolean> => {
  // 1. Personal Identity Check
  if (userId === identityId) {
    return true;
  }

  // 2. Company Identity Check
  const db = getDB();
  
  // Check company_members collection for membership (owner, admin, member)
  const membership = await db.collection('company_members').findOne({
    userId: userId,
    companyId: identityId
  });

  if (membership) {
    return true;
  }

  // 3. Legacy Company Check (where user is the owner and the company ID matches user ID)
  // This is for cases where the user has a companyName but isn't explicitly in company_members yet
  const user = await db.collection('users').findOne({ id: userId });
  if (user?.companyName && userId === identityId) {
    return true;
  }

  return false;
};

/**
 * Resolves the effective identity actor for a request.
 * @param authenticatedUserId The ID of the authenticated user (from req.user.id)
 * @param params Object containing ownerType and ownerId (usually from req.body or req.query)
 * @param headers Optional request headers to check for x-identity-id and x-identity-type
 * @returns IdentityActor or null if unauthorized
 */
export const resolveIdentityActor = async (
  authenticatedUserId: string,
  params: { ownerType?: string; ownerId?: string },
  headers?: any
): Promise<IdentityActor | null> => {
  let ownerType = params.ownerType || 'user';
  let ownerId = params.ownerId;

  // Prioritize headers if present
  if (headers) {
    if (headers['x-identity-type']) {
      ownerType = headers['x-identity-type'] as string;
    }
    if (headers['x-identity-id']) {
      ownerId = headers['x-identity-id'] as string;
    }
  }

  // If company context is requested
  if (ownerType === 'company' && ownerId) {
    const hasAccess = await validateIdentityAccess(authenticatedUserId, ownerId);
    if (!hasAccess) return null;
    return { type: 'company', id: ownerId };
  }

  // Default to personal user identity
  return { type: 'user', id: authenticatedUserId };
};
