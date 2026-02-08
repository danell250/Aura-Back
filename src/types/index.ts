// Backend type definitions

export interface User {
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
  sentAcquaintanceRequests?: string[];
  notifications?: Notification[];
  blockedUsers?: string[];
  blockedBy?: string[];
  profileViews?: string[];
  isPrivate?: boolean;
  trustScore: number; 
  auraCredits: number;
  activeGlow?: 'emerald' | 'cyan' | 'amber' | 'gold' | 'silver' | 'bronze' | 'none';
  companyName?: string;
  industry?: string;
  employeeCount?: number;
  isCompany?: boolean;
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
