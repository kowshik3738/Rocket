import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { useAuth } from '@/providers/auth-provider';
import { uploadPostImage } from '@/services/cloudinary-service';
import { getProfileColor, getProfileInitials } from '@/services/user-service';
import {
  RocketAvatar,
  RocketButton,
  RocketEmptyState,
  RocketIconButton,
  RocketInput,
  RocketScreen,
  RocketText,
} from '@/design-system';
import { SpacingScale } from '@/design-system/tokens/spacing';

export default function EditProfileScreen() {
  const { profile, updateProfile, updateProfilePhoto } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [selectedPhoto, setSelectedPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [photoStage, setPhotoStage] = useState<'uploading' | 'saving' | null>(null);
  const photoOperation = useRef(false);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName);
    setUsername(profile.username);
    setBio(profile.bio || '');
  }, [profile]);

  async function handleSave() {
    if (photoOperation.current) return;
    setError('');
    setSaving(true);
    try {
      await updateProfile(displayName, username, bio);
      router.back();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Could not save your profile.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleChoosePhoto() {
    if (saving || photoOperation.current) return;
    setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        base64: true,
        quality: 0.9,
      });
      if (!result.canceled) {
        setSelectedPhoto(result.assets[0]);
      }
    } catch (pickerError) {
      setError(
        pickerError instanceof Error
          ? pickerError.message
          : 'Could not open your photo library.'
      );
    }
  }

  async function handleUploadPhoto() {
    if (!selectedPhoto || saving || photoOperation.current) return;
    photoOperation.current = true;
    setError('');
    setPhotoStage('uploading');
    try {
      const photoUrl = await uploadPostImage(selectedPhoto.base64, selectedPhoto.mimeType);
      setPhotoStage('saving');
      await updateProfilePhoto(photoUrl);
      setSelectedPhoto(null);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : 'Could not update your profile photo.'
      );
    } finally {
      photoOperation.current = false;
      setPhotoStage(null);
    }
  }

  function confirmRemovePhoto() {
    if (!profile?.photoUrl || saving || photoOperation.current) return;
    Alert.alert('Remove profile photo?', 'Your initials will be shown instead.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove photo',
        style: 'destructive',
        onPress: () => void handleRemovePhoto(),
      },
    ]);
  }

  async function handleRemovePhoto() {
    if (saving || photoOperation.current) return;
    photoOperation.current = true;
    setError('');
    setPhotoStage('saving');
    try {
      await updateProfilePhoto(null);
      setSelectedPhoto(null);
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : 'Could not remove your profile photo.'
      );
    } finally {
      photoOperation.current = false;
      setPhotoStage(null);
    }
  }

  if (!profile) {
    return (
      <RocketScreen scroll={false}>
        <RocketEmptyState
          action={
            <RocketButton
              label="Go back"
              onPress={() => router.back()}
              size="md"
              variant="secondary"
            />
          }
          body="Your Rocket profile could not be loaded."
          title="Profile setup required"
        />
      </RocketScreen>
    );
  }

  const avatar = {
    initials: getProfileInitials(profile.displayName),
    color: getProfileColor(profile.uid),
  };

  return (
    <RocketScreen
      contentContainerStyle={styles.screenContent}
      edges={['top']}
      scroll={false}>
      {/* Top Header Bar */}
      <View style={styles.header}>
        <RocketIconButton
          accessibilityHint="Go back without saving"
          accessibilityLabel="Back"
          glyph="‹"
          glyphStyle={styles.backGlyph}
          onPress={() => router.back()}
          size="md"
          variant="ghost"
        />
        <RocketText style={styles.headerTitle} variant="sectionTitle">
          Edit profile
        </RocketText>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardContainer}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* Avatar block */}
          <View style={styles.avatarSection}>
            <RocketAvatar
              hasOrbit={true}
              size={88}
              source={selectedPhoto?.uri ?? profile.photoUrl}
              user={avatar}
            />
            <RocketText color="secondary" style={styles.avatarNotice} variant="caption">
              {selectedPhoto ? 'Previewing selected photo' : profile.photoUrl ? 'Your profile photo' : 'Your initials are shown until you add a photo'}
            </RocketText>
            <RocketButton
              disabled={saving || photoStage !== null}
              label={profile.photoUrl || selectedPhoto ? 'Choose or change photo' : 'Choose profile photo'}
              onPress={() => void handleChoosePhoto()}
              size="sm"
              style={styles.photoButton}
              variant="secondary"
            />
            {selectedPhoto ? (
              <>
                <RocketButton
                  disabled={saving || photoStage !== null}
                  label={photoStage === 'uploading' ? 'Uploading photo...' : photoStage === 'saving' ? 'Saving photo...' : 'Upload profile photo'}
                  loading={photoStage !== null}
                  onPress={() => void handleUploadPhoto()}
                  size="sm"
                  style={styles.photoButton}
                  variant="primary"
                />
                <RocketButton
                  disabled={saving || photoStage !== null}
                  label="Discard selected photo"
                  onPress={() => setSelectedPhoto(null)}
                  size="sm"
                  variant="ghost"
                />
              </>
            ) : null}
            {profile.photoUrl ? (
              <RocketButton
                disabled={saving || photoStage !== null}
                label={photoStage === 'saving' ? 'Removing photo...' : 'Remove profile photo'}
                loading={photoStage === 'saving'}
                onPress={confirmRemovePhoto}
                size="sm"
                style={styles.photoButton}
                variant="ghost"
              />
            ) : null}
          </View>

          {/* Form fields */}
          <View style={styles.form}>
            <RocketInput
              autoCapitalize="words"
              label="Display name"
              onChangeText={setDisplayName}
              placeholder="Your full name"
              value={displayName}
            />

            <RocketInput
              autoCapitalize="none"
              autoCorrect={false}
              helper="Must be unique, 3-20 characters (letters, numbers, underscores)"
              label="Username"
              onChangeText={setUsername}
              placeholder="your.username"
              value={username}
            />

            <RocketInput
              autoCapitalize="sentences"
              helper={`${bio.length}/150 characters`}
              label="Bio"
              maxLength={150}
              multiline
              numberOfLines={3}
              onChangeText={(val) => setBio(val.slice(0, 150))}
              placeholder="Tell people a little about you..."
              value={bio}
            />

            {error ? (
              <View style={styles.errorBox}>
                <RocketText color="error" style={styles.errorText} variant="caption">
                  {error}
                </RocketText>
              </View>
            ) : null}

            <RocketButton
              disabled={saving || photoStage !== null || !displayName.trim() || !username.trim()}
              label={saving ? 'Saving changes...' : 'Save changes'}
              loading={saving}
              onPress={() => void handleSave()}
              size="lg"
              style={styles.saveButton}
              variant="primary"
            />
          </View>
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
  keyboardContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SpacingScale.xl,
    paddingBottom: SpacingScale.huge,
  },
  avatarSection: {
    alignItems: 'center',
    marginTop: SpacingScale.md,
    marginBottom: SpacingScale.xl,
  },
  avatarNotice: {
    marginTop: SpacingScale.sm,
    textAlign: 'center',
  },
  photoButton: {
    marginTop: SpacingScale.sm,
  },
  form: {
    gap: SpacingScale.xs,
  },
  errorBox: {
    marginTop: SpacingScale.xs,
    marginBottom: SpacingScale.sm,
  },
  errorText: {
    textAlign: 'center',
  },
  saveButton: {
    marginTop: SpacingScale.md,
  },
});
