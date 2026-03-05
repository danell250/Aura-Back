export type BadgeKey =
  | 'first_application'
  | 'ten_applications'
  | 'interview_stage'
  | 'hired';

export type BadgeDefinition = {
  key: BadgeKey;
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
  category: 'jobs';
};

export const BADGE_CATALOG: Record<BadgeKey, BadgeDefinition> = {
  first_application: {
    key: 'first_application',
    name: 'First Application',
    description: 'Submitted your first job application on Aura.',
    icon: '🚀',
    sortOrder: 10,
    category: 'jobs',
  },
  ten_applications: {
    key: 'ten_applications',
    name: 'Momentum Builder',
    description: 'Submitted 10 job applications and kept momentum going.',
    icon: '🔥',
    sortOrder: 20,
    category: 'jobs',
  },
  interview_stage: {
    key: 'interview_stage',
    name: 'Interview Stage',
    description: 'Reached an interview stage on at least one application.',
    icon: '🎯',
    sortOrder: 30,
    category: 'jobs',
  },
  hired: {
    key: 'hired',
    name: 'Hired',
    description: 'Received a hired outcome for an Aura application.',
    icon: '🏆',
    sortOrder: 40,
    category: 'jobs',
  },
};
