export type SubStatus = 'free' | 'pending' | 'active' | 'expired' | 'suspended';

export type Profile = {
  fullName: string;
  age: string;
  gender: string;
  country: string;
  city: string;
  maritalStatus: string;
  education: string;
  occupation: string;
  income: string;
  householdSize: string;
  devices: string;
  hasCar: string;
  interests: string;
  languages: string;
  other: string;
};

export type User = {
  id: string;
  username: string;
  role: 'user' | 'admin';
  createdAt: number;
  status: SubStatus;
  subscriptionStart: number | null;
  subscriptionEnd: number | null;
  suspendedUntil?: number | null;
  profile: Profile;
  planId?: string | null;
  planName?: string | null;
  usageToday?: number;
};

export type AnalysisRecord = {
  id: string;
  userId: string;
  question: string;
  options: string[];
  questionType: string;
  suggestion: string;
  suggestionIndex: number;
  confidence: number;
  engine: 'gemini' | 'local';
  createdAt: number;
};

export type EmptyProfile = Omit<Profile, never>;

export const emptyProfile: Profile = {
  fullName: '', age: '', gender: '', country: '', city: '', maritalStatus: '',
  education: '', occupation: '', income: '', householdSize: '', devices: '',
  hasCar: '', interests: '', languages: '', other: '',
};
