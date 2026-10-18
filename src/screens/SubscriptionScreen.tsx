import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { AppButton, Card, Field, Row, SectionTitle } from '../components/ui';
import { api, Plan, SubscriptionOrder } from '../lib/api';
import { colors, radius, spacing, statusColor, statusIcon, statusLabel } from '../theme';
import { User } from '../types';

const fmt = (ts: number | null) => ts ? new Date(ts).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
const orderLabel: Record<string, string> = { pending: 'بانتظار مراجعة الدفع', approved: 'مقبول ومفعّل', rejected: 'مرفوض', cancelled: 'ملغي' };

export default function SubscriptionScreen({ user, onUserChange }: { user: User; onUserChange: (u: User) => void }) {
  const insets = useSafeAreaInsets();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState('monthly');
  const [reference, setReference] = useState('');
  const [orders, setOrders] = useState<SubscriptionOrder[]>([]);
  const [paymentInfo, setPaymentInfo] = useState<{ configured: boolean; instructions: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [newPlans, newOrders, freshUser, payInfo] = await Promise.all([api.plans(), api.myOrders(), api.subscription(), api.paymentInfo()]);
      setPlans(newPlans); setOrders(newOrders); setPaymentInfo(payInfo); onUserChange(freshUser);
      setPlanId((current) => newPlans.some((p) => p.id === current) ? current : (newPlans[0]?.id || ''));
    } catch (e) { setError((e as Error)?.message || 'تعذر تحميل الاشتراكات.'); }
    finally { setLoading(false); }
  }, [onUserChange]);

  useEffect(() => { void load(); }, [load]);

  const pending = orders.some((o) => o.status === 'pending');
  const selectedPlan = plans.find((p) => p.id === planId);

  const request = async () => {
    if (!selectedPlan) return setError('اختر باقة متاحة أولًا.');
    if (!paymentInfo?.configured) return setError('تعليمات الدفع غير مضبوطة بعد؛ لا تحوّل أموالًا قبل إعدادها من الخادم.');
    if (reference.trim().length < 4) return setError('بعد التحويل، أدخل رقم عملية الدفع الصحيح حتى يقدر المدير يراجعه.');
    setBusy(true); setError(''); setMessage('');
    try {
      await api.createOrder(selectedPlan.id, reference.trim());
      setReference('');
      setMessage('تم إرسال طلب الاشتراك إلى لوحة الإدارة. لن يتفعّل الاشتراك إلا بعد مراجعة الدفع من المدير.');
      await load();
    } catch (e) { setError((e as Error)?.message || 'تعذّر إرسال الطلب.'); }
    finally { setBusy(false); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Animated.View entering={FadeInDown.duration(400)}>
        <View style={[styles.statusCard, { borderColor: statusColor(user.status) + '55' }]}>
          <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}>
            <Row style={{ gap: spacing.sm }}><Ionicons name={statusIcon(user.status)} size={24} color={statusColor(user.status)} /><Text style={styles.statusTitle}>{statusLabel(user.status)}</Text></Row>
            <Text style={[styles.statusPill, { color: statusColor(user.status), borderColor: statusColor(user.status) + '66' }]}>{user.status.toUpperCase()}</Text>
          </Row>
          <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}><Text style={styles.meta}>الباقة</Text><Text style={styles.metaV}>{user.planName || 'لا توجد باقة فعالة'}</Text></Row>
          <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}><Text style={styles.meta}>تاريخ البداية</Text><Text style={styles.metaV}>{fmt(user.subscriptionStart)}</Text></Row>
          <Row style={{ justifyContent: 'space-between' }}><Text style={styles.meta}>تاريخ الانتهاء</Text><Text style={styles.metaV}>{fmt(user.subscriptionEnd)}</Text></Row>
        </View>
      </Animated.View>

      <Card delay={100}>
        <SectionTitle title="اختر باقة الاشتراك" icon="card" />
        {loading ? <Text style={styles.note}>جارٍ تحميل الباقات…</Text> : (
          <Row style={{ gap: spacing.sm }}>
            {plans.map((p) => {
              const selected = p.id === planId;
              return <View key={p.id} style={{ flex: 1 }}>
                <AppButton title={p.name.replace('اشتراك ', '')} variant={selected ? 'primary' : 'soft'} onPress={() => setPlanId(p.id)} style={{ minHeight: 70 }} />
                <Text style={styles.duration}>{p.durationDays} يومًا</Text>
              </View>;
            })}
          </Row>
        )}
        <View style={styles.payBox}>
          <Ionicons name="information-circle-outline" size={20} color={colors.accent} />
          <View style={{ flex: 1, gap: 5 }}><Text style={styles.payText}>{paymentInfo?.instructions || 'جارٍ تحميل تعليمات الدفع…'}</Text><Text style={styles.payText}>لا توجد أسعار معلنة داخل التطبيق حاليًا. اتفق مع الإدارة على المبلغ والشروط قبل أي تحويل. الدفع يدوي؛ المدير يراجع الطلب ويؤكد التفعيل بعد التحقق، ولا توجد بوابة دفع آلية مربوطة.</Text></View>
        </View>
        <Field label="رقم عملية الدفع" value={reference} onChangeText={setReference} placeholder="أدخل رقم العملية بعد إتمام التحويل" />
        <AppButton title={pending ? 'لديك طلب قيد المراجعة' : `إرسال طلب ${selectedPlan?.name || 'الاشتراك'}`} icon={pending ? 'time-outline' : 'paper-plane-outline'} variant={pending ? 'soft' : 'primary'} onPress={request} loading={busy} disabled={pending || loading || !plans.length || !paymentInfo?.configured} />
        {!paymentInfo?.configured && !loading ? <Text style={styles.error}>تعليمات الدفع غير جاهزة؛ لن نسمح بإرسال طلب شراء قبل ضبطها.</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {message ? <Text style={styles.success}>{message}</Text> : null}
        <AppButton title="تحديث حالة الطلب" icon="refresh-outline" variant="soft" onPress={load} loading={loading} style={{ marginTop: spacing.sm }} />
      </Card>

      <Card delay={180}>
        <SectionTitle title="طلباتي السابقة" icon="receipt-outline" />
        {!orders.length ? <Text style={styles.note}>لا توجد طلبات اشتراك حتى الآن.</Text> : orders.map((order) => (
          <View key={order.id} style={styles.order}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.orderTitle}>{order.planName}</Text>
              <Text style={[styles.orderStatus, { color: order.status === 'approved' ? colors.success : order.status === 'pending' ? colors.warn : colors.danger }]}>{orderLabel[order.status] || order.status}</Text>
            </Row>
            <Text style={styles.note}>{order.durationDays ? `${order.durationDays} يومًا • ` : ''}{fmt(order.createdAt)}</Text>
            {!!order.adminNote && <Text style={styles.note}>ملاحظة الإدارة: {order.adminNote}</Text>}
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  statusCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, marginBottom: spacing.md },
  statusTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  statusPill: { fontSize: 11, fontWeight: '900', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  meta: { color: colors.textDim, fontSize: 13.5 }, metaV: { color: colors.text, fontSize: 13.5, fontWeight: '700', flexShrink: 1 },
  duration: { color: colors.textFaint, fontSize: 10.5, textAlign: 'center', marginTop: 7 },
  payBox: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: 'rgba(96,165,250,0.08)', borderRadius: radius.sm, padding: spacing.md, marginVertical: spacing.md },
  payText: { color: colors.textDim, fontSize: 12, flex: 1, textAlign: 'right', lineHeight: 19 },
  note: { color: colors.textFaint, fontSize: 12, lineHeight: 18, textAlign: 'right' }, error: { color: colors.danger, fontSize: 12, marginTop: spacing.md, textAlign: 'right' }, success: { color: colors.success, fontSize: 12, marginTop: spacing.md, textAlign: 'right', lineHeight: 19 },
  order: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 5 }, orderTitle: { color: colors.text, fontSize: 14, fontWeight: '800' }, orderStatus: { fontSize: 12, fontWeight: '800' },
});
