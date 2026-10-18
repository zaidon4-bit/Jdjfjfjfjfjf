import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { AppButton, Card, Field } from '../components/ui';
import { store } from '../lib/store';
import { colors, radius, spacing } from '../theme';
import { User } from '../types';

export default function AuthScreen({ onDone }: { onDone: (u: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();

  const submit = async () => {
    setError('');
    if (!/^[a-zA-Z0-9_\-.]{3,30}$/.test(username.trim())) return setError('اسم المستخدم يجب أن يكون 3 إلى 30 حرفًا أو رقمًا');
    if (password.length < 8) return setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
    if (mode === 'register' && password !== confirm) return setError('كلمتا المرور غير متطابقتين');
    setLoading(true);
    try {
      const user = mode === 'login' ? await store.login(username, password) : await store.register(username, password);
      onDone(user);
    } catch (e: any) { setError(e?.message ?? 'حدث خطأ غير متوقع'); }
    finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeIn.duration(600)} style={styles.logoWrap}>
          <View style={styles.logo}><Ionicons name="sparkles" size={38} color={colors.primary} /></View>
          <Text style={styles.title}>Survey AI Assistant</Text>
          <Text style={styles.subtitle}>مساعدك الذكي أثناء تعبئة الاستبيانات{`\n`}تحليل وحفظ ذكي لأسئلتك</Text>
        </Animated.View>
        <Card delay={150} style={{ width: '100%' }}>
          <View style={styles.tabs}>
            {(['login', 'register'] as const).map((m) => <Text key={m} onPress={() => { setMode(m); setError(''); }} style={[styles.tab, mode === m && styles.tabActive]}>{m === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب'}</Text>)}
          </View>
          <View style={{ marginTop: spacing.lg }}>
            <Field label="اسم المستخدم" value={username} onChangeText={setUsername} placeholder="username" autoCapitalize="none" returnKeyType="next" />
            <Field label="كلمة المرور" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry returnKeyType="next" />
            {mode === 'register' && <Field label="تأكيد كلمة المرور" value={confirm} onChangeText={setConfirm} placeholder="••••••••" secureTextEntry returnKeyType="done" onSubmitEditing={submit} />}
            {error ? <Animated.View entering={FadeInDown.duration(250)} style={styles.errorBox}><Ionicons name="alert-circle" size={16} color={colors.danger} /><Text style={styles.errorText}>{error}</Text></Animated.View> : null}
            <AppButton title={mode === 'login' ? 'دخول آمن' : 'إنشاء الحساب'} icon={mode === 'login' ? 'log-in-outline' : 'person-add-outline'} onPress={submit} loading={loading} style={{ marginTop: spacing.sm }} />
          </View>
        </Card>
        <Animated.View entering={FadeInDown.delay(350)} style={styles.secureRow}><Ionicons name="lock-closed" size={14} color={colors.textFaint} /><Text style={styles.secureText}>لا نحتاج إلى بريد إلكتروني — استخدم اسم المستخدم وكلمة المرور فقط</Text></Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.xl, alignItems: 'center' }, logoWrap: { alignItems: 'center', marginBottom: spacing.xxl },
  logo: { width: 88, height: 88, borderRadius: radius.xl, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(34,211,165,0.3)', marginBottom: spacing.lg },
  title: { color: colors.text, fontSize: 26, fontWeight: '900', letterSpacing: 0.3 }, subtitle: { color: colors.textDim, fontSize: 14, textAlign: 'center', marginTop: spacing.sm, lineHeight: 22 },
  tabs: { flexDirection: 'row-reverse', backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, padding: 4 }, tab: { flex: 1, textAlign: 'center', paddingVertical: 11, borderRadius: radius.pill, color: colors.textDim, fontWeight: '700', fontSize: 14.5, overflow: 'hidden' }, tabActive: { backgroundColor: colors.primary, color: '#04140F' },
  errorBox: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: 'rgba(248,113,113,0.1)', borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.xs }, errorText: { color: colors.danger, fontSize: 13, flex: 1, textAlign: 'right' },
  secureRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginTop: spacing.lg, paddingHorizontal: spacing.sm }, secureText: { color: colors.textFaint, fontSize: 11.5, textAlign: 'center', flex: 1, lineHeight: 18 },
});
