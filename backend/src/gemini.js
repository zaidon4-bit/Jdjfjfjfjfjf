const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const keys = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
  .split(/[\r\n,;]+/).map((v) => v.trim()).filter(Boolean).slice(0, 10);
const keyState = keys.map((key) => ({ key, disabledUntil: 0 }));
let nextIndex = 0;

function cooldownFor(status, message = '') {
  const msg = message.toLowerCase();
  if (/api.?key.?invalid|invalid api key|key not valid/.test(msg)) return 24 * 60 * 60 * 1000;
  if (status === 429 || /quota|resource_exhausted/.test(msg)) return 10 * 60 * 1000;
  if (status === 401 || status === 403) return 30 * 60 * 1000;
  if (status >= 500 || status === 408) return 30 * 1000;
  return 0;
}

function shouldRetry(status, message = '') {
  if (status === 400) return /api.?key.?invalid|invalid api key|key not valid|resource_exhausted|quota/.test(message.toLowerCase());
  return status === 401 || status === 403 || status === 404 || status === 408 || status === 429 || status >= 500 || status === 0;
}

export function getGeminiStatus() {
  const now = Date.now();
  const retryTimes = keyState.map((item) => item.disabledUntil).filter((until) => until > now);
  return {
    configured: keyState.length > 0,
    model: MODEL,
    totalKeys: keyState.length,
    availableKeys: keyState.filter((item) => item.disabledUntil <= now).length,
    nextRetryAt: retryTimes.length ? Math.min(...retryTimes) : null,
  };
}

async function callKey(entry, parts) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': entry.key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 700, responseMimeType: 'application/json' },
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!text) throw new Error('Gemini returned an empty response.');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateGemini(prompt) {
  return generateWithParts([{ text: prompt }]);
}

async function generateWithParts(parts) {
  const attempts = keyState.length
    ? keyState.map((_, offset) => keyState[(nextIndex + offset) % keyState.length]).filter((entry) => entry.disabledUntil <= Date.now())
    : [];
  if (!attempts.length) {
    const error = new Error(keyState.length ? 'All Gemini API keys are temporarily unavailable or quota-limited.' : 'No Gemini API keys configured on the server.');
    error.status = 503;
    throw error;
  }
  const failures = [];
  for (const entry of attempts) {
    try {
      const result = await callKey(entry, parts);
      entry.disabledUntil = 0;
      nextIndex = (keyState.indexOf(entry) + 1) % keyState.length;
      return result;
    } catch (error) {
      const status = Number(error?.status || 0);
      const message = String(error?.message || 'network_error');
      entry.disabledUntil = Date.now() + cooldownFor(status, message);
      failures.push({ status, message });
      nextIndex = (keyState.indexOf(entry) + 1) % keyState.length;
      if (!shouldRetry(status, message)) break;
    }
  }
  const last = failures[failures.length - 1];
  const err = new Error(last ? `Gemini failed for all usable keys (${last.status || 'network'}): ${last.message}` : 'Gemini failed.');
  err.status = last?.status || 503;
  throw err;
}

