"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformUsers = exports.transformUser = void 0;
const transformUser = (user) => {
    if (!user)
        return user;
    const s3Bucket = process.env.S3_BUCKET_NAME;
    const s3Region = process.env.S3_REGION || 'us-east-1';
    const s3BaseUrl = process.env.S3_PUBLIC_BASE_URL
        ? process.env.S3_PUBLIC_BASE_URL.replace(/\/$/, '')
        : `https://${s3Bucket}.s3.${s3Region}.amazonaws.com`;
    // Create a copy to ensure we don't mutate the original if it's frozen (though unlikely for DB results)
    // and to treat it as a plain object.
    const transformed = Object.assign({}, user);
    const isCompanyRecord = transformed.type === 'company' ||
        (typeof transformed.ownerId === 'string' && transformed.ownerId.length > 0);
    // Remove legacy company fields from user objects only, while preserving actual company fields.
    if (!isCompanyRecord) {
        delete transformed.companyName;
        delete transformed.companyWebsite;
        delete transformed.industry;
        delete transformed.subscribers;
        delete transformed.subscriberCount;
        // Product rule: verification badge is company-only.
        transformed.isVerified = false;
    }
    else {
        // Keep company payload clean from personal graph fields.
        delete transformed.acquaintances;
        delete transformed.sentAcquaintanceRequests;
        delete transformed.sentConnectionRequests;
    }
    if (transformed.avatarKey) {
        transformed.avatar = `${s3BaseUrl}/${transformed.avatarKey}`;
    }
    if (transformed.coverKey) {
        transformed.coverImage = `${s3BaseUrl}/${transformed.coverKey}`;
    }
    return transformed;
};
exports.transformUser = transformUser;
const transformUsers = (users) => {
    if (!Array.isArray(users))
        return [];
    return users.map(exports.transformUser);
};
exports.transformUsers = transformUsers;
