import test from 'node:test';
import assert from 'node:assert/strict';

function mockSuccess(text) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

test('retries with the next key after a quota error', async () => {
  process.env.GEMINI_API_KEYS = 'key-one,key-two';
  process.env.GEMINI_MODEL = 'test-model';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, key: options.headers['x-goog-api-key'], body: JSON.parse(options.body) });
    if (options.headers['x-goog-api-key'] === 'key-one') {
      return new Response(JSON.stringify({ error: { message: 'RESOURCE_EXHAUSTED: quota exceeded' } }), {
        status: 429, headers: { 'content-type': 'application/json' },
      });
    }
    return mockSuccess('{"ok":true}');
  };
  const mod = await import('../src/gemini.js?quota-rotation-test');
  const response = await mod.generateGemini('test prompt');
  assert.equal(response, '{"ok":true}');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].key, 'key-one');
  assert.equal(calls[1].key, 'key-two');
  assert.equal(mod.getGeminiStatus().availableKeys, 1);
});

test('extracts survey text through multimodal inlineData and does not save the image', async () => {
  process.env.GEMINI_API_KEYS = 'ocr-test-key';
  process.env.GEMINI_MODEL = 'test-vision-model';
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return mockSuccess('{"question":"ما فئتك العمرية؟","options":["أقل من 25","25-34"],"extractedText":"ما فئتك العمرية؟\\nأقل من 25\\n25-34"}');
  };
  const mod = await import('../src/gemini.js?vision-test');
  const result = await mod.extractSurveyFromImage({ imageBase64: 'A'.repeat(120), mimeType: 'image/jpeg' });
  assert.equal(result.question, 'ما فئتك العمرية؟');
  assert.deepEqual(result.options, ['أقل من 25', '25-34']);
  assert.equal(requestBody.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
  assert.equal(requestBody.contents[0].parts[1].inlineData.data, 'A'.repeat(120));
  assert.equal('image' in result, false);
});

test('rejects unsupported image formats before calling Gemini', async () => {
  process.env.GEMINI_API_KEYS = 'unused-key';
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('must not be called'); };
  const mod = await import('../src/gemini.js?invalid-mime-test');
  await assert.rejects(() => mod.extractSurveyFromImage({ imageBase64: 'A'.repeat(120), mimeType: 'image/svg+xml' }), { status: 400 });
  assert.equal(called, false);
});

test('uses OCR plain-text fallback if the model cannot split question and options', async () => {
  process.env.GEMINI_API_KEYS = 'fallback-ocr-key';
  process.env.GEMINI_MODEL = 'fallback-test-model';
  globalThis.fetch = async () => mockSuccess('{"question":"","options":[],"extractedText":"ما لون المنتج؟\\nأحمر\\nأزرق"}');
  const mod = await import('../src/gemini.js?vision-text-fallback-test');
  const result = await mod.extractSurveyFromImage({ imageBase64: 'A'.repeat(120), mimeType: 'image/png' });
  assert.equal(result.question, '');
  assert.deepEqual(result.options, []);
  assert.equal(result.extractedText, 'ما لون المنتج؟\nأحمر\nأزرق');
});


test('sends only the profile field relevant to the question to Gemini', async () => {
  process.env.GEMINI_API_KEYS = 'privacy-test-key';
  process.env.GEMINI_MODEL = 'privacy-test-model';
  let prompt = '';
  globalThis.fetch = async (_url, options) => {
    prompt = JSON.parse(options.body).contents[0].parts[0].text;
    return mockSuccess('{"suggestionIndex":0,"reason":"حسب المعلومات المسجلة","questionType":"demographic","confidence":0.9}');
  };
  const mod = await import('../src/gemini.js?profile-minimization-test');
  await mod.analyzeWithGemini({
    question: 'كم عمرك؟', options: ['18-25', '26-35'],
    profile: { age: '27', country: 'Poland', fullName: 'DO_NOT_SEND_NAME', other: 'DO_NOT_SEND_NOTE' },
  });
  assert.match(prompt, /\"age\":\"27\"/);
  assert.doesNotMatch(prompt, /Poland|DO_NOT_SEND_NAME|DO_NOT_SEND_NOTE|country/);
});


test('returns an editable text draft for an open question without inventing profile facts', async () => {
  process.env.GEMINI_API_KEYS = 'open-text-test-key';
  process.env.GEMINI_MODEL = 'open-text-test-model';
  let prompt = '';
  globalThis.fetch = async (_url, options) => {
    prompt = JSON.parse(options.body).contents[0].parts[0].text;
    return mockSuccess('{"suggestionIndex":-1,"suggestionText":"أفضّل إجابة واضحة وسهلة الاستخدام.","reason":"مسودة عامة قابلة للتعديل","questionType":"open_text","confidence":0.7}');
  };
  const mod = await import('../src/gemini.js?open-text-draft-test');
  const result = await mod.analyzeWithGemini({ question: 'ما الذي يجعل المنتج سهل الاستخدام؟', options: [], profile: {} });
  assert.equal(result.suggestionIndex, -1);
  assert.equal(result.suggestionText, 'أفضّل إجابة واضحة وسهلة الاستخدام.');
  assert.match(prompt, /لا تخترع تجربة شخصية/);
});

test('validates supported image payload signatures before upstream processing', async () => {
  const { validateSurveyImagePayload } = await import('../src/imageValidation.js');
  const jpeg = Buffer.alloc(120, 0x20); jpeg[0] = 0xff; jpeg[1] = 0xd8; jpeg[2] = 0xff;
  const good = validateSurveyImagePayload(jpeg.toString('base64'), 'image/jpeg');
  assert.equal(good.mimeType, 'image/jpeg');
  assert.equal(good.byteLength, 120);
  assert.throws(() => validateSurveyImagePayload(jpeg.toString('base64'), 'image/png'), { status: 400 });
  assert.throws(() => validateSurveyImagePayload(jpeg.toString('base64'), 'image/svg+xml'), { status: 400 });
});
