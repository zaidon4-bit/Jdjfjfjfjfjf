import { Profile } from '../types';
import { api, ApiError } from './api';

export type GeminiAnalysis = {
  suggestionIndex: number;
  suggestionText: string;
  reason: string;
  questionType?: string;
  confidence?: number;
};

export class GeminiFailoverError extends Error {
  status?: number;
  constructor(message: string, status?: number) { super(message); this.name = 'GeminiFailoverError'; this.status = status; }
}

/** Gemini keys live only on the central server; the mobile app sends the question and gets the result. */
export async function analyzeWithGemini(question: string, options: string[], profile: Profile): Promise<GeminiAnalysis> {
  try {
    const result = await api.analyze(question, options, profile);
    return {
      suggestionIndex: Number(result.suggestionIndex),
      suggestionText: String(result.suggestionText || ''),
      reason: String(result.reason || ''),
      questionType: result.questionType,
      confidence: typeof result.confidence === 'number' ? Math.max(0, Math.min(1, result.confidence)) : undefined,
    };
  } catch (error) {
    throw new GeminiFailoverError((error as Error)?.message || 'تعذّر الاتصال بخادم Gemini.', error instanceof ApiError ? error.status : undefined);
  }
}

export async function testGeminiConnection(): Promise<void> {
  try {
    await api.adminTestGemini();
  } catch (error) {
    throw new GeminiFailoverError((error as Error)?.message || 'فشل اختبار اتصال Gemini.');
  }
}
