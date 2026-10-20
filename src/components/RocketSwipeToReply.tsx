import React, { ReactElement, useMemo } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

type Props = {
  children: ReactElement;
  enabled?: boolean;
  onReply: () => void;
};

export function RocketSwipeToReply({ children, enabled = true, onReply }: Props) {
  const translationX = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    alignSelf: 'stretch',
    transform: [{ translateX: translationX.value }],
  }));

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX(12)
        .failOffsetY([-14, 14])
        .onUpdate((event) => {
          translationX.value = Math.min(Math.max(event.translationX, 0), 84);
        })
        .onEnd((event) => {
          if (event.translationX >= 72) runOnJS(onReply)();
          translationX.value = withSpring(0, { damping: 18, stiffness: 220 });
        })
        .onFinalize(() => {
          translationX.value = withSpring(0, { damping: 18, stiffness: 220 });
        }),
    [enabled, onReply, translationX],
  );

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={animatedStyle}>{children}</Animated.View>
    </GestureDetector>
  );
}
