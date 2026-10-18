import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { AppButton, Card, EmptyState } from '../components/ui';
import { store } from '../lib/store';
import { colors, radius, spacing } from '../theme';
import { AnalysisRecord, User } from '../types';

export default function HistoryScreen({ user }: { user: User }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<AnalysisRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<'history' | 'memory'>('history');
  const [memoryItems, setMemoryItems] = useState<AnalysisRecord[]>([]);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    const [all, saved] = await Promise.all([store.analyses(), store.memory()]);
    setItems(all.filter((a) => a.userId === user.id));
    setMemoryItems(saved.filter((a) => a.userId === user.id));
  }, [user.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const remove = async (id: string) => { await store.deleteAnalysis(id); load(); };
  const removeMemory = (id: string) => Alert.alert('حذف الإجابة الثابتة؟', 'بعد الحذف قد يقترح الذكاء الاصطناعي جوابًا مختلفًا إذا حللت السؤال مجددًا.', [
    { text: 'إلغاء', style: 'cancel' },
    { text: 'حذف', style: 'destructive', onPress: async () => { await store.deleteMemory(user.id, id); await load(); } },
  ]);
  const exportMemory = async () => {
    try { setExporting(true); await store.exportMemoryFile(user.id); }
    catch (error) { Alert.alert('تعذّر تصدير الملف', (error as Error)?.message || 'حدث خطأ أثناء تصدير ذاكرة الإجابات.'); }
    finally { setExporting(false); }
  };

  const typeLabel: Record<string, string> = {
    multiple_choice: 'اختيار من متعدد', yes_no: 'نعم / لا', likert: 'مقياس ليكرت',
    scale: 'مقياس رقمي', ranking: 'ترتيب', open_text: 'إجابة مفتوحة', demographic: 'معطيات شخصية',
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, paddingBottom: 110, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
        ListHeaderComponent={
          <View style={{ marginBottom: spacing.md }}>
            <Text style={styles.title}>{mode === 'history' ? 'سجل التحليلات' : 'ذاكرة الإجابات الثابتة'}</Text>
            <Text style={styles.sub}>{mode === 'history' ? `${items.length} تحليل محفوظ محليًا على الجهاز` : `${memoryItems.length} إجابة ثابتة محفوظة محليًا`}</Text>
            <View style={styles.switcher}>
              <Pressable onPress={() => setMode('history')} style={[styles.switchTab, mode === 'history' && styles.switchTabActive]}>
                <Text style={[styles.switchText, mode === 'history' && styles.switchTextActive]}>سجل التحليلات</Text>
              </Pressable>
              <Pressable onPress={() => setMode('memory')} style={[styles.switchTab, mode === 'memory' && styles.switchTabActive]}>
                <Text style={[styles.switchText, mode === 'memory' && styles.switchTextActive]}>إجابات ثابتة ({memoryItems.length})</Text>
              </Pressable>
            </View>
            {mode === 'memory' ? (
              <Card style={{ marginTop: spacing.sm }}>
                <Text style={styles.memoryNote}>تُستخدم الإجابة المحفوظة فقط إذا تطابق السؤال والخيارات بعد توحيد التنسيق. الملف محلي على هذا الجهاز؛ صدّره للاحتفاظ بنسخة احتياطية، ولا تشاركه إذا كان يحتوي على معلومات شخصية.</Text>
                <AppButton title={exporting ? 'جارٍ تجهيز الملف…' : 'تصدير ملف ذاكرة الإجابات JSON'} icon="download-outline" onPress={exportMemory} loading={exporting} disabled={!memoryItems.length} style={{ marginTop: spacing.md }} />
              </Card>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={mode === 'history' ? 'file-tray-full-outline' : 'bookmark-outline'}
            title={mode === 'history' ? 'لا توجد تحليلات بعد' : 'لا توجد إجابات ثابتة بعد'}
            subtitle={mode === 'history' ? 'حلّل سؤالًا من شاشة «تحليل» وسيظهر هنا تلقائيًا.' : 'من نتيجة التحليل اضغط «حفظ هذه الإجابة كإجابة ثابتة». بعدها سيعيد التطبيق الإجابة نفسها عند تكرار السؤال والخيارات.'}
          />
        }
        data={mode === 'history' ? items : memoryItems}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 45)}>
            <Card style={{ borderLeftWidth: 3, borderLeftColor: colors.primary }}>
              <Row>
                <Text style={styles.q} numberOfLines={4}>{item.question}</Text>
                <Pressable hitSlop={10} onPress={() => mode === 'history' ? remove(item.id) : removeMemory(item.id)} style={styles.trash}>
                  <Ionicons name="trash-outline" size={17} color={colors.textFaint} />
                </Pressable>
              </Row>
              {item.suggestion ? (
                <View style={styles.ansRow}>
                  <Ionicons name={mode === 'memory' ? 'lock-closed' : 'sparkles'} size={14} color={colors.primary} />
                  <Text style={styles.ans}>{item.suggestion}</Text>
                </View>
              ) : null}
              {mode === 'memory' && item.options.length ? (
                <Text style={styles.optionsText}>الخيارات: {item.options.join(' · ')}</Text>
              ) : null}
              <View style={styles.metaRow}>
                <View style={styles.chip}><Text style={styles.chipText}>{typeLabel[item.questionType] ?? item.questionType}</Text></View>
                {mode === 'memory' ? <View style={styles.chip}><Text style={styles.chipText}>ثابتة</Text></View> : <View style={styles.chip}><Text style={styles.chipText}>ثقة {Math.round(item.confidence * 100)}%</Text></View>}
                <Text style={styles.date}>{new Date(item.createdAt).toLocaleString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text>
              </View>
            </Card>
          </Animated.View>
        )}
      />
    </View>
  );
}

const Row = ({ children }: { children: any }) => <View style={{ flexDirection: 'row-reverse', alignItems: 'flex-start' }}>{children}</View>;

const styles = StyleSheet.create({
  switcher: { flexDirection: 'row-reverse', gap: 7, backgroundColor: colors.surfaceAlt, padding: 4, borderRadius: radius.md, marginTop: spacing.md },
  switchTab: { flex: 1, borderRadius: radius.sm, paddingVertical: 10, alignItems: 'center' },
  switchTabActive: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: 'rgba(34,211,165,0.25)' },
  switchText: { color: colors.textDim, fontSize: 11.5, fontWeight: '700' },
  switchTextActive: { color: colors.primary },
  memoryNote: { color: colors.textDim, fontSize: 12, lineHeight: 20, textAlign: 'right' },
  optionsText: { color: colors.textFaint, fontSize: 11.5, textAlign: 'right', lineHeight: 19, marginTop: spacing.sm },
  title: { color: colors.text, fontSize: 22, fontWeight: '900', textAlign: 'right' },
  sub: { color: colors.textDim, fontSize: 12.5, textAlign: 'right', marginTop: 4 },
  q: { color: colors.text, fontSize: 14.5, fontWeight: '700', flex: 1, textAlign: 'right', lineHeight: 23 },
  trash: { padding: 4, marginLeft: spacing.sm },
  ansRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: 'rgba(34,211,165,0.1)', borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.md },
  ans: { color: colors.primary, fontSize: 13.5, fontWeight: '800', flex: 1, textAlign: 'right' },
  metaRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  chip: { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  chipText: { color: colors.textDim, fontSize: 10.5, fontWeight: '700' },
  date: { color: colors.textFaint, fontSize: 10.5, marginLeft: 'auto' },
});
