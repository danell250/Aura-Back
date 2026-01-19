
export const transformUser = (user: any): any => {
  if (!user) return user;
  
  const s3Bucket = process.env.S3_BUCKET_NAME;
  const s3Region = process.env.S3_REGION;
  const s3BaseUrl = process.env.S3_PUBLIC_BASE_URL || `https://${s3Bucket}.s3.${s3Region}.amazonaws.com`;

  // Create a copy to ensure we don't mutate the original if it's frozen (though unlikely for DB results)
  // and to treat it as a plain object.
  const transformed = { ...user };

  if (transformed.avatarKey) {
    transformed.avatar = `${s3BaseUrl}/${transformed.avatarKey}`;
  }

  if (transformed.coverKey) {
    transformed.coverImage = `${s3BaseUrl}/${transformed.coverKey}`;
  }

  return transformed;
};

export const transformUsers = (users: any[]): any[] => {
  if (!Array.isArray(users)) return [];
  return users.map(transformUser);
};
