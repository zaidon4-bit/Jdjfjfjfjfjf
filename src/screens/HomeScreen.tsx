import React, { useCallback } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { AppButton, Card, Row, SectionTitle } from '../components/ui';
import { store } from '../lib/store';
import { colors, radius, shadow, spacing, statusColor, statusIcon, statusLabel } from '../theme';
import { User } from '../types';

const fmt = (ts: number | null) =>
  ts ? new Date(ts).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';

export default function HomeScreen({
  user, onNavigate, onUserChange, assistantOn, onAssistantToggle,
}: {
  user: User;
  onNavigate: (r: string) => void;
  onUserChange: (u: User) => void;
  assistantOn: boolean;
  onAssistantToggle: (v: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const active = store.isSubscriptionActive(user);
  const daysLeft = user.subscriptionEnd ? Math.max(0, Math.ceil((user.subscriptionEnd - Date.now()) / 864e5)) : 0;

  useFocusEffect(useCallback(() => { onUserChange(user); }, [user.id]));

  const requestPermissions = () => {
    Alert.alert(
      'تصوير الشاشة غير مفعّل بعد',
      'هذا الإصدار لا يطلب صلاحيات Android فعلية ولا يلتقط الشاشة. يمكنك فتح شاشة التحليل ولصق نص السؤال وخياراته. يلزم تطوير تكامل Android أصلي لإضافة MediaProjection وOCR.',
    );
  };

  const toggleAssistant = (v: boolean) => {
    if (v) return requestPermissions();
    onAssistantToggle(false);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, paddingBottom: 110 }}>
      <Row style={{ marginBottom: spacing.lg }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.hello}>مرحبًا {user.profile.fullName || 'بك'} 👋</Text>
          <Text style={styles.username}>{user.username}</Text>
        </View>
        <View style={styles.avatar}>
          <Ionicons name="person" size={22} color={colors.primary} />
        </View>
      </Row>

      <Animated.View entering={FadeInDown.duration(420)}>
        <View style={[styles.statusCard, { borderColor: statusColor(user.status) + '55' }]}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row style={{ gap: spacing.sm }}>
              <Ionicons name={statusIcon(user.status)} size={22} color={statusColor(user.status)} />
              <Text style={styles.statusLabel}>{statusLabel(user.status)}</Text>
            </Row>
            <Text style={[styles.statusPill, { color: statusColor(user.status), borderColor: statusColor(user.status) + '66' }]}>
              {user.status.toUpperCase()}
            </Text>
          </Row>
          <View style={styles.divider} />
          <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={styles.metaLabel}>تاريخ البداية</Text>
            <Text style={styles.metaValue}>{fmt(user.subscriptionStart)}</Text>
          </Row>
          <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={styles.metaLabel}>تاريخ الانتهاء</Text>
            <Text style={styles.metaValue}>{fmt(user.subscriptionEnd)}</Text>
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.metaLabel}>المتبقّي</Text>
            <Text style={[styles.metaValue, { color: colors.primary }]}>{active ? `${daysLeft} يوم` : '—'}</Text>
          </Row>
          {!active && (
            <AppButton title="طلب تفعيل الاشتراك" icon="card-outline" onPress={() => onNavigate('Subscription')} style={{ marginTop: spacing.md }} />
          )}
        </View>
      </Animated.View>

      <Card delay={100}>
        <SectionTitle title="حالة المساعد الذكي" icon="sparkles" />
        <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.aiState}>{assistantOn && active ? 'المساعد يعمل — الزر العائم ظاهر' : 'المساعد متوقف'}</Text>
            <Text style={styles.aiHint}>
              {active ? 'يمكن تصوير سؤال بالكاميرا أو اختيار لقطة شاشة من المعرض واستخراج النص، ثم مراجعته قبل التحليل.' : 'يتطلب اشتراكًا مفعّلاً لاستخدام محرك الذكاء الاصطناعي'}
            </Text>
          </View>
          <Switch
            value={assistantOn && active}
            onValueChange={toggleAssistant}
            disabled={!active}
            trackColor={{ true: colors.primaryDark, false: colors.border }}
            thumbColor={assistantOn && active ? colors.primary : '#94A3B8'}
          />
        </Row>
        <AppButton
          title="حالة تصوير الشاشة وOCR"
          icon="information-circle-outline"
          variant="soft"
          onPress={openQuestionCapture}
          style={{ marginTop: spacing.sm }}
        />
      </Card>

      <Card delay={180}>
        <SectionTitle title="إجراءات سريعة" icon="grid" />
        <View style={styles.quickGrid}>
          {[
            { icon: 'scan', label: 'تحليل سؤال', route: 'AnalyzeTab' },
            { icon: 'time', label: 'سجل التحليلات', route: 'HistoryTab' },
            { icon: 'person-circle', label: 'الملف الشخصي', route: 'ProfileTab' },
            { icon: 'card', label: 'الاشتراك', route: 'Subscription' },
            { icon: 'settings', label: 'الإعدادات', route: 'Settings' },
            { icon: 'shield-half', label: 'لوحة الإدارة', route: 'Admin' },
          ].filter((q) => q.route !== 'Admin' || user.role === 'admin').map((q, i) => (
            <Animated.View key={q.route} entering={FadeInDown.delay(220 + i * 50)} style={styles.quickItem}>
              <Pressable onPress={() => onNavigate(q.route)} style={styles.quickTouch}>
                <View style={styles.quickIcon}>
                  <Ionicons name={q.icon as any} size={22} color={colors.primary} />
                </View>
                <Text style={styles.quickLabel}>{q.label}</Text>
              </Pressable>
            </Animated.View>
          ))}
        </View>
      </Card>

      <Card delay={260}>
        <SectionTitle title="الخصوصية والأمان" icon="lock-closed" />
        <Text style={styles.privacy}>
          • لا يُخزَّن أي Screenshot على خوادمنا — تتم معالجته على الجهاز ثم يُحذف تلقائيًا.{'\n'}
          • مفاتيح Gemini محفوظة على الخادم ولا تُضمَّن في التطبيق المنشور.{'\n'}
          • تُرسل بعض حقول الملف الشخصي إلى Gemini عند طلب التحليل؛ لا تُرسل الاسم الكامل أو الملاحظات الحرة.
        </Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hello: { color: colors.text, fontSize: 21, fontWeight: '900', textAlign: 'right' },
  username: { color: colors.textDim, fontSize: 13, textAlign: 'right', marginTop: 2 },
  avatar: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(34,211,165,0.25)',
  },
  statusCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    padding: spacing.lg, marginBottom: spacing.md, ...shadow.card,
  },
  statusLabel: { color: colors.text, fontSize: 16.5, fontWeight: '800' },
  statusPill: { fontSize: 11.5, fontWeight: '800', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  metaLabel: { color: colors.textDim, fontSize: 13.5 },
  metaValue: { color: colors.text, fontSize: 13.5, fontWeight: '700' },
  aiState: { color: colors.text, fontSize: 15.5, fontWeight: '800', textAlign: 'right' },
  aiHint: { color: colors.textDim, fontSize: 12.5, textAlign: 'right', marginTop: 4, lineHeight: 19 },
  permBox: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: 'rgba(52,211,153,0.09)',
    borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm,
  },
  permText: { color: colors.success, fontSize: 12, flex: 1, textAlign: 'right' },
  quickGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.lg },
  quickItem: { width: '31%', alignItems: 'center' },
  quickTouch: { alignItems: 'center' },
  quickIcon: {
    width: 58, height: 58, borderRadius: radius.md, backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, marginBottom: 8,
  },
  quickLabel: { color: colors.textDim, fontSize: 12.5, fontWeight: '700', textAlign: 'center' },
  privacy: { color: colors.textDim, fontSize: 12.5, lineHeight: 24, textAlign: 'right' },
});
