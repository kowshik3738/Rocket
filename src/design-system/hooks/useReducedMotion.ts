import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Hook to respect user's system reduced motion preference.
 * When enabled, animations should be bypassed or reduced to instant transitions.
 */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let isMounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (isMounted) {
          setReducedMotion(Boolean(enabled));
        }
      })
      .catch(() => {
        // Fallback gracefully if platform doesn't support reduce motion check
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        if (isMounted) {
          setReducedMotion(Boolean(enabled));
        }
      }
    );

    return () => {
      isMounted = false;
      subscription?.remove();
    };
  }, []);

  return reducedMotion;
}
