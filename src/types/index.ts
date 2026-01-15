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
  dob?: string;
  zodiacSign?: string;
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
  passwordHash?: string;
  isAdmin?: boolean; // Required for admin checks
  createdAt?: string;
  updatedAt?: string;
  lastLogin?: string;
  privacySettings?: PrivacySettings;
  archivedChats?: string[];
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
  type: 'reaction' | 'comment' | 'link' | 'credit_received' | 'boost_received' | 'acquaintance_request' | 'profile_view' | 'share' | 'like' | 'message';
  fromUser: User;
  message: string;
  timestamp: number;
  isRead: boolean;
  postId?: string;
  connectionId?: string;
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
