import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addImmutableMemory,
  findSavedMemory,
  normalizeMemoryText,
  resolveSavedAnswerIndex,
  sameOptionSet,
  sameQuestion,
} from '../src/lib/questionMemory.ts';

test('question matching normalizes Arabic punctuation, diacritics, and whitespace', () => {
  assert.equal(sameQuestion('مَا فئة عمرية تنتمي إليها؟', 'ما فئة عمرية تنتمي اليها'), true);
});

test('question matching does not use fuzzy similarity or remove meaningful negation', () => {
  assert.equal(sameQuestion('هل تملك سيارة؟', 'هل لا تملك سيارة؟'), false);
  assert.equal(sameQuestion('ما لون المنتج؟', 'ما نوع المنتج؟'), false);
});

test('option comparison allows a different order but requires the same option labels', () => {
  assert.equal(sameOptionSet(['أحمر', 'أزرق', 'أخضر'], ['أخضر', 'أحمر', 'أزرق']), true);
  assert.equal(sameOptionSet(['نعم', 'لا'], ['نعم', 'ربما']), false);
  assert.equal(sameOptionSet([], []), true);
});

test('saved option answer maps to the same label after options are reordered', () => {
  assert.equal(resolveSavedAnswerIndex(['أزرق', 'أحمر', 'أخضر'], 'أحمر'), 1);
  assert.equal(resolveSavedAnswerIndex(['أزرق', 'أحمر'], 'نعم'), -1);
});

test('normalizer produces stable non-empty keys for real questions', () => {
  assert.equal(normalizeMemoryText('  هل تفضّل القهوة؟ '), 'هل تفضل القهوة');
  assert.equal(normalizeMemoryText(' !!! '), '');
});

test('a saved answer for the same normalized question and options is immutable', () => {
  const original = {
    id: 'saved-one', userId: 'user-1', question: 'ما لون المنتج؟', options: ['أحمر', 'أزرق'],
    questionType: 'multiple_choice', suggestion: 'أزرق', suggestionIndex: 1,
    confidence: 0.9, engine: 'gemini', createdAt: 10,
  };
  const candidate = { ...original, id: 'saved-two', suggestion: 'أحمر', suggestionIndex: 0, createdAt: 20 };
  const result = addImmutableMemory([original], candidate);
  assert.equal(result.inserted, false);
  assert.equal(result.saved.id, 'saved-one');
  assert.equal(result.saved.suggestion, 'أزرق');
  assert.equal(result.entries.length, 1);
  assert.equal(findSavedMemory([original], 'user-1', 'ما لون المنتج', ['أزرق', 'أحمر'])?.suggestion, 'أزرق');
});
