// Backend type definitions

export interface User {
  type: 'user';
  id: string; // Required field
  firstName: string;
  lastName: string;
  name: string;
  handle: string;
  avatar: string;
  avatarType?: 'image' | 'video';
  coverImage?: string; 
  coverType?: 'image' | 'video';
  bio?: string;
  email?: string;
  phone?: string;
  country?: string;
  acquaintances?: string[]; 
  subscribedCompanyIds?: string[];
  sentAcquaintanceRequests?: string[];
  notifications?: Notification[];
  blockedUsers?: string[];
  blockedBy?: string[];
  profileViews?: string[];
  isPrivate?: boolean;
  isVerified?: boolean;
  userMode?: 'creator' | 'company' | 'hybrid' | 'corporate';
  trustScore: number; 
  auraCredits: number;
  activeGlow?: 'emerald' | 'cyan' | 'amber' | 'gold' | 'silver' | 'bronze' | 'none';
  // Backend-specific fields
  googleId?: string;
  githubId?: string;
  linkedinId?: string;
  discordId?: string;
  passwordHash?: string;
  isAdmin?: boolean; // Required for admin checks
  createdAt?: string;
  updatedAt?: string;
  lastLogin?: string;
  privacySettings?: PrivacySettings;
  archivedChats?: string[];
  refreshTokens?: string[]; // Array of valid refresh tokens
  magicToken?: string | null;
  magicTokenExpires?: string | null; // ISO Date string
  serendipitySkips?: {
    targetUserId: string;
    lastSkippedAt: string;
    count: number;
  }[];
}

export interface Company {
  type: 'company';
  _id?: any;
  id: string;
  name: string;
  handle?: string;
  industry: string;
  bio: string;
  website: string;
  ownerId: string;
  isVerified: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export type Entity = User | Company;

export interface PrivacySettings {
  profileVisibility: 'public' | 'friends' | 'private';
  showOnlineStatus: boolean;
  allowDirectMessages: 'everyone' | 'friends' | 'none';
  showProfileViews: boolean;
  allowTagging: boolean;
  showInSearch: boolean;
  dataProcessingConsent: boolean;
  marketingConsent: boolean;
  analyticsConsent: boolean;
  thirdPartySharing: boolean;
  locationTracking: boolean;
  activityTracking: boolean;
  personalizedAds: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
  dataExportConsent: boolean;
  updatedAt: string;
}

export interface AuthenticatedRequest extends Request {
  user?: User;
}

// Re-export common types that might be used across backend
export interface Notification {
  id: string;
  type:
    | 'reaction'
    | 'comment'
    | 'link'
    | 'credit_received'
    | 'boost_received'
    | 'connection_request'
    | 'acquaintance_request'
    | 'acquaintance_accepted'
    | 'acquaintance_rejected'
    | 'profile_view'
    | 'share'
    | 'like'
    | 'message'
    | 'time_capsule_unlocked';
  fromUser: User;
  message: string;
  timestamp: number;
  isRead: boolean;
  postId?: string;
  connectionId?: string;
  meta?: any;
  yearKey?: string;
}

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: number;
  isRead?: boolean;
  messageType?: 'text' | 'image' | 'file';
  mediaUrl?: string;
  replyTo?: string;
  isEdited?: boolean;
  editedAt?: number;
}

export interface MediaItemMetrics {
  views: number;
  clicks: number;
  saves: number;
  dwellMs: number;
}

export interface MediaItem {
  id: string;
  url: string;
  type: 'image' | 'video';
  key?: string;
  mimeType?: string;
  size?: number;
  caption?: string;
  order: number;
  metrics: MediaItemMetrics;
}

export interface Ad {
  type: 'ad';
  id: string;
  ownerId: string;
  ownerType: 'user' | 'company';
  headline: string;
  description: string;
  imageUrl?: string;
  videoUrl?: string;
  ctaText?: string;
  ctaUrl?: string;
  status: 'active' | 'paused' | 'expired' | 'draft';
  placement: 'feed' | 'sidebar' | 'story' | 'search';
  hashtags: string[];
  expiryDate?: number;
  timestamp: number;
  reactions?: Record<string, number>;
  reactionUsers?: Record<string, string[]>;
  ownerActiveGlow?: string;
  budget?: number;
  isBoosted?: boolean;
  boostCredits?: number;
  boostedAt?: number;
  boostedUntil?: number;
}

export interface Post {
  type: 'post';
  id: string;
  author: {
    id: string;
    name: string;
    handle: string;
    avatar: string;
  };
  content: string;
  energy: string;
  radiance: number;
  timestamp: number;
  reactions: Record<string, number>;
  reactionUsers?: Record<string, string[]>;
  comments?: any[];
  commentCount?: number;
  isBoosted?: boolean;
  hashtags?: string[];
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  mediaItems?: MediaItem[];
  visibility?: 'public' | 'acquaintances' | 'private';
}

export interface AdAnalytics {
  adId: string;
  ownerId: string;
  ownerType: 'user' | 'company';
  impressions: number;
  clicks: number;
  ctr: number;
  reach: number;
  engagement: number;
  conversions: number;
  spend: number;
  lastUpdated: number;
}
