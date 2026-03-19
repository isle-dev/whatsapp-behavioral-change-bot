export type ToneValue = 'encouraging' | 'empathetic' | 'neutral';
export type ReminderWindow = 'morning' | 'noon' | 'evening';
export type OnboardingStepName =
  | 'WELCOME'
  | 'TIMEZONE'
  | 'WAKE_TIME'
  | 'SLEEP_TIME'
  | 'REMINDER_WINDOWS'
  | 'CUSTOM_TIMES'
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
  name?: string;
  timezone?: string;
  wakeTime?: string;
  sleepTime?: string;
  quietStart?: string;
  quietEnd?: string;
  reminderWindows?: ReminderWindow[];
  reminderTimes?: string[];
  customTimes?: string[];
  tone?: ToneValue;
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
