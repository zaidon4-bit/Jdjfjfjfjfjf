import { Profile } from '../types';
import { store } from './store';
import { analyzeWithGemini, GeminiFailoverError } from './gemini';
import { isApiConfigured } from './api';
import { resolveSavedAnswerIndex } from './questionMemory';

export type QuestionType =
  | 'multiple_choice' | 'yes_no' | 'likert' | 'scale' | 'ranking' | 'open_text' | 'demographic';

export type AnalysisResult = {
  question: string;
  options: string[];
  questionType: QuestionType;
  suggestion: string;
  suggestionIndex: number;
  confidence: number;
  reason: string;
  engine: 'gemini' | 'local';
};

const LIKERT_WORDS = ['متفق', 'أوافق', 'راض', 'سعيد', 'مستوى', 'частот', 'Freq', 'strongly', 'agree', 'satisfied'];
const DEMO_WORDS = ['العمر', 'الجنس', 'الجنسية', 'البلد', 'المدينة', 'الدخل', 'المهنة', 'التعليم', 'الحالة الاجتماعية', 'عدد أفراد', 'age', 'gender', 'income', 'occupation', 'education', 'country', 'city'];
const YESNO = ['نعم', 'لا', 'Yes', 'No'];

function detectType(q: string, options: string[]): QuestionType {
  const t = q.toLowerCase();
  if (DEMO_WORDS.some((w) => t.includes(w.toLowerCase()))) return 'demographic';
  const norm = options.map((o) => o.trim().toLowerCase());
  if (norm.length === 2 && norm.every((o) => YESNO.map((y) => y.toLowerCase()).includes(o))) return 'yes_no';
  if (LIKERT_WORDS.some((w) => t.includes(w.toLowerCase()))) return 'likert';
  if (/\d+\s*[-–]\s*10|من \d+ إلى \d+|\b1\s*[-–]\s*5\b|scale/.test(t)) return 'scale';
  if (t.includes('رتّب') || t.includes('ترتيب') || t.includes('rank')) return 'ranking';
  if (options.length === 0) return 'open_text';
  return 'multiple_choice';
}

/** Match a demographic question to the stored profile field. */
function profileValueFor(q: string, p: Profile): string | null {
  const t = q.toLowerCase();
  const hit = (words: string[]) => words.some((w) => t.includes(w.toLowerCase()));
  if (hit(['عمرك', 'العمر', 'سنة ميلاد', 'age'])) return p.age;
  if (hit(['جنسك', 'نوعك', 'gender', 'sex'])) return p.gender;
  if (hit(['بلدك', 'البلد', 'الجنسية', 'country', 'nationality'])) return p.country;
  if (hit(['مدينتك', 'المدينة', 'city'])) return p.city;
  if (hit(['الحالة الاجتماعية', 'marital'])) return p.maritalStatus;
  if (hit(['المستوى التعليمي', 'التعليم', 'education'])) return p.education;
  if (hit(['مهنتك', 'المهنة', 'occupation', 'job'])) return p.occupation;
  if (hit(['دخلك', 'الدخل', 'income'])) return p.income;
  if (hit(['أفراد الأسرة', 'عدد الأبناء', 'household'])) return p.householdSize;
  if (hit(['أجهزة', 'devices'])) return p.devices;
  if (hit(['سيارة', 'car'])) return p.hasCar;
  if (hit(['اهتمامات', 'interests', 'هوايات'])) return p.interests;
  if (hit(['لغات', 'languages'])) return p.languages;
  return null;
}

function bestOptionFor(question: string, options: string[], profile: Profile): { index: number; reason: string } {
  const pv = profileValueFor(question, profile);
  if (pv) {
    const clean = pv.trim().toLowerCase();
    let idx = options.findIndex((o) => o.trim().toLowerCase() === clean);
    if (idx < 0) idx = options.findIndex((o) => o.trim().toLowerCase().includes(clean) || clean.includes(o.trim().toLowerCase()));
    if (idx >= 0) return { index: idx, reason: `مطابقة مباشرة مع ملفك الشخصي ("${pv}")` };
  }
  const t = question.toLowerCase();
  // car / devices / positives
  if (t.includes('سيارة') && options.length) {
    const has = options.findIndex((o) => o.includes('نعم'));
    if (has >= 0 && profile.hasCar.includes('نعم')) return { index: has, reason: 'ملفك يشير إلى امتلاك سيارة' };
  }
  if (t.includes('شراء') || t.includes('شراءً') || t.includes('تسوق') || t.includes('purchase')) {
    const idx = options.findIndex((o) => /بنعم|نعم|أكيد|بالتأكيد|دائما|أشتري/.test(o));
    if (idx >= 0) return { index: idx, reason: 'الخيارات الإيجابية تزيد من اتساق الاستجابات' };
  }
  // brand-ish questions: prefer mid options for balance
  if (options.length >= 3) {
    const mid = Math.floor(options.length / 2);
    return { index: mid, reason: 'خيار وسطي متوازن يحافظ على اتساق الاستبيان' };
  }
  return { index: 0, reason: 'الخيار الأكثر شيوعًا للمستخدمين في هذا السؤال' };
}

/** Parse raw OCR / pasted screen text into question + options. */
export function parseSurveyText(raw: string): { question: string; options: string[] } {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[•\-–*>]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  const qLine = lines[0] ?? raw.trim();
  const opts = lines.slice(1).filter((l) => l.length <= 80).slice(0, 10);
  return { question: qLine, options: opts };
}

