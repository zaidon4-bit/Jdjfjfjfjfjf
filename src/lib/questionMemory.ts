import type { AnalysisRecord } from '../types';

/** Deterministic matching for saved survey answers. Deliberately avoids fuzzy matching. */
export function normalizeMemoryText(value: string): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '') // Arabic diacritics
    .replace(/\u0640/g, '') // tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىي]/g, (match) => match === 'ى' ? 'ي' : match)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function sameOptionSet(savedOptions: string[], currentOptions: string[]): boolean {
  if (savedOptions.length !== currentOptions.length) return false;
  const normalizeList = (options: string[]) => options.map(normalizeMemoryText).sort();
  const left = normalizeList(savedOptions);
  const right = normalizeList(currentOptions);
  return left.every((option, index) => option === right[index]);
}

/** Returns the matching current option index, or -1 when it cannot be mapped safely. */
export function resolveSavedAnswerIndex(options: string[], savedAnswer: string): number {
  if (!savedAnswer || options.length === 0) return -1;
  const key = normalizeMemoryText(savedAnswer);
  return options.findIndex((option) => normalizeMemoryText(option) === key);
}

export function sameQuestion(savedQuestion: string, currentQuestion: string): boolean {
  const left = normalizeMemoryText(savedQuestion);
  return left.length > 0 && left === normalizeMemoryText(currentQuestion);
}

export function findSavedMemory(
  entries: AnalysisRecord[],
  userId: string,
  question: string,
  options: string[],
): AnalysisRecord | null {
  return entries.find((record) =>
    record.userId === userId &&
    sameQuestion(record.question, question) &&
    sameOptionSet(record.options || [], options),
  ) ?? null;
}

export function addImmutableMemory(
  entries: AnalysisRecord[],
  record: AnalysisRecord,
): { entries: AnalysisRecord[]; saved: AnalysisRecord; inserted: boolean } {
  const existing = findSavedMemory(entries, record.userId, record.question, record.options || []);
  if (existing) return { entries, saved: existing, inserted: false };
  return { entries: [record, ...entries], saved: record, inserted: true };
}
