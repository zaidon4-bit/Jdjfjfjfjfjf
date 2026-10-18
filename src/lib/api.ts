import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from './config';
import { emptyProfile, Profile, SubStatus, User } from '../types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.name = 'ApiError'; this.status = status; }
}

const TOKEN_KEY = 'sai.auth.token.v2';
const CACHED_USER_KEY = 'sai.auth.cached-user.v2';

export type Plan = { id: string; name: string; durationDays: number };
export type AdminPlan = Plan & { active: boolean; updatedAt: number };
export type AuditLog = { id: string; action: string; entityType: string; entityId: string; details: Record<string, unknown>; createdAt: number; actorUsername: string; targetUsername: string | null };
export type SubscriptionOrder = {
  id: string;
  planId: string;
  planName: string;
  durationDays?: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  paymentMethod: string;
  paymentReference: string;
  adminNote: string;
  createdAt: number;
  decidedAt: number | null;
  userId?: string;
  username?: string;
};
export type AdminDashboard = {
  users: User[];
  orders: SubscriptionOrder[];
  plans: AdminPlan[];
  auditLogs: AuditLog[];
  stats: { users: number; active: number; pendingOrders: number; expired: number; suspended: number; paymentConfigured: boolean; dailyAiRequests: number; gemini: { configured: boolean; model: string; totalKeys: number; availableKeys: number; nextRetryAt: number | null } };
};

function normalizeUser(value: any): User {
  return {
    id: String(value.id),
    username: String(value.username),
    role: value.role === 'admin' ? 'admin' : 'user',
    createdAt: Number(value.createdAt || Date.now()),
    status: (['free', 'pending', 'active', 'expired', 'suspended'].includes(value.status) ? value.status : 'free') as SubStatus,
    subscriptionStart: value.subscriptionStart == null ? null : Number(value.subscriptionStart),
    subscriptionEnd: value.subscriptionEnd == null ? null : Number(value.subscriptionEnd),
    profile: { ...emptyProfile, ...(value.profile || {}) },
    planId: value.planId || null,
    planName: value.planName || null,
    usageToday: Number(value.usageToday || 0),
  } as User;
}

async function getToken(): Promise<string | null> {
  return Platform.OS === 'web'
    ? AsyncStorage.getItem(TOKEN_KEY)
    : SecureStore.getItemAsync(TOKEN_KEY);
}

async function setCachedUser(user: User | null): Promise<void> {
  if (user) await AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
  else await AsyncStorage.removeItem(CACHED_USER_KEY);
}

async function getCachedUser(): Promise<User | null> {
  const raw = await AsyncStorage.getItem(CACHED_USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as User; } catch { return null; }
}

async function setToken(token: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } else if (token) {
    await SecureStore.setItemAsync(TOKEN_KEY, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

export function isApiConfigured(): boolean { return !!API_BASE_URL && /^https:\/\//i.test(API_BASE_URL); }

async function request<T>(path: string, options: RequestInit = {}, authenticated = true): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error('الخادم المركزي غير مضبوط بعد. لازم تضيف EXPO_PUBLIC_API_BASE_URL إلى إعدادات البناء بعد نشر backend.');
  }
  if (!/^https:\/\//i.test(API_BASE_URL) && !/^http:\/\/localhost(?::\d+)?$/i.test(API_BASE_URL) && !/^http:\/\/10\.0\.2\.2(?::\d+)?$/i.test(API_BASE_URL)) {
    throw new Error('رابط API يجب أن يبدأ بـ HTTPS عند النشر.');
  }
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (authenticated) {
    const token = await getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch {
    throw new Error('تعذّر الاتصال بالخادم المركزي. تحقق من رابط الخادم والإنترنت.');
  }
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && authenticated) { await setToken(null); await setCachedUser(null); }
    throw new ApiError(data?.error || `فشل الطلب (HTTP ${response.status}).`, response.status);
  }
  return data as T;
}

