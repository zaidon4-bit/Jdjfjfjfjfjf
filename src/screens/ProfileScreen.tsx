import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppButton, Card, Field, SectionTitle } from '../components/ui';
import { store } from '../lib/store';
import { colors, spacing } from '../theme';
import { Profile, User } from '../types';

export default function ProfileScreen({ user, onUserChange }: { user: User; onUserChange: (u: User) => void }) {
  const insets = useSafeAreaInsets();
  const [p, setP] = useState<Profile>({ ...user.profile });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof Profile) => (v: string) => { setP((prev) => ({ ...prev, [k]: v })); setSaved(false); };

  const save = async () => {
    setSaving(true);
    const users = await store.updateProfile(user.id, p);
    const updated = users.find((u) => u.id === user.id)!;
    onUserChange(updated);
    setSaving(false);
    setSaved(true);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>الملف الشخصي</Text>
        <Text style={styles.sub}>تُستخدم هذه المعلومات حصريًا لتحليل أسئلة الاستبيان واقتراح الإجابة الأنسب لك</Text>

        <Card delay={80}>
          <SectionTitle title="المعلومات الأساسية" icon="person" />
          <Field label="الاسم الكامل" value={p.fullName} onChangeText={set('fullName')} placeholder="مثال: أحمد محمد" />
          <Field label="العمر" value={p.age} onChangeText={set('age')} placeholder="مثال: 25 - 34" />
          <Field label="الجنس" value={p.gender} onChangeText={set('gender')} placeholder="ذكر / أنثى" />
          <Field label="الحالة الاجتماعية" value={p.maritalStatus} onChangeText={set('maritalStatus')} placeholder="أعزب / متزوج…" />
          <Field label="البلد" value={p.country} onChangeText={set('country')} placeholder="مثال: السعودية" />
          <Field label="المدينة" value={p.city} onChangeText={set('city')} placeholder="مثال: الرياض" />
        </Card>

        <Card delay={140}>
          <SectionTitle title="التعليم والعمل والدخل" icon="briefcase" />
          <Field label="المستوى التعليمي" value={p.education} onChangeText={set('education')} placeholder="ثانوي / بكالوريوس / دراسات عليا" />
          <Field label="المهنة" value={p.occupation} onChangeText={set('occupation')} placeholder="مثال: مهندس برمجيات" />
          <Field label="الدخل الشهري" value={p.income} onChangeText={set('income')} placeholder="أدخل نطاقًا تقريبيًا بعملتك" />
        </Card>

        <Card delay={200}>
          <SectionTitle title="الأسرة والأجهزة والاهتمامات" icon="home" />
          <Field label="عدد أفراد الأسرة" value={p.householdSize} onChangeText={set('householdSize')} placeholder="مثال: 4" keyboardType="number-pad" />
          <Field label="الأجهزة التي تستخدمها" value={p.devices} onChangeText={set('devices')} placeholder="Android, iPhone, Laptop…" />
          <Field label="امتلاك سيارة" value={p.hasCar} onChangeText={set('hasCar')} placeholder="نعم / لا" />
          <Field label="الاهتمامات" value={p.interests} onChangeText={set('interests')} placeholder="سفر، تقنية، رياضة…" />
          <Field label="اللغات" value={p.languages} onChangeText={set('languages')} placeholder="العربية، الإنجليزية" />
          <Field label="معلومات أخرى" value={p.other} onChangeText={set('other')} placeholder="أي تفاصيل إضافية تفيد تحليل الاستبيانات" multiline numberOfLines={3} />
        </Card>

        <AppButton title={saving ? 'جارٍ الحفظ…' : 'حفظ التعديلات'} icon="save-outline" onPress={save} loading={saving} />
        {saved ? <Text style={styles.saved}>✓ تم حفظ الملف الشخصي بنجاح</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 22, fontWeight: '900', textAlign: 'right' },
  sub: { color: colors.textDim, fontSize: 12.5, textAlign: 'right', marginTop: 4, marginBottom: spacing.lg, lineHeight: 20 },
  saved: { color: colors.success, textAlign: 'center', marginTop: spacing.md, fontSize: 13.5, fontWeight: '700' },
});
