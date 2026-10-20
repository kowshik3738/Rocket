import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/providers/auth-provider';
import { uploadPostImage } from '@/services/cloudinary-service';
import { createPost } from '@/services/posts-service';
import { getProfileColor, getProfileInitials } from '@/services/user-service';
import {
  RocketAvatar,
  RocketButton,
  RocketIconButton,
  RocketPressable,
  RocketScreen,
  RocketText,
  useRocketTheme,
} from '@/design-system';
import { Radius } from '@/design-system/tokens/radius';
import { SpacingScale } from '@/design-system/tokens/spacing';

export default function CreatePostScreen() {
  const { profile, user } = useAuth();
  const { colors } = useRocketTheme();

  const [text, setText] = useState('');
  const [image, setImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false);

  const avatar = profile
    ? {
        initials: getProfileInitials(profile.displayName),
        color: getProfileColor(profile.uid),
      }
    : null;

  async function handlePickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo permission is needed to choose an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      base64: true,
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.85,
    });
    if (!result.canceled) {
      setImage(result.assets[0]);
      setError('');
    }
  }

  async function handlePublish() {
    if (!user || publishing || (!text.trim() && !image)) return;
    setError('');
    setPublishing(true);
    try {
      const imageUrl = image
        ? await uploadPostImage(image.base64, image.mimeType)
        : null;
      await createPost(user.uid, text, imageUrl);
      setText('');
      setImage(null);
      router.push('/(tabs)');
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : 'Could not publish your post.'
      );
    } finally {
      setPublishing(false);
    }
  }

  const canPublish = !publishing && (text.trim().length > 0 || image !== null);

  return (
    <RocketScreen
      contentContainerStyle={styles.screenContent}
      edges={['top']}
      scroll={false}>
      {/* Top Header Bar */}
      <View style={styles.header}>
        <RocketIconButton
          accessibilityHint="Cancel post creation and go back"
          accessibilityLabel="Cancel"
          glyph="✕"
          glyphStyle={styles.cancelGlyph}
          onPress={() => router.back()}
          size="md"
          variant="ghost"
        />
        <RocketText style={styles.headerTitle} variant="sectionTitle">
          New post
        </RocketText>
        <RocketButton
          accessibilityHint="Publish your post to your orbit"
          accessibilityLabel="Publish post"
          disabled={!canPublish}
          fullWidth={false}
          label="Publish"
          loading={publishing}
          onPress={() => void handlePublish()}
          size="sm"
          variant="primary"
        />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardContainer}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* Author info */}
          {profile && avatar ? (
            <View style={styles.authorRow}>
              <RocketAvatar
                hasOrbit={false}
                size={44}
                source={profile.photoUrl}
                user={avatar}
              />
              <View style={styles.authorInfo}>
                <RocketText style={styles.authorName} variant="bodyMedium">
                  {profile.displayName}
                </RocketText>
                <RocketText color="secondary" variant="caption">
                  Sharing to your orbit
                </RocketText>
              </View>
            </View>
          ) : null}

          {/* Text Input Composer */}
          <TextInput
            autoCapitalize="sentences"
            maxLength={1000}
            multiline
            onChangeText={(value) => setText(value.slice(0, 1000))}
            placeholder="Share something with your orbit..."
            placeholderTextColor={colors.mutedText}
            style={[
              styles.textInput,
              {
                color: colors.primaryText,
                backgroundColor: colors.surface,
                borderColor: colors.borderSubtle,
              },
            ]}
            textAlignVertical="top"
            value={text}
          />

          {/* Character counter */}
          <View style={styles.metaRow}>
            <RocketText color="muted" variant="caption">
              {text.length}/1000
            </RocketText>
          </View>

          {/* Media preview or upload button */}
          {image ? (
            <View
              style={[
                styles.imagePreviewContainer,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderSubtle,
                },
              ]}>
              <Image
                contentFit="cover"
                source={image.uri}
                style={styles.previewImage}
              />
              <View style={styles.imageOverlayActions}>
                <RocketPressable
                  accessibilityHint="Remove selected image"
                  accessibilityLabel="Remove photo"
                  accessibilityRole="button"
                  onPress={() => setImage(null)}
                  style={[
                    styles.removeImageBadge,
                    { backgroundColor: 'rgba(0, 0, 0, 0.75)' },
                  ]}>
                  <Text style={styles.removeIcon}>✕</Text>
                  <RocketText color="primary" variant="captionBold">
                    Remove
                  </RocketText>
                </RocketPressable>

                <RocketPressable
                  accessibilityHint="Change selected photo"
                  accessibilityLabel="Change photo"
                  accessibilityRole="button"
                  onPress={() => void handlePickImage()}
                  style={[
                    styles.changeImageBadge,
                    { backgroundColor: 'rgba(0, 0, 0, 0.75)' },
                  ]}>
                  <Text style={styles.changeIcon}>✎</Text>
                  <RocketText color="primary" variant="captionBold">
                    Change
                  </RocketText>
                </RocketPressable>
              </View>
            </View>
          ) : (
            <RocketPressable
              accessibilityHint="Choose a photo from your library"
              accessibilityLabel="Add photo"
              accessibilityRole="button"
              onPress={() => void handlePickImage()}
              style={[
                styles.addPhotoButton,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderSubtle,
                },
              ]}>
              <Text style={[styles.photoGlyph, { color: colors.primaryAccent }]}>
                📷
              </Text>
              <RocketText style={styles.addPhotoText} variant="bodyMedium">
                Add a photo
              </RocketText>
              <RocketText color="muted" variant="caption">
                PNG or JPEG up to high resolution
              </RocketText>
            </RocketPressable>
          )}

          {/* Error notice */}
          {error ? (
            <View style={styles.errorBox}>
              <RocketText color="error" style={styles.errorText} variant="caption">
                {error}
              </RocketText>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
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
  cancelGlyph: {
    fontSize: 16,
    fontWeight: '700',
  },
  headerTitle: {
    letterSpacing: -0.3,
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SpacingScale.xl,
    paddingBottom: SpacingScale.huge,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SpacingScale.md,
    marginBottom: SpacingScale.lg,
  },
  authorInfo: {
    justifyContent: 'center',
  },
  authorName: {
    fontWeight: '700',
  },
  textInput: {
    minHeight: 140,
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: SpacingScale.lg,
    fontSize: 15,
    lineHeight: 22,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: SpacingScale.xs,
    marginBottom: SpacingScale.md,
  },
  imagePreviewContainer: {
    width: '100%',
    height: 220,
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: SpacingScale.md,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  imageOverlayActions: {
    position: 'absolute',
    bottom: SpacingScale.sm,
    right: SpacingScale.sm,
    flexDirection: 'row',
    gap: SpacingScale.xs,
  },
  removeImageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Radius.full,
  },
  removeIcon: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  changeImageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Radius.full,
  },
  changeIcon: {
    color: '#FFFFFF',
    fontSize: 12,
  },
  addPhotoButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SpacingScale.xxl,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: SpacingScale.md,
  },
  photoGlyph: {
    fontSize: 26,
    marginBottom: SpacingScale.xs,
  },
  addPhotoText: {
    fontWeight: '700',
    marginBottom: 2,
  },
  errorBox: {
    marginTop: SpacingScale.sm,
  },
  errorText: {
    textAlign: 'center',
  },
});