export const api = {
  async register(username: string, password: string): Promise<User> {
    const data = await request<{ token: string; user: any }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }, false);
    await setToken(data.token);
    const user = normalizeUser(data.user);
    await setCachedUser(user);
    return user;
  },
  async login(username: string, password: string): Promise<User> {
    const data = await request<{ token: string; user: any }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }, false);
    await setToken(data.token);
    const user = normalizeUser(data.user);
    await setCachedUser(user);
    return user;
  },
  async me(): Promise<User | null> {
    const token = await getToken();
    if (!token) return null;
    try {
      const data = await request<{ user: any }>('/api/auth/me');
      const user = normalizeUser(data.user);
      await setCachedUser(user);
      return user;
    } catch (error) {
      if ((error as Error)?.message?.includes('تعذّر الاتصال') || (error as Error)?.message?.includes('الخادم المركزي غير مضبوط')) {
        const cached = await getCachedUser();
        if (cached) return cached;
      }
      throw error;
    }
  },
  async logout() { await setToken(null); await setCachedUser(null); },
  async session(): Promise<User | null> { return this.me(); },
  async plans(): Promise<Plan[]> {
    const data = await request<{ plans: Plan[] }>('/api/plans', {}, false);
    return data.plans;
  },
  async paymentInfo(): Promise<{ configured: boolean; mode?: 'manual'; instructions: string }> {
    return request<{ configured: boolean; instructions: string }>('/api/payment-info');
  },
  async analyze(question: string, options: string[], _profile: Profile): Promise<{ suggestionIndex: number; suggestionText?: string; reason: string; questionType?: string; confidence?: number; engine: 'gemini' }> {
    return request('/api/ai/analyze', { method: 'POST', body: JSON.stringify({ question, options }) });
  },
  async extractSurveyFromImage(imageBase64: string, mimeType: string): Promise<{ question: string; options: string[]; extractedText: string; engine: 'gemini-vision'; imageStored: false }> {
    return request('/api/ai/ocr', { method: 'POST', body: JSON.stringify({ imageBase64, mimeType }) });
  },
  async aiStatus(): Promise<{ configured: boolean; model: string; dailyLimit: number; usageToday: number; includesOcr: boolean }> {
    return request<{ configured: boolean; model: string; dailyLimit: number; usageToday: number; includesOcr: boolean }>('/api/ai/status');
  },
  async subscription(): Promise<User> {
    const data = await request<{ user: any }>('/api/subscription/me');
    const user = normalizeUser(data.user);
    await setCachedUser(user);
    return user;
  },
  async updateProfile(profile: Profile): Promise<User> {
    const data = await request<{ user: any }>('/api/profile', { method: 'PATCH', body: JSON.stringify({ profile }) });
    const user = normalizeUser(data.user);
    await setCachedUser(user);
    return user;
  },
  async createOrder(planId: string, paymentReference: string): Promise<{ orderId: string; order: SubscriptionOrder; user: User }> {
    const data = await request<{ orderId: string; order: SubscriptionOrder; user: any }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ planId, paymentMethod: 'manual', paymentReference }),
    });
    return { ...data, user: normalizeUser(data.user) };
  },
  async myOrders(): Promise<SubscriptionOrder[]> {
    const data = await request<{ orders: SubscriptionOrder[] }>('/api/orders/me');
    return data.orders;
  },
  async adminDashboard(): Promise<AdminDashboard> { return request<AdminDashboard>('/api/admin/dashboard'); },
  async adminUpdatePlan(id: string, plan: Omit<AdminPlan, 'id' | 'updatedAt'>): Promise<AdminPlan> {
    const data = await request<{ plan: AdminPlan }>(`/api/admin/plans/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(plan) });
    return data.plan;
  },
  async adminOrderDecision(id: string, approved: boolean, adminNote = ''): Promise<void> {
    await request(`/api/admin/orders/${encodeURIComponent(id)}/${approved ? 'approve' : 'reject'}`, {
      method: 'POST', body: JSON.stringify({ adminNote }),
    });
  },
  async adminSetSubscription(id: string, action: 'activate' | 'extend' | 'suspend' | 'expire', durationDays = 30, planId?: string): Promise<User> {
    const data = await request<{ user: any }>(`/api/admin/users/${encodeURIComponent(id)}/subscription`, {
      method: 'PATCH', body: JSON.stringify({ action, durationDays, planId }),
    });
    return normalizeUser(data.user);
  },
  async adminTestGemini(): Promise<{ success: boolean; model: string; configuredKeys: number }> {
    return request<{ success: boolean; model: string; configuredKeys: number }>('/api/admin/ai-test', { method: 'POST', body: JSON.stringify({}) });
  },
  async cachedUser(): Promise<User | null> { return getCachedUser(); },
};
