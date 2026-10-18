const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_BASE64_CHARS = 5_600_000;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function inputError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Validate size, Base64 shape, and file magic before a screenshot is forwarded to Gemini. */
export function validateSurveyImagePayload(imageBase64, mimeType) {
  const normalizedMime = String(mimeType || '').toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
    throw inputError(400, 'صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WebP.');
  }
  if (typeof imageBase64 !== 'string' || imageBase64.length < 100 || imageBase64.length > MAX_BASE64_CHARS ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64) || imageBase64.length % 4 !== 0) {
    throw inputError(400, 'حجم الصورة أو تنسيق Base64 غير صالح. اختر صورة أصغر.');
  }

  const imageBuffer = Buffer.from(imageBase64, 'base64');
  if (imageBuffer.length < 100 || imageBuffer.length > MAX_IMAGE_BYTES) {
    throw inputError(413, 'حجم الصورة كبير. اختر صورة أقل من 4 ميغابايت.');
  }
  const signatureMatches = normalizedMime === 'image/jpeg'
    ? imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8 && imageBuffer[2] === 0xff
    : normalizedMime === 'image/png'
      ? imageBuffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : imageBuffer.subarray(0, 4).toString('ascii') === 'RIFF' && imageBuffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!signatureMatches) {
    throw inputError(400, 'محتوى الصورة لا يطابق صيغة الملف المعلنة. اختر صورة JPG أو PNG أو WebP صحيحة.');
  }
  return { imageBase64, mimeType: normalizedMime, byteLength: imageBuffer.length };
}
