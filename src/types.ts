export type ToneValue = 'encouraging' | 'empathetic' | 'neutral';
export type ReminderWindow = 'morning' | 'noon' | 'evening';

export type MedTiming = 'morning' | 'afternoon' | 'evening' | 'varies';
export type CheckinFrequency = 'daily' | 'few_times_week' | 'once_week';
export type SocialSupport = 'yes' | 'no' | 'want_but_dont';
export type NecessityBelief = 'important' | 'some_doubts' | 'not_sure';
export type ConcernsBelief = 'not_really' | 'a_little' | 'quite_a_bit';
export type IllnessUnderstanding = 'knew' | 'heard' | 'didnt_know';

export type OnboardingStepName =
  | 'WELCOME'
  | 'TIMEZONE'
  | 'MED_TIMING'
  | 'CHECKIN_FREQ'
  | 'WEEKDAY_ROUTINE'
  | 'MED_ANCHOR'
  | 'STORAGE_LOCATION'
  | 'MEMORY_AIDS'
  | 'WEEKEND_ROUTINE'
  | 'SCHEDULE_TYPE'
  | 'YESTERDAY_ADHERENCE'
  | 'YESTERDAY_BARRIER'
  | 'GENERAL_BARRIERS'
  | 'SOCIAL_SUPPORT'
  | 'NECESSITY_BELIEF'
  | 'CONCERNS_BELIEF'
  | 'ILLNESS_UNDERSTANDING'
  | 'TONE'
  | 'CONFIRM'
  | 'DONE';

export type ProfileUpdateField =
  | 'sleepTime'
  | 'wakeTime'
  | 'reminderTimes'
  | 'timezone'
  | 'tone'
  | 'name';

export interface Profile {
  userId: string;
  createdAt: string;
  updatedAt?: string;
  onboardingStep?: OnboardingStepName;
  onboardingComplete?: boolean;
  // Identity & preferences
  name?: string;
  timezone?: string;
  tone?: ToneValue;
  // Scheduling (derived or set post-onboarding)
  reminderTimes?: string[];
  quietStart?: string;
  quietEnd?: string;
  // Legacy fields kept for post-onboarding "change X" commands in orchestration
  wakeTime?: string;
  sleepTime?: string;
  // JITAI trait profile — Block 1: Medication & preferences
  medTiming?: MedTiming;
  checkinFrequency?: CheckinFrequency;
  // JITAI trait profile — Block 2: Weekday routine
  weekdayRoutine?: string;
  medAnchor?: string;
  storageLocation?: string;
  memoryAids?: string;
  // JITAI trait profile — Block 3: Weekend & schedule
  weekendRoutineDiff?: string;
  scheduleType?: string;
  // JITAI trait profile — Block 4: Recent adherence
  yesterdayAdherence?: boolean;
  yesterdayBarrier?: string;
  // JITAI trait profile — Block 5: General barriers & social
  generalBarriers?: string;
  socialSupport?: SocialSupport;
  // JITAI trait profile — Block 6: Beliefs & knowledge
  necessityBelief?: NecessityBelief;
  concernsBelief?: ConcernsBelief;
  illnessUnderstanding?: IllnessUnderstanding;
  // Engagement tracking
  pendingBarrierCapture?: boolean;
  consecutiveNonResponses?: number;
  lastReminderSentAt?: string;
  lastResponseAt?: string;
  // Pause / snooze
  pausedUntil?: string;        // ISO timestamp; reminders suppressed until this time
  followUpSentAt?: string;     // YYYY-MM-DD; prevents duplicate follow-up nudges per day
}

export type ProfilesStore = Record<string, Profile>;

export interface InteractiveButton {
  type: 'reply';
  reply: { id: string; title: string };
}

export interface InteractiveMessage {
  type: 'button' | 'list';
  body?: { text: string };
  action: {
    buttons?: InteractiveButton[];
    sections?: unknown[];
  };
}

export interface WaLocation {
  latitude: number;
  longitude: number;
}

export interface BotResult {
  messages: string[];
  interactive?: InteractiveMessage;
}

export interface ProfileUpdate {
  field: ProfileUpdateField;
  value: string | string[];
  label: string;
  syncDb: boolean;
}

export type ParseResult<T> = { value: T } | { error: string };

export interface OnboardingStep<T> {
  prompt(p?: Partial<Profile>): { text: string; interactive?: InteractiveMessage };
  parse?(input: string, p?: Partial<Profile>): ParseResult<T>;
  apply?(value: T, p: Profile): Profile;
}
