import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { AnalysisRecord, Profile, User } from '../types';
import { api } from './api';
import { addImmutableMemory, findSavedMemory } from './questionMemory';

// Authentication and subscription state are server-authoritative. Only survey history,
// question memory, and preferences remain on this device.
const K_ANALYSIS = 'sai.analysis.v1';
const K_SETTINGS = 'sai.settings.v1';
const K_MEMORY = 'sai.memory.v1';
const MEMORY_FILE_NAME = 'survey-ai-answer-memory.json';
const MEMORY_FILE_URI = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}${MEMORY_FILE_NAME}` : null;

async function read<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
async function write(key: string, value: unknown) { await AsyncStorage.setItem(key, JSON.stringify(value)); }

export const store = {
  async init() {},

  async register(username: string, password: string): Promise<User> {
    return api.register(username, password);
  },
  async login(username: string, password: string): Promise<User> {
    return api.login(username, password);
  },
  async session(): Promise<User | null> {
    try { return await api.session(); } catch (error) {
      if ((error as Error)?.message?.includes('جلسة غير صالحة') || (error as Error)?.message?.includes('انتهت صلاحية الجلسة')) return null;
      throw error;
    }
  },
  async logout() { await api.logout(); },

  async users(): Promise<User[]> { return (await api.adminDashboard()).users; },

  async updateUser(id: string, patch: Partial<User>): Promise<User[]> {
    let action: 'activate' | 'extend' | 'suspend' | 'expire';
    if (patch.status === 'suspended') action = 'suspend';
    else if (patch.status === 'expired') action = 'expire';
    else if (patch.status === 'active') action = patch.subscriptionStart ? 'activate' : 'extend';
    else throw new Error('إجراء تحديث الاشتراك غير مدعوم.');
    await api.adminSetSubscription(id, action, 30, patch.planId ?? undefined);
    return this.users();
  },

  async updateProfile(id: string, profile: Profile): Promise<User[]> {
    const updated = await api.updateProfile(profile);
    return [updated];
  },

  async analyses(): Promise<AnalysisRecord[]> { return read<AnalysisRecord[]>(K_ANALYSIS, []); },
  async addAnalysis(rec: AnalysisRecord) {
    const all = await read<AnalysisRecord[]>(K_ANALYSIS, []);
    all.unshift(rec);
    await write(K_ANALYSIS, all.slice(0, 500));
  },
  async memory(): Promise<AnalysisRecord[]> {
    // The JSON file is the portable, on-device memory source. AsyncStorage remains a
    // secondary copy and migration path so existing installations keep their memory.
    if (MEMORY_FILE_URI) {
      try {
        const info = await FileSystem.getInfoAsync(MEMORY_FILE_URI);
        if (info.exists) {
          const raw = await FileSystem.readAsStringAsync(MEMORY_FILE_URI);
          const parsed = JSON.parse(raw);
          const entries = Array.isArray(parsed) ? parsed : parsed.entries;
          if (Array.isArray(entries)) {
            await write(K_MEMORY, entries);
            return entries as AnalysisRecord[];
          }
        }
      } catch {
        // Fall back to the secondary local copy if the JSON file is missing or unreadable.
      }
    }
    const legacyEntries = await read<AnalysisRecord[]>(K_MEMORY, []);
    // Migrate pre-existing AsyncStorage memory into the JSON file the first time it is read.
    if (MEMORY_FILE_URI && legacyEntries.length) {
      try {
        await FileSystem.writeAsStringAsync(MEMORY_FILE_URI, JSON.stringify({
          schemaVersion: 1,
          updatedAt: Date.now(),
          entries: legacyEntries,
        }, null, 2));
      } catch (error) {
        console.warn('Could not migrate the local answer-memory JSON file', error);
      }
    }
    return legacyEntries;
  },
  async persistMemory(entries: AnalysisRecord[]) {
    const limited = entries.slice(0, 1000);
    await write(K_MEMORY, limited);
    if (MEMORY_FILE_URI) {
      try {
        await FileSystem.writeAsStringAsync(MEMORY_FILE_URI, JSON.stringify({
          schemaVersion: 1,
          updatedAt: Date.now(),
          entries: limited,
        }, null, 2));
      } catch (error) {
        // AsyncStorage still preserves answers if a device filesystem operation fails.
        console.warn('Could not update the local answer-memory JSON file', error);
      }
    }
  },
  async findExactMemory(userId: string, question: string, options: string[] = []): Promise<AnalysisRecord | null> {
    const all = await this.memory();
    // Exact normalized question + identical option set only: no fuzzy matches.
    return findSavedMemory(all, userId, question, options);
  },
  async saveMemory(rec: AnalysisRecord): Promise<AnalysisRecord> {
    const all = await this.memory();
    // A saved answer is immutable by default. Deleting it is required before saving a replacement.
    const outcome = addImmutableMemory(all, rec);
    if (outcome.inserted) await this.persistMemory(outcome.entries);
    return outcome.saved;
  },
  async deleteMemory(userId: string, id: string) {
    const all = await this.memory();
    await this.persistMemory(all.filter((item) => !(item.userId === userId && item.id === id)));
  },
  async exportMemoryFile(userId: string): Promise<void> {
    const entries = (await this.memory()).filter((item) => item.userId === userId);
    if (!entries.length) throw new Error('لا توجد إجابات محفوظة لتصديرها.');
    if (!FileSystem.cacheDirectory) throw new Error('تصدير الملفات غير متاح على هذا الجهاز.');
    const uri = `${FileSystem.cacheDirectory}survey-ai-answer-memory-${Date.now()}.json`;
    await FileSystem.writeAsStringAsync(uri, JSON.stringify({
      app: 'Survey AI Assistant',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      entries,
    }, null, 2));
    if (!(await Sharing.isAvailableAsync())) throw new Error('مشاركة الملفات غير متاحة على هذا الجهاز.');
    await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'تصدير ذاكرة الإجابات المحفوظة' });
  },
  async deleteAnalysis(id: string) {
    const all = await read<AnalysisRecord[]>(K_ANALYSIS, []);
    await write(K_ANALYSIS, all.filter((a) => a.id !== id));
  },
  async clearAnalyses(userId: string) {
    const all = await read<AnalysisRecord[]>(K_ANALYSIS, []);
    await write(K_ANALYSIS, all.filter((a) => a.userId !== userId));
    const memory = await this.memory();
    await this.persistMemory(memory.filter((a) => a.userId !== userId));
  },
  async settings(): Promise<{ autoAnalyze: boolean; keepScreens: boolean; ocr: boolean }> {
    return read(K_SETTINGS, { autoAnalyze: true, keepScreens: false, ocr: true });
  },
  async saveSettings(s: { autoAnalyze: boolean; keepScreens: boolean; ocr: boolean }) { await write(K_SETTINGS, s); },
  async refreshSubscription(_user: User): Promise<User> { return api.subscription(); },
  isSubscriptionActive(u: User): boolean { return u.status === 'active' && !!u.subscriptionEnd && u.subscriptionEnd > Date.now(); },
};
