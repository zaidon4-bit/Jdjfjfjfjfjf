import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppButton, Card, Row, SectionTitle } from '../components/ui';
import { AdminDashboard, AdminPlan, api, SubscriptionOrder } from '../lib/api';
import { colors, radius, spacing, statusColor, statusLabel } from '../theme';
import { User } from '../types';

const date = (stamp: number | null) => stamp ? new Date(stamp).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const orderStatus: Record<string, string> = { pending: 'بانتظار الدفع/المراجعة', approved: 'مقبول ومفعّل', rejected: 'مرفوض', cancelled: 'ملغي' };

export default function AdminScreen({ user }: { user: User }) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [durationDays, setDurationDays] = useState(30);
  const [planDrafts, setPlanDrafts] = useState<AdminPlan[]>([]);

  const load = useCallback(async () => {
    if (user.role !== 'admin') return;
    setLoading(true); setError('');
    try { const next = await api.adminDashboard(); setData(next); setPlanDrafts(next.plans || []); }
    catch (e) { setError((e as Error)?.message || 'تعذّر تحميل لوحة الإدارة.'); }
    finally { setLoading(false); }
  }, [user.role]);

  useEffect(() => { void load(); }, [load]);

  const decideOrder = async (order: SubscriptionOrder, approve: boolean) => {
    if (approve && !order.paymentReference.trim()) {
      setError('لا يوجد مرجع دفع لهذا الطلب. تأكد من الدفع من خارج التطبيق قبل التفعيل.');
      return;
    }
    setActionId(`order-${order.id}`); setError(''); setMessage('');
    try {
      await api.adminOrderDecision(order.id, approve, adminNote);
      setMessage(approve ? `تم تأكيد الطلب #${order.id} وتفعيل الاشتراك.` : `تم رفض الطلب #${order.id}.`);
      setAdminNote('');
      await load();
    } catch (e) { setError((e as Error)?.message || 'تعذّر تحديث الطلب.'); }
    finally { setActionId(''); }
  };

  const setSub = async (target: User, action: 'activate' | 'extend' | 'suspend' | 'expire') => {
    setActionId(`user-${target.id}-${action}`); setError(''); setMessage('');
    try {
      await api.adminSetSubscription(target.id, action, durationDays, target.planId || 'monthly');
      setMessage(`تم تحديث اشتراك ${target.username}.`);
      await load();
    } catch (e) { setError((e as Error)?.message || 'تعذّر تحديث الاشتراك.'); }
    finally { setActionId(''); }
  };

  const updatePlanDraft = (id: string, patch: Partial<AdminPlan>) => {
    setPlanDrafts((current) => current.map((plan) => plan.id === id ? { ...plan, ...patch } : plan));
  };

  const savePlan = async (plan: AdminPlan) => {
    setActionId(`plan-${plan.id}`); setError(''); setMessage('');
    try {
      const saved = await api.adminUpdatePlan(plan.id, {
        name: plan.name, durationDays: Number(plan.durationDays), active: Boolean(plan.active),
      });
      updatePlanDraft(plan.id, saved);
      setMessage(`تم حفظ باقة ${saved.name}.`);
      await load();
    } catch (e) { setError((e as Error)?.message || 'تعذّر حفظ الباقة.'); }
    finally { setActionId(''); }
  };

  const testGemini = async () => {
    setActionId('gemini-test'); setError(''); setMessage('جارٍ اختبار Gemini من الخادم…');
    try {
      const result = await api.adminTestGemini();
      setMessage(`نجح الاتصال بـGemini (${result.model})، والمفاتيح المضبوطة: ${result.configuredKeys}.`);
      await load();
    } catch (e) { setError((e as Error)?.message || 'فشل اختبار Gemini.'); setMessage(''); }
    finally { setActionId(''); }
  };

  if (user.role !== 'admin') {
    return <View style={[styles.center, { paddingTop: insets.top + 60 }]}>
      <Ionicons name="lock-closed" size={48} color={colors.danger} />
      <Text style={styles.title}>هذه الصفحة للمدير فقط</Text>
      <Text style={styles.note}>سجّل الخروج ثم ادخل باستخدام حساب المدير الذي تم ضبطه في متغيرات الخادم ADMIN_USERNAME وADMIN_PASSWORD. لا يوجد رمز مدير ثابت داخل التطبيق.</Text>
    </View>;
  }

  const users = (data?.users || []).filter((target) => {
    const q = query.trim().toLowerCase();
    return !q || target.username.toLowerCase().includes(q) || (target.profile.fullName || '').toLowerCase().includes(q);
  });
  const orders = data?.orders || [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, paddingBottom: 80 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg }}>
        <View style={{ flex: 1 }}><Text style={styles.title}>لوحة الإدارة المركزية</Text><Text style={styles.note}>الحسابات والاشتراكات والطلبات محفوظة على الخادم.</Text></View>
        <AppButton title="تحديث" icon="refresh-outline" variant="soft" onPress={load} loading={loading} style={{ minWidth: 95 }} />
      </Row>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.success}>{message}</Text> : null}

      <Card>
        <SectionTitle title="نظرة عامة" icon="stats-chart-outline" />
        <View style={styles.statGrid}>
          <Stat value={data?.stats.users ?? '—'} label="المستخدمون" />
          <Stat value={data?.stats.active ?? '—'} label="اشتراكات فعّالة" />
          <Stat value={data?.stats.pendingOrders ?? '—'} label="طلبات معلّقة" />
          <Stat value={data?.stats.expired ?? '—'} label="منتهية" />
          <Stat value={data?.stats.dailyAiRequests ?? '—'} label="طلبات AI الناجحة اليوم" />
        </View>
      </Card>

      <Card>
        <SectionTitle title="Gemini على الخادم" icon="sparkles" />
        <Text style={styles.note}>المفاتيح لا تصل إلى التطبيق ولا تظهر في لوحة الإدارة. أضف GEMINI_API_KEYS إلى إعدادات الخادم؛ افصل المفاتيح بفاصلة أو سطر جديد. الخادم يبدّل بينها تلقائيًا عند أخطاء الحصة أو الصلاحيات. تُحسب حصّة العميل بعد نجاح التحليل فقط.</Text>
        <Row style={{ justifyContent: 'space-between', marginTop: spacing.md }}>
          <Text style={styles.label}>النموذج</Text><Text style={styles.value}>{data?.stats.gemini.model || '—'}</Text>
        </Row>
        <Row style={{ justifyContent: 'space-between', marginTop: spacing.sm }}>
          <Text style={styles.label}>المفاتيح المضبوطة</Text><Text style={[styles.value, { color: data?.stats.gemini.configured ? colors.success : colors.danger }]}>{data?.stats.gemini.totalKeys ?? 0}</Text>
        </Row>
        <Row style={{ justifyContent: 'space-between', marginTop: spacing.sm, marginBottom: spacing.md }}>
          <Text style={styles.label}>المتاحة الآن</Text><Text style={styles.value}>{data?.stats.gemini.availableKeys ?? 0}</Text>
        </Row>
        <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}>
          <Text style={styles.label}>تعليمات الدفع</Text><Text style={[styles.value, { color: data?.stats.paymentConfigured ? colors.success : colors.danger }]}>{data?.stats.paymentConfigured ? 'مضبوطة' : 'غير مضبوطة'}</Text>
        </Row>
        <AppButton title="اختبار اتصال Gemini" icon="cloud-done-outline" onPress={testGemini} loading={actionId === 'gemini-test'} />
      </Card>

      <Card>
        <SectionTitle title="إدارة الباقات" icon="layers-outline" />
        <Text style={styles.note}>إدارة الباقات هنا للمدة والتفعيل فقط. أزلنا الأسعار والعملات من التطبيق؛ اتفق على أي مبلغ وشروط خارج التطبيق قبل الدفع.</Text>
        {!planDrafts.length ? <Text style={styles.note}>لم يتم تحميل الباقات بعد.</Text> : planDrafts.map((plan) => (
          <View key={plan.id} style={styles.planCard}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.orderTitle}>{plan.id}</Text>
              <Text style={[styles.status, { color: plan.active ? colors.success : colors.danger }]}>{plan.active ? 'متاحة للبيع' : 'موقوفة'}</Text>
            </Row>
            <TextInput value={plan.name} onChangeText={(value) => updatePlanDraft(plan.id, { name: value })} placeholder="اسم الباقة" placeholderTextColor={colors.textFaint} style={styles.input} />
            <View>
              <Text style={styles.label}>المدة بالأيام</Text>
              <TextInput value={String(plan.durationDays)} onChangeText={(value) => updatePlanDraft(plan.id, { durationDays: Number.parseInt(value, 10) || 1 })} keyboardType="number-pad" placeholder="المدة" placeholderTextColor={colors.textFaint} style={styles.input} />
            </View>
            <Row style={{ gap: spacing.sm, marginTop: spacing.xs }}>
              <AppButton title={plan.active ? 'إيقاف البيع' : 'إعادة البيع'} icon={plan.active ? 'pause-circle-outline' : 'play-circle-outline'} variant="soft" onPress={() => updatePlanDraft(plan.id, { active: !plan.active })} style={{ flex: 1 }} />
              <AppButton title="حفظ الباقة" icon="save-outline" onPress={() => savePlan(plan)} loading={actionId === `plan-${plan.id}`} style={{ flex: 1 }} />
            </Row>
          </View>
        ))}
      </Card>

      <Card>
        <SectionTitle title="طلبات الاشتراك" icon="receipt-outline" />
        {orders.some((o) => o.status === 'pending') && <FieldNote value={adminNote} onChange={setAdminNote} />}
        {!orders.length ? <Text style={styles.note}>لا توجد طلبات شراء بعد.</Text> : orders.map((order) => (
          <View key={order.id} style={styles.orderCard}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.orderTitle}>#{order.id} — {order.planName}</Text>
                <Text style={styles.note}>المستخدم: {order.username}</Text>
                <Text style={styles.note}>المدة: {order.durationDays || '—'} يومًا • {date(order.createdAt)}</Text>
                <Text style={styles.note}>مرجع الدفع: {order.paymentReference || 'غير موجود'}</Text>
                {!!order.adminNote && <Text style={styles.note}>ملاحظة: {order.adminNote}</Text>}
              </View>
              <Text style={[styles.status, { color: order.status === 'approved' ? colors.success : order.status === 'pending' ? colors.warn : colors.danger }]}>{orderStatus[order.status] || order.status}</Text>
            </Row>
            {order.status === 'pending' && <Row style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <AppButton title="تأكيد الدفع وتفعيل" icon="checkmark-circle-outline" onPress={() => decideOrder(order, true)} loading={actionId === `order-${order.id}`} style={{ flex: 1 }} />
              <AppButton title="رفض" icon="close-circle-outline" variant="danger" onPress={() => decideOrder(order, false)} loading={actionId === `order-${order.id}`} style={{ flex: 0.7 }} />
            </Row>}
          </View>
        ))}
      </Card>

      <Card>
        <SectionTitle title="سجل العمليات الإدارية" icon="shield-checkmark-outline" />
        <Text style={styles.note}>يسجّل الخادم تفعيل الاشتراكات ورفض الطلبات وتغييرات الباقات، مع اسم المدير والهدف والوقت.</Text>
        {!data?.auditLogs?.length ? <Text style={styles.note}>لا توجد عمليات مسجلة بعد.</Text> : data.auditLogs.slice(0, 30).map((log) => (
          <View key={log.id} style={styles.auditRow}>
            <Text style={styles.orderTitle}>{log.action}</Text>
            <Text style={styles.note}>المنفّذ: {log.actorUsername}{log.targetUsername ? ` • المستهدف: ${log.targetUsername}` : ''}</Text>
            <Text style={styles.note}>{date(log.createdAt)} • {log.entityType} #{log.entityId}</Text>
          </View>
        ))}
      </Card>

      <Card>
        <SectionTitle title={`إدارة المستخدمين (${users.length})`} icon="people-outline" />
        <TextInput value={query} onChangeText={setQuery} placeholder="ابحث باسم المستخدم أو الاسم الكامل" placeholderTextColor={colors.textFaint} style={styles.search} />
        <Row style={{ gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' }}>
          {[30, 90, 180, 365].map((days) => <AppButton key={days} title={`${days} يوم`} variant={durationDays === days ? 'primary' : 'soft'} onPress={() => setDurationDays(days)} style={{ minWidth: 70, flex: 1 }} />)}
        </Row>
        {!users.length ? <Text style={styles.note}>لا يوجد مستخدمون مطابقون.</Text> : users.map((target) => (
          <View key={target.id} style={styles.userCard}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}><Text style={styles.orderTitle}>{target.profile.fullName || target.username}</Text><Text style={styles.note}>{target.username} • {target.planName || 'دون باقة'}</Text><Text style={styles.note}>الانتهاء: {date(target.subscriptionEnd)} • استخدام Gemini اليوم: {target.usageToday ?? 0}</Text></View>
              <Text style={[styles.status, { color: statusColor(target.status) }]}>{statusLabel(target.status)}</Text>
            </Row>
            <View style={styles.buttonGrid}>
              <AppButton title="تفعيل" icon="checkmark-circle-outline" onPress={() => setSub(target, 'activate')} loading={actionId === `user-${target.id}-activate`} style={{ flex: 1 }} />
              <AppButton title="تمديد" icon="time-outline" variant="soft" onPress={() => setSub(target, 'extend')} loading={actionId === `user-${target.id}-extend`} style={{ flex: 1 }} />
              <AppButton title="تعليق" icon="pause-circle-outline" variant="danger" onPress={() => setSub(target, 'suspend')} loading={actionId === `user-${target.id}-suspend`} style={{ flex: 1 }} />
              <AppButton title="إنهاء" icon="close-circle-outline" variant="danger" onPress={() => setSub(target, 'expire')} loading={actionId === `user-${target.id}-expire`} style={{ flex: 1 }} />
            </View>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function FieldNote({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <View style={{ marginTop: spacing.sm }}><Text style={styles.label}>ملاحظة تُرفق عند رفض الطلب</Text><TextInput value={value} onChangeText={onChange} placeholder="سبب الرفض أو ملاحظة للعميل" placeholderTextColor={colors.textFaint} style={styles.search} /></View>;
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.xl, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: 22, fontWeight: '900', textAlign: 'right' },
  note: { color: colors.textDim, fontSize: 12, lineHeight: 19, textAlign: 'right', marginTop: 3 },
  statGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.sm },
  stat: { minWidth: '45%', flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, padding: spacing.md, borderRadius: radius.md, alignItems: 'center' },
  statValue: { color: colors.primary, fontSize: 22, fontWeight: '900' }, statLabel: { color: colors.textDim, fontSize: 11, marginTop: 4 },
  label: { color: colors.textDim, fontSize: 12, fontWeight: '700' }, value: { color: colors.text, fontSize: 12, fontWeight: '800' },
  orderCard: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  planCard: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.xs },
  auditRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  input: { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, color: colors.text, paddingHorizontal: spacing.md, paddingVertical: 10, textAlign: 'right', marginTop: spacing.xs, minWidth: 0 },
  orderTitle: { color: colors.text, fontSize: 14, fontWeight: '800', textAlign: 'right' }, status: { fontSize: 11, fontWeight: '900', textAlign: 'right' },
  search: { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, color: colors.text, paddingHorizontal: spacing.md, paddingVertical: 11, textAlign: 'right', marginTop: spacing.sm, marginBottom: spacing.md },
  userCard: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, buttonGrid: { flexDirection: 'row-reverse', gap: spacing.xs, marginTop: spacing.md, flexWrap: 'wrap' },
  error: { color: colors.danger, fontSize: 12, textAlign: 'right', marginBottom: spacing.md, lineHeight: 18 }, success: { color: colors.success, fontSize: 12, textAlign: 'right', marginBottom: spacing.md, lineHeight: 18 },
});
