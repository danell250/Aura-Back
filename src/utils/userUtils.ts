
const formatJoinedLabel = (value: unknown): string | null => {
  if (!value) return null;
  const parsed = new Date(value as string);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

export const transformUser = (user: any): any => {
  if (!user) return user;
  
  const s3Bucket = process.env.S3_BUCKET_NAME;
  const s3Region = process.env.S3_REGION || 'us-east-1';
  const s3BaseUrl = process.env.S3_PUBLIC_BASE_URL
    ? process.env.S3_PUBLIC_BASE_URL.replace(/\/$/, '')
    : (s3Bucket ? `https://${s3Bucket}.s3.${s3Region}.amazonaws.com` : '');

  // Create a copy to ensure we don't mutate the original if it's frozen (though unlikely for DB results)
  // and to treat it as a plain object.
  const transformed = { ...user };

  // Never expose auth/session secrets in transformed user payloads.
  delete transformed.password;
  delete transformed.passwordHash;
  delete transformed.refreshTokens;
  delete transformed.magicLinkTokenHash;
  delete transformed.magicLinkExpiresAt;
  delete transformed.pendingInviteToken;
  delete transformed.resetToken;
  delete transformed.resetTokenExpiresAt;
  delete transformed.resetTokenExpires;
  delete transformed.verificationToken;

  const isCompanyRecord =
    transformed.type === 'company' ||
    (typeof transformed.ownerId === 'string' && transformed.ownerId.length > 0);

  if (typeof transformed.handle === 'string') {
    const trimmedHandle = transformed.handle.trim();
    if (trimmedHandle) {
      const withoutAt = trimmedHandle.startsWith('@') ? trimmedHandle.slice(1) : trimmedHandle;
      transformed.handle = `@${withoutAt.toLowerCase()}`;
    } else {
      transformed.handle = '';
    }
  }

  // Remove legacy company fields from user objects only, while preserving actual company fields.
  if (!isCompanyRecord) {
    delete transformed.companyName;
    delete transformed.companyWebsite;
    delete transformed.industry;
    delete transformed.subscribers;
    delete transformed.subscriberCount;
    // Product rule: verification badge is company-only.
    transformed.isVerified = false;
    const joinedLabel = formatJoinedLabel(transformed.createdAt);
    if (joinedLabel) {
      transformed.joinedLabel = joinedLabel;
    } else {
      delete transformed.joinedLabel;
    }
  } else {
    // Keep company payload clean from personal graph fields.
    delete transformed.acquaintances;
    delete transformed.sentAcquaintanceRequests;
    delete transformed.sentConnectionRequests;
    delete transformed.joinedLabel;
  }

  if (
    transformed.avatarKey &&
    typeof s3BaseUrl === 'string' &&
    s3BaseUrl.length > 0 &&
    (!transformed.avatar || typeof transformed.avatar !== 'string' || !/^https?:\/\//i.test(transformed.avatar))
  ) {
    transformed.avatar = `${s3BaseUrl}/${transformed.avatarKey}`;
  }

  if (
    transformed.coverKey &&
    typeof s3BaseUrl === 'string' &&
    s3BaseUrl.length > 0 &&
    (!transformed.coverImage || typeof transformed.coverImage !== 'string' || !/^https?:\/\//i.test(transformed.coverImage))
  ) {
    transformed.coverImage = `${s3BaseUrl}/${transformed.coverKey}`;
  }

  return transformed;
};

export const transformUsers = (users: any[]): any[] => {
  if (!Array.isArray(users)) return [];
  return users.map(transformUser);
};
