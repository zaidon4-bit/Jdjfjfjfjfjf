import React, { useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, shadow, spacing } from '../theme';

const { width: W, height: H } = Dimensions.get('window');

/**
 * In-app simulation of the Android SYSTEM_ALERT_WINDOW floating bubble.
 * On a device build this is replaced by an Android native overlay service
 * (MediaProjection capture + ML Kit OCR on tap).
 */
export default function FloatingAssistant({ onPress, active }: { onPress: () => void; active: boolean }) {
  const x = useSharedValue(W - 74);
  const y = useSharedValue(H - 220);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const [dragged, setDragged] = useState(false);

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = x.value;
      startY.value = y.value;
      runOnJS(setDragged)(true);
    })
    .onUpdate((e) => {
      x.value = Math.min(Math.max(8, startX.value + e.translationX), W - 66);
      y.value = Math.min(Math.max(60, startY.value + e.translationY), H - 110);
    })
    .onEnd(() => {
      x.value = withSpring(x.value > W / 2 ? W - 74 : 12, { damping: 16 });
    });

  const tap = Gesture.Tap().onEnd(() => {
    if (!dragged) runOnJS(onPress)();
  });

  const composed = Gesture.Simultaneous(pan, tap);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }] }));

  if (!active) return null;

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[styles.bubble, style]}>
        <View style={styles.pulse} />
        <View style={styles.core}>
          <Ionicons name="sparkles" size={24} color="#04140F" />
        </View>
        <Text style={styles.tip}>اسحبني أو اضغط</Text>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  bubble: { position: 'absolute', alignItems: 'center', zIndex: 50 },
  pulse: {
    position: 'absolute', top: -6, width: 60, height: 60, borderRadius: 30,
    backgroundColor: 'rgba(34,211,165,0.18)',
  },
  core: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)',
    ...shadow.glow,
  },
  tip: { color: colors.text, fontSize: 9.5, marginTop: 4, fontWeight: '700', backgroundColor: 'rgba(7,11,20,0.7)', paddingHorizontal: 6, borderRadius: radius.pill, overflow: 'hidden' },
});
