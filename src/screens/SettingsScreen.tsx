import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppButton, Card, Row, SectionTitle } from '../components/ui';
import { api, isApiConfigured } from '../lib/api';
import { store } from '../lib/store';
import { APP_VERSION } from '../lib/config';
import { colors, spacing } from '../theme';
import { User } from '../types';

type S = { autoAnalyze: boolean; keepScreens: boolean; ocr: boolean };

export default function SettingsScreen({ user, onLogout }: { user: User; onLogout: () => void }) {
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<S>({ autoAnalyze: true, keepScreens: false, ocr: true });
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; model: string; dailyLimit?: number; usageToday?: number; includesOcr?: boolean } | null>(null);
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    store.settings().then(setS);
    if (isApiConfigured()) {
      api.aiStatus().then(setAiStatus).catch((error) => setAiError((error as Error)?.message || 'تعذّر الاستعلام عن Gemini.'));
    } else setAiError('الخادم المركزي غير مضبوط ضمن إعدادات بناء التطبيق.');
  }, []);

  const toggle = (k: keyof S) => async (v: boolean) => {
    const next = { ...s, [k]: v };
    setS(next);
    await store.saveSettings(next);
  };

  const rows: { key: keyof S; icon: any; title: string; desc: string }[] = [
    { key: 'ocr', icon: 'text', title: 'استخراج النص من الصور', desc: 'السماح بالتقاط سؤال أو اختيار صورة لاستخراج النص بواسطة Gemini' },
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, paddingBottom: 60 }}>
      <Text style={styles.title}>الإعدادات</Text>

      <Card delay={60}>
        <SectionTitle title="تفضيلات المساعد" icon="options" />
        {rows.map((r) => <Row key={r.key} style={{ justifyContent: 'space-between', marginBottom: spacing.lg }}>
          <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{r.title}</Text><Text style={styles.rowDesc}>{r.desc}</Text></View>
          <Switch value={s[r.key]} onValueChange={toggle(r.key)} trackColor={{ true: colors.primaryDark, false: colors.border }} thumbColor={s[r.key] ? colors.primary : '#94A3B8'} />
        </Row>)}
      </Card>

      <Card delay={100}>
        <SectionTitle title="Gemini والذكاء الاصطناعي" icon="sparkles" />
        <View style={styles.statusRow}>
          <Ionicons name={aiStatus?.configured ? 'checkmark-circle' : 'alert-circle'} size={21} color={aiStatus?.configured ? colors.success : colors.warn} />
          <Text style={styles.statusTitle}>{aiStatus?.configured ? 'Gemini مضبوط على الخادم' : 'Gemini غير مؤكد الإعداد'}</Text>
        </View>
        <Text style={styles.note}>مفاتيح API تُحفظ في الخادم فقط. يستطيع المدير ضبط عدة مفاتيح عبر GEMINI_API_KEYS؛ يجرب الخادم مفتاحًا آخر عند نفاد الحصة أو حدوث خطأ مؤقت. لا تضع المفاتيح في APK أو GitHub.</Text>
        {aiStatus ? <Row style={{ justifyContent: 'space-between', marginTop: spacing.md }}><Text style={styles.rowTitle}>النموذج</Text><Text style={styles.rowValue}>{aiStatus.model}</Text></Row> : null}
        {aiStatus && user.role !== 'admin' ? <Text style={[styles.note, { marginTop: spacing.sm }]}>استخدامك اليوم: {aiStatus.usageToday ?? user.usageToday ?? 0} من {aiStatus.dailyLimit ?? '—'} طلبًا ناجحًا. استخراج الصورة وتحليل السؤال يُحسبان كلٌ كطلب.</Text> : null}
        {aiError ? <Text style={styles.error}>{aiError}</Text> : null}
      </Card>

      <Card delay={120}>
        <SectionTitle title="الحساب" icon="person-circle" />
        <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}><Text style={styles.rowTitle}>اسم المستخدم</Text><Text style={styles.rowValue}>{user.username}</Text></Row>
        <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}><Text style={styles.rowTitle}>نوع الحساب</Text><Text style={[styles.rowValue, { color: user.role === 'admin' ? colors.warn : colors.primary }]}>{user.role === 'admin' ? 'مدير' : 'مستخدم'}</Text></Row>
        <AppButton title="تسجيل الخروج" icon="log-out-outline" variant="danger" onPress={onLogout} />
      </Card>

      <Card delay={160}>
        <SectionTitle title="ذاكرة الاستبيانات" icon="folder-open" />
        <Text style={styles.note}>يُحفظ سجل التحليلات والذاكرة على هذا الجهاز فقط. مسحها لا يحذف الحساب أو الاشتراك المركزي.</Text>
        <AppButton title="مسح الذاكرة المحفوظة" icon="trash-outline" variant="danger" onPress={() => store.clearAnalyses(user.id)} style={{ marginTop: spacing.md }} />
      </Card>

      <Card delay={180}>
        <SectionTitle title="حول التطبيق" icon="information-circle" />
        <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}><Text style={styles.rowTitle}>الإصدار</Text><Text style={styles.rowValue}>v{APP_VERSION}</Text></Row>
        <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}><Text style={styles.rowTitle}>محرك الذكاء</Text><Text style={styles.rowValue}>Google Gemini عبر خادم وسيط</Text></Row>
        <Text style={styles.note}>عند استخدام استخراج الصور، تُضغط الصورة على الجهاز وتُرسل عبر HTTPS إلى خادم التطبيق ثم إلى Google Gemini لقراءة النص. لا يحفظ التطبيق الصورة داخل قاعدة بياناته، لكن خدمة Gemini تعالج محتواها. عند تحليل سؤال نصّي، تُرسل الخيارات وحقول الملف الشخصي الضرورية فقط؛ لا يُرسل الاسم الكامل أو الملاحظات الحرة. راجع المعلومات الظاهرة في الصورة قبل الإرسال.</Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 22, fontWeight: '900', textAlign: 'right', marginBottom: spacing.lg },
  rowTitle: { color: colors.text, fontSize: 14.5, fontWeight: '700', textAlign: 'right' },
  rowDesc: { color: colors.textDim, fontSize: 11.5, textAlign: 'right', marginTop: 3, lineHeight: 18 },
  rowValue: { color: colors.textDim, fontSize: 12.5, fontWeight: '600', flexShrink: 1, textAlign: 'left' },
  statusRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: spacing.sm },
  statusTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  note: { color: colors.textFaint, fontSize: 11.5, lineHeight: 19, textAlign: 'right' },
  error: { color: colors.danger, fontSize: 11.5, lineHeight: 18, textAlign: 'right', marginTop: spacing.md },
});
