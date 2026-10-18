import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View, TextInput } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { AppButton, Card, Row, SectionTitle } from '../components/ui';
import { AnalysisResult, analyzeQuestion, parseSurveyText } from '../lib/engine';
import { resolveSavedAnswerIndex } from '../lib/questionMemory';
import { store } from '../lib/store';
import { api, isApiConfigured } from '../lib/api';
import { colors, radius, shadow, spacing } from '../theme';
import { AnalysisRecord, User } from '../types';

const SAMPLES = [
  'ما فئة عمرية تنتمي إليها؟\nأقل من 25\n25 - 34\n35 - 44\n45 - 54\n55 فأكثر',
  'ما هو مستوى تعليمك؟\nثانوي أو أقل\nدبلوم\nبكالوريوس\nدراسات عليا',
  'هل تملك سيارة؟\nنعم\nلا',
  'ما مدى رضاك عن تجربة التسوق الإلكترونية؟\nغير راضٍ\nمحايد\nراضٍ\nراضٍ جدًا',
  'كم مرة تستخدم التطبيقات المالية أسبوعيًا؟\n1 - 3\n4 - 6\nأكثر من 7',
];

export default function AnalyzeScreen({ user, onUserChange, onNavigate }: { user: User; onUserChange: (u: User) => void; onNavigate: (r: string) => void }) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fromMemory, setFromMemory] = useState(false);
  const [memorySaved, setMemorySaved] = useState(false);
  const [memorySaveBusy, setMemorySaveBusy] = useState(false);
  const [textAnswerDraft, setTextAnswerDraft] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [ocrEnabled, setOcrEnabled] = useState(true);

  useEffect(() => {
    store.settings().then((settings) => setOcrEnabled(settings.ocr)).catch(() => setOcrEnabled(true));
  }, []);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - t0), 100);
    return () => clearInterval(id);
  }, [busy]);

  const extractFromImage = async (useCamera: boolean) => {
    setError(''); setNotice('');
    if (!isApiConfigured()) {
      setError('استخراج النص من الصور يحتاج الخادم المركزي. انشر backend واضبط EXPO_PUBLIC_API_BASE_URL أولًا.');
      return;
    }
    let verifiedUser: User;
    try {
      verifiedUser = await store.refreshSubscription(user);
      onUserChange(verifiedUser);
    } catch (e) {
      setError((e as Error)?.message || 'تعذّر التحقق من الاشتراك.');
      return;
    }
    if (verifiedUser.role !== 'admin' && !store.isSubscriptionActive(verifiedUser)) {
      onNavigate('Subscription');
      return;
    }

    try {
      const pickerOptions: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'], allowsEditing: false, quality: 0.85, base64: false, exif: false,
      };
      if (useCamera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setError('صلاحية الكاميرا غير مفعّلة. اسمح باستخدام الكاميرا من إعدادات Android أو اختر صورة من المعرض.');
          return;
        }
      }
      const picked = useCamera
        ? await ImagePicker.launchCameraAsync(pickerOptions)
        : await ImagePicker.launchImageLibraryAsync(pickerOptions);
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      setImageUri(asset.uri);
      setOcrBusy(true);
      const targetWidth = Math.min(asset.width || 1600, 1600);
      const optimized = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: targetWidth } }],
        { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!optimized.base64) throw new Error('تعذّر تجهيز الصورة. جرّب صورة أخرى.');
      if (optimized.base64.length > 5_500_000) throw new Error('الصورة كبيرة بعد الضغط. قصّ السؤال فقط ثم أعد المحاولة.');
      const extracted = await api.extractSurveyFromImage(optimized.base64, 'image/jpeg');
      if (!extracted.extractedText.trim()) throw new Error('لم يتم العثور على نص واضح. قرّب السؤال وصوّر الصورة من جديد.');
      setText(extracted.extractedText);
      setResult(null);
      setNotice(`تم استخراج السؤال و${extracted.options.length} خيارًا. راجع النص وعدّله قبل التحليل.`);
    } catch (e) {
      setError((e as Error)?.message || 'تعذّر استخراج النص من الصورة.');
    } finally {
      setOcrBusy(false);
    }
  };

  const run = async (source?: string) => {
    const raw = source ?? text;
    if (!raw.trim()) { setError('التقط شاشة الاستبيان أو الصق نص السؤال أولًا'); return; }
    setError(''); setBusy(true); setResult(null); setFromMemory(false); setMemorySaved(false);
    const started = Date.now();
    try {
      const parsedInput = parseSurveyText(raw);
      // Resolve fixed answers before contacting the subscription/Gemini server. Saved local
      // answers therefore remain usable without network access or AI quota.
      const memory = await store.findExactMemory(user.id, parsedInput.question, parsedInput.options);
      if (memory) {
        const savedAnswer = memory.suggestion || (memory.suggestionIndex >= 0 ? memory.options[memory.suggestionIndex] : '');
        const savedIndex = resolveSavedAnswerIndex(parsedInput.options, savedAnswer);
        const canReuse = parsedInput.options.length === 0 || savedIndex >= 0 || !savedAnswer;
        if (canReuse) {
          const cached: AnalysisResult = {
            question: parsedInput.question,
            options: parsedInput.options,
            questionType: memory.questionType as any,
            suggestion: savedIndex >= 0 ? parsedInput.options[savedIndex] : savedAnswer,
            suggestionIndex: savedIndex,
            confidence: memory.confidence,
            reason: 'إجابة ثابتة محفوظة على الجهاز؛ تم إرجاعها كما حُفظت دون طلب جواب جديد من Gemini',
            engine: memory.engine,
          };
          setResult(cached); setFromMemory(true); setMemorySaved(true); setTextAnswerDraft(savedAnswer);
          await new Promise((r) => setTimeout(r, 200));
          return;
        }
      }

      let verifiedUser = user;
      try {
        verifiedUser = await store.refreshSubscription(user);
        onUserChange(verifiedUser);
      } catch (e) {
        throw new Error((e as Error)?.message || 'تعذّر التحقق من الاشتراك عبر الخادم.');
      }
      if (verifiedUser.role !== 'admin' && !store.isSubscriptionActive(verifiedUser)) {
        onNavigate('Subscription');
        return;
      }

      const res = await analyzeQuestion(raw, verifiedUser.profile, verifiedUser.id);
      await new Promise((r) => setTimeout(r, Math.max(400, 900 - (Date.now() - started))));
      setResult(res);
      setTextAnswerDraft(res.suggestion || '');
      const rec: AnalysisRecord = {
        id: 'an_' + Date.now().toString(36),
        userId: user.id,
        question: res.question,
        options: res.options,
        questionType: res.questionType,
        suggestion: res.suggestion,
        suggestionIndex: res.suggestionIndex,
        confidence: Math.round(res.confidence * 100) / 100,
        engine: res.engine,
        createdAt: Date.now(),
      };
      await store.addAnalysis(rec);
    } catch (e: any) {
      setError(e?.message ?? 'تعذّر تحليل السؤال');
    } finally {
      setBusy(false);
    }
  };

  const saveCurrentAnswerToMemory = async () => {
    if (!result || memorySaved) return;
    if (result.options.length === 0 && !textAnswerDraft.trim()) {
      setError('اكتب الإجابة النصية أو عدّل المسودة أولًا، ثم احفظها.');
      return;
    }
    setMemorySaveBusy(true);
    setError('');
    try {
      const rec: AnalysisRecord = {
        id: 'mem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
        userId: user.id,
        question: result.question,
        options: result.options,
        questionType: result.questionType,
        suggestion: result.options.length ? result.suggestion : textAnswerDraft.trim(),
        suggestionIndex: result.suggestionIndex,
        confidence: Math.round(result.confidence * 100) / 100,
        engine: result.engine,
        createdAt: Date.now(),
      };
      const saved = await store.saveMemory(rec);
      const savedIndex = resolveSavedAnswerIndex(result.options, saved.suggestion || (saved.suggestionIndex >= 0 ? saved.options[saved.suggestionIndex] : ''));
      const fixedResult: AnalysisResult = {
        question: saved.question,
        options: result.options,
        questionType: saved.questionType as AnalysisResult['questionType'],
        suggestion: savedIndex >= 0 ? result.options[savedIndex] : (saved.suggestion || textAnswerDraft.trim()),
        suggestionIndex: savedIndex,
        confidence: saved.confidence,
        reason: 'إجابة ثابتة محفوظة على الجهاز؛ لن يعاد توليدها عند تكرار السؤال نفسه والخيارات نفسها',
        engine: saved.engine,
      };
      setResult(fixedResult);
      setTextAnswerDraft(fixedResult.suggestion);
      setFromMemory(true);
      setMemorySaved(true);
      setNotice('تم حفظ الإجابة الثابتة محليًا. عند تكرار السؤال نفسه مع الخيارات نفسها ستظهر الإجابة المحفوظة.');
    } catch (e) {
      setError((e as Error)?.message || 'تعذّر حفظ الإجابة في الذاكرة.');
    } finally {
      setMemorySaveBusy(false);
    }
  };

  const typeLabel: Record<string, string> = {
    multiple_choice: 'اختيار من متعدد', yes_no: 'نعم / لا', likert: 'مقياس ليكرت',
    scale: 'مقياس رقمي', ranking: 'ترتيب', open_text: 'إجابة مفتوحة',
    demographic: 'معطيات شخصية',
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, paddingBottom: 110 }} keyboardShouldPersistTaps="handled">
      <Card>
        <SectionTitle title="التقاط وتحليل سؤال" icon="scan" />
        <Text style={styles.desc}>صوّر سؤال الاستبيان أو اختر صورة من المعرض. يستخرج Gemini النص وخيارات الإجابة، ثم يمكنك مراجعتها وتعديلها قبل التحليل.</Text>
        <Row style={{ gap: spacing.sm, marginTop: spacing.md }}>
          <AppButton title="تصوير السؤال" icon="camera-outline" onPress={() => extractFromImage(true)} loading={ocrBusy} disabled={busy || ocrBusy || !ocrEnabled} style={{ flex: 1 }} />
          <AppButton title="اختيار صورة" icon="image-outline" variant="soft" onPress={() => extractFromImage(false)} loading={ocrBusy} disabled={busy || ocrBusy || !ocrEnabled} style={{ flex: 1 }} />
        </Row>
        {imageUri ? <View style={styles.imageReview}><Image source={{ uri: imageUri }} style={styles.previewImage} resizeMode="contain" /><Text style={styles.imageCaption}>معاينة مؤقتة للصورة المحددة</Text></View> : null}
        <Text style={styles.privacyNotice}>للخصوصية: تُضغط الصورة على الجهاز ثم تُرسل إلى خادم التطبيق وGoogle Gemini لاستخراج النص. لا يحفظ التطبيق الصورة في قاعدة بياناته، لكن معالجة الصورة تتم عبر خدمة Gemini. يُحتسب استخراج الصورة وتحليل السؤال كطلبين منفصلين من حصة الاستخدام اليومي.</Text>
        <Row style={{ gap: spacing.md, marginTop: spacing.md }}>
          <AppButton title={busy ? `تحليل… ${(elapsed / 1000).toFixed(1)}ث` : 'تحليل النص بعد مراجعته'} icon="sparkles-outline" onPress={() => run()} loading={busy} disabled={ocrBusy} style={{ flex: 1 }} />
        </Row>
        {!ocrEnabled ? <Text style={styles.privacyNotice}>استخراج الصور معطّل من الإعدادات. يمكنك تفعيله من الإعدادات أو لصق النص يدويًا.</Text> : null}
        {ocrBusy ? <Text style={styles.processing}>جارٍ ضغط الصورة واستخراج النص عبر Gemini…</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        <Text style={styles.or}>أو الصق النص يدويًا:</Text>
        <TextInput value={text} onChangeText={setText} multiline placeholder="مثال: ما فئة عمرك؟ ثم الخيارات كل في سطر…" placeholderTextColor={colors.textFaint} style={styles.input} textAlign="right" />
        <Row style={{ gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' }}>
          <AppButton title="لصق سؤال تجريبي" icon="documents-outline" variant="soft" onPress={() => setText(SAMPLES[Math.floor(Math.random() * SAMPLES.length)])} style={{ flex: 1 }} />
          <AppButton title="مسح" icon="trash-outline" variant="danger" onPress={() => { setText(''); setResult(null); setError(''); setNotice(''); setImageUri(null); setFromMemory(false); setMemorySaved(false); setTextAnswerDraft(''); }} style={{ width: 100 }} />
        </Row>
        <View style={styles.editor}>
          <Text style={styles.editorLabel}>النص المستخرج أو الملصق (قابل للتعديل)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text style={styles.editorText} selectable>{text || '—'}</Text>
          </ScrollView>
        </View>
        {error ? (
          <Animated.View entering={FadeInDown.duration(250)} style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </Animated.View>
        ) : null}
      </Card>

      {busy && (
        <Animated.View entering={ZoomIn} style={styles.scanCard}>
          <Ionicons name="radio-button-on" size={20} color={colors.primary} />
          <Text style={styles.scanText}>جارٍ تحليل السؤال… سيستخدم Gemini إذا كان أحد المفاتيح متاحًا.</Text>
        </Animated.View>
      )}

      {result && !busy && (
        <Animated.View entering={FadeIn.duration(350)}>
          <Card style={{ borderColor: 'rgba(34,211,165,0.4)' }}>
            <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}>
              <Text style={styles.resultTitle}>نتيجة التحليل</Text>
              <View style={styles.enginePill}>
                <Ionicons name="sparkles" size={12} color={colors.primary} />
                <Text style={styles.engineText}>{fromMemory ? 'من الذاكرة' : result.engine === 'gemini' ? 'Gemini AI' : 'محرك محلي'}</Text>
              </View>
            </Row>
            <Text style={styles.question}>{result.question}</Text>
            <Row style={{ gap: spacing.sm, marginBottom: spacing.md }}>
              <View style={styles.tag}><Text style={styles.tagText}>{typeLabel[result.questionType] ?? result.questionType}</Text></View>
              <View style={[styles.tag, { backgroundColor: 'rgba(96,165,250,0.12)' }]}>
                <Text style={[styles.tagText, { color: colors.accent }]}>ثقة {Math.round(result.confidence * 100)}%</Text>
              </View>
            </Row>

            <View style={{ marginTop: spacing.sm }}>
              {result.options.map((opt, i) => {
                const isSuggested = i === result.suggestionIndex;
                return (
                  <Animated.View key={i} entering={FadeInDown.delay(i * 70)}>
                    <View style={[styles.option, isSuggested && styles.optionSuggested]}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Text style={[styles.optionText, isSuggested && { color: colors.primary, fontWeight: '800' }]}>{opt}</Text>
                        {isSuggested ? (
                          <Animated.View entering={ZoomIn.delay(250)} style={styles.aiBadge}>
                            <Ionicons name="sparkles" size={13} color="#04140F" />
                            <Text style={styles.aiBadgeText}>اقتراح AI</Text>
                          </Animated.View>
                        ) : null}
                      </Row>
                      {isSuggested ? <Text style={styles.reason}>{result.reason}</Text> : null}
                    </View>
                  </Animated.View>
                );
              })}
              {result.options.length === 0 && (
                <View style={{ marginTop: spacing.md }}>
                  <Text style={styles.textAnswerLabel}>الإجابة النصية — راجعها وعدّلها قبل الحفظ</Text>
                  <TextInput
                    value={textAnswerDraft}
                    onChangeText={(value) => {
                      setTextAnswerDraft(value);
                      setResult((current) => current ? { ...current, suggestion: value, suggestionIndex: -1 } : current);
                    }}
                    editable={!memorySaved}
                    multiline
                    placeholder="اكتب إجابتك هنا، أو عدّل المسودة المقترحة…"
                    placeholderTextColor={colors.textFaint}
                    style={[styles.textAnswerInput, memorySaved && { opacity: 0.8 }]}
                    textAlign="right"
                  />
                </View>
              )}
            </View>
            {memorySaved ? (
              <View style={styles.memoryFixedNotice}>
                <Ionicons name="lock-closed" size={17} color={colors.primary} />
                <Text style={styles.memoryFixedText}>هذه الإجابة محفوظة وثابتة على جهازك. عند تطابق السؤال والخيارات ستُعاد كما هي بدل توليد جواب جديد. لتغييرها، احذفها من السجل ← إجابات ثابتة ثم احفظ جوابًا جديدًا.</Text>
              </View>
            ) : (
              <AppButton
                title={memorySaveBusy ? 'جارٍ حفظ الإجابة…' : 'حفظ هذه الإجابة كإجابة ثابتة'}
                icon="bookmark-outline"
                onPress={saveCurrentAnswerToMemory}
                loading={memorySaveBusy}
                style={{ marginTop: spacing.md }}
              />
            )}
          </Card>
        </Animated.View>
      )}

      {!result && !busy && (
        <Card delay={120} style={{ alignItems: 'center', paddingVertical: 36 }}>
          <View style={styles.placeholderIcon}>
            <Ionicons name="bulb-outline" size={30} color={colors.textFaint} />
          </View>
          <Text style={styles.placeholderTitle}>لا توجد نتائج بعد</Text>
          <Text style={styles.placeholderSub}>بعد التحليل سيظهر الاقتراح بجانب الخيار المناسب بإطار أخضر واضح</Text>
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  textAnswerLabel: { color: colors.textDim, fontSize: 12, fontWeight: '800', textAlign: 'right', marginBottom: spacing.xs },
  textAnswerInput: { minHeight: 100, color: colors.text, fontSize: 14, lineHeight: 22, textAlignVertical: 'top', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md },
  memoryFixedNotice: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: 'rgba(34,211,165,0.35)', backgroundColor: 'rgba(34,211,165,0.08)' },
  memoryFixedText: { flex: 1, color: colors.primary, fontSize: 12, lineHeight: 19, textAlign: 'right', fontWeight: '700' },
  imageReview: { marginTop: spacing.md, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  previewImage: { width: '100%', height: 190, borderRadius: radius.sm, backgroundColor: colors.bg },
  imageCaption: { color: colors.textFaint, fontSize: 11, textAlign: 'center', marginTop: spacing.xs },
  privacyNotice: { color: colors.textFaint, fontSize: 11, lineHeight: 17, textAlign: 'right', marginTop: spacing.md },
  processing: { color: colors.accent, fontSize: 12, textAlign: 'right', marginTop: spacing.sm },
  notice: { color: colors.success, fontSize: 12, lineHeight: 19, textAlign: 'right', marginTop: spacing.sm },
  desc: { color: colors.textDim, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  or: { color: colors.textFaint, fontSize: 12.5, marginTop: spacing.md, marginBottom: 6, textAlign: 'right' },
  input: { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md, minHeight: 110, color: colors.text, fontSize: 14, lineHeight: 22, textAlignVertical: 'top' },
  pasteBox: {
    backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, minHeight: 60,
  },
  pasteText: { color: colors.textDim, fontSize: 13, textAlign: 'right', lineHeight: 21 },
  editor: { marginTop: spacing.md, backgroundColor: 'rgba(96,165,250,0.06)', borderRadius: radius.sm, padding: spacing.md, borderWidth: 1, borderColor: 'rgba(96,165,250,0.18)' },
  editorLabel: { color: colors.accent, fontSize: 11.5, fontWeight: '700', marginBottom: 6, textAlign: 'right' },
  editorText: { color: colors.text, fontSize: 13, textAlign: 'left', writingDirection: 'ltr' },
  errorBox: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: 'rgba(248,113,113,0.1)', borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.md },
  errorText: { color: colors.danger, fontSize: 13, flex: 1, textAlign: 'right' },
  scanCard: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.md, backgroundColor: colors.primarySoft,
    borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: 'rgba(34,211,165,0.3)',
  },
  scanText: { color: colors.primary, fontSize: 13.5, flex: 1, textAlign: 'right', fontWeight: '600' },
  resultTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  enginePill: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  engineText: { color: colors.primary, fontSize: 11, fontWeight: '800' },
  question: { color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'right', lineHeight: 26, marginBottom: spacing.md },
  tag: { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { color: colors.textDim, fontSize: 11.5, fontWeight: '700' },
  option: {
    backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1.5,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  optionSuggested: {
    borderColor: colors.primary, backgroundColor: 'rgba(34,211,165,0.1)',
    ...shadow.glow,
  },
  optionText: { color: colors.text, fontSize: 14.5, flex: 1, textAlign: 'right', lineHeight: 22 },
  aiBadge: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  aiBadgeText: { color: '#04140F', fontSize: 11, fontWeight: '900' },
  reason: { color: colors.primary, fontSize: 11.5, marginTop: 7, textAlign: 'right', lineHeight: 18 },
  placeholderIcon: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  placeholderTitle: { color: colors.text, fontSize: 15.5, fontWeight: '800' },
  placeholderSub: { color: colors.textDim, fontSize: 12.5, textAlign: 'center', marginTop: 6, lineHeight: 20, paddingHorizontal: spacing.lg },
});