function localAnalyze(question: string, options: string[], profile: Profile): AnalysisResult {
  const questionType = detectType(question, options);
  let suggestionIndex = 0;
  let reason = 'اقتراح افتراضي';
  let confidence = 0.62;

  if (questionType === 'yes_no' && options.length) {
    const affirmative = options.findIndex((option) => /^(نعم|yes|أجل|بالتأكيد)$/i.test(option.trim()));
    suggestionIndex = affirmative >= 0 ? affirmative : 0;
    reason = affirmative >= 0
      ? 'تم تحديد خيار الموافقة/نعم من بين الخيارات المتاحة كاقتراح افتراضي، وليس كحقيقة عن المستخدم'
      : 'اقتراح محلي افتراضي لأن Gemini غير متاح؛ راجع الإجابة قبل اختيارها';
    confidence = 0.55;
  } else if (questionType === 'likert' && options.length) {
    suggestionIndex = Math.min(1, options.length - 1);
    reason = 'الموافقة المتوسطة/القوية تُحسّن جودة البيانات المُعلَّنة';
    confidence = 0.68;
  } else if (questionType === 'demographic' && options.length) {
    const pv = profileValueFor(question, profile);
    const clean = (pv ?? '').trim().toLowerCase();
    const idx = options.findIndex((o) => o.trim().toLowerCase() === clean || (clean && o.trim().toLowerCase().includes(clean)));
    if (idx >= 0) {
      suggestionIndex = idx;
      reason = `مطابقة مع ملفك الشخصي ("${pv}")`;
      confidence = 0.93;
    } else {
      const b = bestOptionFor(question, options, profile);
      suggestionIndex = b.index; reason = b.reason; confidence = 0.6;
    }
  } else if (options.length) {
    const b = bestOptionFor(question, options, profile);
    suggestionIndex = b.index; reason = b.reason; confidence = 0.72;
  } else {
    suggestionIndex = -1;
    reason = 'سؤال مفتوح — اكتب إجابة مختصرة ومحايدة';
    confidence = 0.5;
  }

  return {
    question,
    options,
    questionType,
    suggestion: suggestionIndex >= 0 ? options[suggestionIndex] : '',
    suggestionIndex,
    confidence,
    reason,
    engine: 'local',
  };
}


export async function analyzeQuestion(
  rawText: string,
  profile: Profile,
  token: string,
): Promise<AnalysisResult> {
  const { question, options } = parseSurveyText(rawText);
  if (!question) throw new Error('لم يتم العثور على نص في الشاشة');

  // Saved answers take precedence over AI generation, regardless of backend status.
  // This is an exact normalized question + option-set match, never a fuzzy match.
  if (token) {
    const memory = await store.findExactMemory(token, question, options);
    if (memory) {
      const savedAnswer = memory.suggestion || (memory.suggestionIndex >= 0 ? memory.options[memory.suggestionIndex] : '');
      const savedIndex = resolveSavedAnswerIndex(options, savedAnswer);
      const canReuse = options.length === 0 || savedIndex >= 0 || !savedAnswer;
      if (canReuse) {
        return {
          question,
          options,
          questionType: memory.questionType as QuestionType,
          suggestion: savedIndex >= 0 ? options[savedIndex] : savedAnswer,
          suggestionIndex: savedIndex,
          confidence: memory.confidence,
          reason: 'إجابة ثابتة محفوظة على الجهاز؛ لم يُعَد توليدها بواسطة الذكاء الاصطناعي',
          engine: memory.engine,
        };
      }
    }
  }

  const backendConfigured = isApiConfigured();
  if (!backendConfigured) {
    const local = localAnalyze(question, options, profile);
    local.reason = `${local.reason}. لضبط Gemini، يجب نشر الخادم المركزي وإضافة EXPO_PUBLIC_API_BASE_URL إلى إعدادات البناء.`;
    return local;
  }

  try {
    const data = await analyzeWithGemini(question, options, profile);
    const validTypes: QuestionType[] = ['multiple_choice', 'yes_no', 'likert', 'scale', 'ranking', 'open_text', 'demographic'];
    const questionType = validTypes.includes(data.questionType as QuestionType)
      ? data.questionType as QuestionType
      : detectType(question, options);
    const suggestionIndex = options.length
      ? Math.max(0, Math.min(options.length - 1, data.suggestionIndex))
      : -1;
    return {
      question,
      options,
      questionType,
      suggestion: suggestionIndex >= 0 ? options[suggestionIndex] : String(data.suggestionText ?? ''),
      suggestionIndex,
      confidence: data.confidence ?? 0.85,
      reason: data.reason,
      engine: 'gemini',
    };
  } catch (error) {
    // Authentication, subscription, and quota responses must not silently fall back
    // to local analysis; doing so would bypass the server's access/usage limits.
    if (error instanceof GeminiFailoverError && [401, 402, 403, 429].includes(error.status || 0)) {
      throw error;
    }
    const local = localAnalyze(question, options, profile);
    const message = error instanceof GeminiFailoverError
      ? error.message
      : 'تعذّر قراءة استجابة Gemini. تم الرجوع للتحليل المحلي.';
    local.reason = `${local.reason}. ${message}`;
    return local;
  }
}
