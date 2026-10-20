import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import {
  RocketBrand,
  RocketCard,
  RocketIconButton,
  RocketScreen,
  RocketText,
} from '@/design-system';
import { SpacingScale } from '@/design-system/tokens/spacing';

export default function AboutScreen() {
  return (
    <RocketScreen
      contentContainerStyle={styles.screenContent}
      edges={['top']}
      scroll={true}>
      {/* Top Header Bar */}
      <View style={styles.header}>
        <RocketIconButton
          accessibilityHint="Go back to settings"
          accessibilityLabel="Back"
          glyph="‹"
          glyphStyle={styles.backGlyph}
          onPress={() => router.back()}
          size="md"
          variant="ghost"
        />
        <RocketText style={styles.headerTitle} variant="sectionTitle">
          About Rocket
        </RocketText>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.body}>
        {/* Brand Hero */}
        <View style={styles.brandHero}>
          <RocketBrand showSpark={true} />
          <RocketText
            color="secondary"
            style={styles.tagline}
            variant="bodySecondary">
            Private • Social • Together
          </RocketText>
        </View>

        {/* Mission Statement Card */}
        <RocketCard
          padding="lg"
          style={styles.aboutCard}
          variant="default">
          <RocketText style={styles.cardHeading} variant="bodyMedium">
            The private orbit for your people
          </RocketText>
          <RocketText
            color="secondary"
            style={styles.cardParagraph}
            variant="bodySecondary">
            Rocket is built from the ground up for authentic connections. Real-time conversations, rich media sharing, and close friends — without invasive feeds, intrusive ads, or algorithms deciding what you see.
          </RocketText>
        </RocketCard>

        {/* Principles Card */}
        <RocketCard
          padding="md"
          style={styles.principlesCard}
          variant="default">
          <View style={styles.principleRow}>
            <RocketText style={styles.principleSpark} variant="bodyMedium">
              ✦
            </RocketText>
            <View style={styles.principleTextCol}>
              <RocketText style={styles.principleTitle} variant="captionBold">
                Intimate & Distraction-Free
              </RocketText>
              <RocketText color="secondary" variant="caption">
                Designed for your real friends, not mass broadcast.
              </RocketText>
            </View>
          </View>

          <View style={styles.principleRow}>
            <RocketText style={styles.principleSpark} variant="bodyMedium">
              ✦
            </RocketText>
            <View style={styles.principleTextCol}>
              <RocketText style={styles.principleTitle} variant="captionBold">
                Private & Secure
              </RocketText>
              <RocketText color="secondary" variant="caption">
                One-to-one calls, view-once media, and real friendships.
              </RocketText>
            </View>
          </View>
        </RocketCard>

        {/* Creator Credit (Mandatory) */}
        <View style={styles.creditContainer}>
          <RocketText
            color="secondary"
            style={styles.creatorCredit}
            variant="bodyMedium">
            Created & Designed by Kowshik <RocketText color="highlight">✦</RocketText>
          </RocketText>
        </View>
      </View>
    </RocketScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SpacingScale.xl,
    paddingTop: SpacingScale.sm,
    paddingBottom: SpacingScale.md,
  },
  backGlyph: {
    fontSize: 28,
    fontWeight: '300',
  },
  headerTitle: {
    letterSpacing: -0.3,
  },
  headerSpacer: {
    width: 44,
  },
  body: {
    paddingHorizontal: SpacingScale.xl,
    paddingBottom: SpacingScale.huge,
  },
  brandHero: {
    alignItems: 'center',
    paddingVertical: SpacingScale.xxl,
  },
  tagline: {
    marginTop: SpacingScale.sm,
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  aboutCard: {
    marginBottom: SpacingScale.md,
  },
  cardHeading: {
    fontWeight: '700',
    marginBottom: SpacingScale.xs,
  },
  cardParagraph: {
    lineHeight: 20,
  },
  principlesCard: {
    gap: SpacingScale.md,
    marginBottom: SpacingScale.xxl,
  },
  principleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SpacingScale.md,
  },
  principleSpark: {
    color: '#FF3E83',
    lineHeight: 18,
  },
  principleTextCol: {
    flex: 1,
  },
  principleTitle: {
    letterSpacing: 0.2,
    marginBottom: 2,
  },
  creditContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SpacingScale.xxl,
    marginTop: SpacingScale.lg,
  },
  creatorCredit: {
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