export async function analyzeWithGemini({ question, options, profile }) {
  if (typeof question !== 'string' || question.trim().length < 1 || question.length > 4000) {
    const error = new Error('Question must contain 1 to 4000 characters.'); error.status = 400; throw error;
  }
  const profileRules = {
    age: ['العمر', 'عمرك', 'عمري', 'فئة عمرية', 'سنة ميلاد', 'age', 'born'],
    gender: ['الجنس', 'جنسك', 'نوعك', 'gender', 'sex'],
    country: ['بلدك', 'البلد', 'الجنسية', 'جنسيّتك', 'country', 'nationality'],
    city: ['مدينتك', 'المدينة', 'city'],
    maritalStatus: ['الحالة الاجتماعية', 'متزوج', 'marital'],
    education: ['التعليم', 'تعليمي', 'المستوى الدراسي', 'المستوى التعليمي', 'education'],
    occupation: ['المهنة', 'مهنتك', 'الوظيفة', 'عملك', 'occupation', 'job'],
    income: ['الدخل', 'دخلك', 'راتب', 'income', 'salary'],
    householdSize: ['عدد أفراد الأسرة', 'أفراد أسرتك', 'حجم الأسرة', 'household'],
    devices: ['الأجهزة التي تستخدمها', 'الأجهزة', 'devices'],
    hasCar: ['سيارة', 'تملك سيارة', 'car'],
    interests: ['الاهتمامات', 'اهتماماتك', 'الهوايات', 'hobbies', 'interests'],
    languages: ['اللغات', 'لغاتك', 'languages'],
  };
  const normalizedQuestion = question.toLowerCase();
  const safeProfile = {};
  if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
    for (const [field, markers] of Object.entries(profileRules)) {
      if (!markers.some((marker) => normalizedQuestion.includes(marker.toLowerCase()))) continue;
      const value = profile[field];
      if (value == null || value === '') continue;
      const maxLength = field === 'interests' ? 150 : field === 'languages' || field === 'devices' ? 80 : 40;
      safeProfile[field] = String(value).slice(0, maxLength);
    }
  }
  const cleanOptions = Array.isArray(options) ? options.slice(0, 20).map((v) => String(v).slice(0, 200)) : [];
  const prompt = [
    'حلّل سؤال الاستبيان واقترح إجابة متسقة مع المعلومات المعطاة فقط. لا تخترع حقائق شخصية.',
    'أجب JSON فقط بالشكل: {"suggestionIndex":0,"suggestionText":"","reason":"سبب قصير بالعربية","questionType":"multiple_choice","confidence":0.0}.',
    'suggestionIndex رقم يبدأ من الصفر. إذا لم توجد خيارات وكان السؤال مفتوحًا، استخدم -1 واكتب مسودة عربية قصيرة في suggestionText فقط إذا كانت مدعومة بنص السؤال والملف الشخصي المتاح.',
    'لا تخترع تجربة شخصية أو رأيًا أو مشتريات أو حقيقة غير معروفة عن المستخدم. إذا احتاج السؤال معلومة شخصية غير موجودة، اجعل suggestionText فارغًا واشرح في reason ما يحتاج المستخدم إلى إدخاله بنفسه.',
    `السؤال: ${question.trim()}`,
    `الخيارات: ${JSON.stringify(cleanOptions)}`,
    `الحقول الشخصية اللازمة فقط: ${JSON.stringify(safeProfile)}`,
    'أنواع السؤال المسموحة: multiple_choice, yes_no, likert, scale, ranking, open_text, demographic.',
  ].join('\n');
  const raw = await generateGemini(prompt);
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) { const e = new Error('Gemini returned invalid JSON.'); e.status = 502; throw e; }
  let result;
  try { result = JSON.parse(cleaned.slice(start, end + 1)); } catch { const e = new Error('Gemini returned invalid JSON.'); e.status = 502; throw e; }
  if (!Number.isInteger(result.suggestionIndex) || typeof result.reason !== 'string') { const e = new Error('Gemini JSON does not match the expected schema.'); e.status = 502; throw e; }
  return {
    suggestionIndex: cleanOptions.length ? Math.max(0, Math.min(cleanOptions.length - 1, result.suggestionIndex)) : -1,
    reason: result.reason.slice(0, 1000),
    suggestionText: typeof result.suggestionText === 'string' ? result.suggestionText.slice(0, 1000) : '',
    questionType: typeof result.questionType === 'string' ? result.questionType : (cleanOptions.length ? 'multiple_choice' : 'open_text'),
    confidence: typeof result.confidence === 'number' ? Math.max(0, Math.min(1, result.confidence)) : 0.8,
  };
}

export async function testGemini() {
  const raw = await generateGemini('أرجع JSON فقط: {"ok":true}.');
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const result = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
  if (result.ok !== true) throw new Error('Gemini test returned an unexpected response.');
  return true;
}


/**
 * Image-to-text extraction for survey screenshots. The image is passed inline to
 * Gemini only for this request; this API does not write the image to disk/database.
 */
export async function extractSurveyFromImage({ imageBase64, mimeType }) {
  if (typeof imageBase64 !== 'string' || imageBase64.length < 100) {
    const error = new Error('الصورة فارغة أو غير صالحة.'); error.status = 400; throw error;
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    const error = new Error('صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WebP.'); error.status = 400; throw error;
  }
  const prompt = [
    'استخرج نص سؤال استبيان وخيارات الإجابة الظاهرة في الصورة كما هي، مع الحفاظ على ترتيب القراءة.',
    'لا تجب عن السؤال ولا تختر خيارًا، ولا تخمن الكلمات غير المقروءة. تجاهل عناصر الشاشة غير المتعلقة بالسؤال.',
    'أرجع JSON فقط بهذا الشكل: {"question":"نص السؤال","options":["الخيار الأول","الخيار الثاني"],"extractedText":"السؤال\\nالخيار الأول\\nالخيار الثاني"}.',
    'إذا لم تجد سؤالًا واضحًا، اجعل question سلسلة فارغة وoptions مصفوفة فارغة، واذكر في extractedText ما استطعت قراءته فقط.',
    'question لا يتجاوز 1000 حرف، والخيارات بحد أقصى 20 خيارًا، وكل خيار بحد أقصى 200 حرف.',
  ].join('\n');
  const raw = await generateWithParts([
    { text: prompt },
    { inlineData: { mimeType, data: imageBase64 } },
  ]);
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) { const error = new Error('تعذّر استخراج نص من الصورة. جرّب صورة أوضح.'); error.status = 502; throw error; }
  let parsed;
  try { parsed = JSON.parse(cleaned.slice(start, end + 1)); }
  catch { const error = new Error('استجابة استخراج النص غير صالحة. جرّب مرة أخرى.'); error.status = 502; throw error; }
  const question = typeof parsed.question === 'string' ? parsed.question.trim().slice(0, 1000) : '';
  const options = Array.isArray(parsed.options)
    ? parsed.options.filter((option) => typeof option === 'string').slice(0, 20).map((option) => option.trim().slice(0, 200)).filter(Boolean)
    : [];
  const structuredText = [question, ...options].filter(Boolean).join('\n').slice(0, 4000);
  const fallbackText = typeof parsed.extractedText === 'string' ? parsed.extractedText.trim().slice(0, 4000) : '';
  const extractedText = structuredText || fallbackText;
  if (!extractedText) { const error = new Error('لم أتمكن من قراءة سؤال واضح. قرّب السؤال والتقط الصورة من جديد.'); error.status = 422; throw error; }
  return { question, options, extractedText };
}
