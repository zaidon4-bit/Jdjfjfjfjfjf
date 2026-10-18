import React, { ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps,
  View, ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { colors, radius, shadow, spacing } from '../theme';

export function Card({ children, style, delay = 0 }: { children: ReactNode; style?: ViewStyle; delay?: number }) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(400)} style={[styles.card, style]}>
      {children}
    </Animated.View>
  );
}

export function AppButton({
  title, onPress, icon, variant = 'primary', loading, disabled, style,
}: {
  title: string; onPress: () => void; icon?: any; variant?: 'primary' | 'ghost' | 'danger' | 'soft';
  loading?: boolean; disabled?: boolean; style?: ViewStyle;
}) {
  const bg =
    variant === 'primary' ? colors.primary :
    variant === 'danger' ? 'rgba(248,113,113,0.14)' :
    variant === 'soft' ? colors.surfaceAlt : 'transparent';
  const fg = variant === 'primary' ? '#04140F' : variant === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          borderWidth: variant === 'ghost' || variant === 'danger' ? 1 : 0,
          borderColor: variant === 'danger' ? 'rgba(248,113,113,0.4)' : colors.border },
        variant === 'primary' && shadow.glow,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.btnRow}>
          {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
          <Text style={[styles.btnText, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Field({
  label, value, onChangeText, ...rest
}: { label: string; value: string; onChangeText: (t: string) => void } & TextInputProps) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.textFaint}
        style={styles.input}
        {...rest}
      />
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function SectionTitle({ title, icon }: { title: string; icon?: any }) {
  return (
    <View style={styles.sectionRow}>
      {icon ? <Ionicons name={icon} size={18} color={colors.primary} /> : null}
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

export function EmptyState({ icon, title, subtitle }: { icon: any; title: string; subtitle: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={34} color={colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  btn: { height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  btnRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm },
  btnText: { fontSize: 16, fontWeight: '700' },
  label: { color: colors.textDim, fontSize: 13, marginBottom: 6, textAlign: 'right', fontWeight: '600' },
  input: {
    backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1,
    borderColor: colors.border, color: colors.text, paddingHorizontal: spacing.md,
    paddingVertical: 13, fontSize: 15, textAlign: 'right',
  },
  row: { flexDirection: 'row-reverse', alignItems: 'center' },
  sectionRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'right', flex: 1 },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: spacing.xl },
  emptyIcon: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
  },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  emptySub: { color: colors.textDim, fontSize: 13.5, textAlign: 'center', lineHeight: 21 },
});
