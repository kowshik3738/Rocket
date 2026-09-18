import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar, PrimaryButton, Screen, colors } from '@/components/rocket-ui';
import { useAuth } from '@/providers/auth-provider';
import { uploadPostImage } from '@/services/cloudinary-service';
import { createPost } from '@/services/posts-service';
import { getProfileColor, getProfileInitials } from '@/services/user-service';

export default function CreatePostScreen() {
  const { profile, user } = useAuth();
  const [text, setText] = useState('');
  const [image, setImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const avatar = profile ? { initials: getProfileInitials(profile.displayName), color: getProfileColor(profile.uid) } : null;

  async function handlePickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError('Photo permission is needed to choose an image.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ base64: true, mediaTypes: ['images'], allowsEditing: true, quality: 0.85 });
    if (!result.canceled) { setImage(result.assets[0]); setError(''); }
  }

  async function handlePublish() {
    if (!user) return;
    setError('');
    setPublishing(true);
    try {
      const imageUrl = image ? await uploadPostImage(image.base64, image.mimeType) : null;
      await createPost(user.uid, text, imageUrl);
      setText('');
      setImage(null);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Could not publish your post.');
    } finally { setPublishing(false); }
  }

  return <Screen><View style={page.content}><View style={page.header}><Text style={page.title}>Create a post</Text><Text style={page.type}>Photo or text</Text></View>{avatar && profile ? <View style={page.author}><Avatar user={avatar} size={44} /><View><Text style={page.name}>{profile.displayName}</Text><Text style={page.visibility}>Your orbit</Text></View></View> : null}<Pressable onPress={() => void handlePickImage()} style={page.photoButton}>{image ? <Image contentFit="cover" source={image.uri} style={page.preview} /> : <><Text style={page.photoIcon}>＋</Text><Text style={page.photoTitle}>Add a photo</Text></>}</Pressable>{image ? <Pressable onPress={() => setImage(null)}><Text style={page.remove}>Remove photo</Text></Pressable> : null}<TextInput autoCapitalize="sentences" multiline onChangeText={(value) => setText(value.slice(0, 1000))} placeholder="Share something with your orbit..." placeholderTextColor={colors.textSecondary} style={page.input} textAlignVertical="top" value={text} /><Text style={page.counter}>{text.length}/1000</Text>{error ? <Text style={page.error}>{error}</Text> : null}<PrimaryButton disabled={publishing || (!text.trim() && !image)} label={publishing ? 'Publishing...' : 'Publish post'} onPress={() => void handlePublish()} /><Text style={page.note}>Photos upload directly to Cloudinary using Rocket's unsigned preset.</Text></View></Screen>;
}

const page = StyleSheet.create({ content: { gap: 0 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 17, marginBottom: 26 }, title: { color: colors.text, fontSize: 28, fontWeight: '900' }, type: { color: colors.accent, fontWeight: '700', fontSize: 13 }, author: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 22 }, name: { color: colors.text, fontWeight: '800', fontSize: 14 }, visibility: { color: colors.textSecondary, fontSize: 12, marginTop: 4 }, photoButton: { height: 180, borderRadius: 22, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.backgroundElement, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 8 }, preview: { width: '100%', height: '100%' }, photoIcon: { color: colors.accent, fontSize: 31 }, photoTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 8 }, remove: { color: colors.accent, textAlign: 'right', fontSize: 12, fontWeight: '700', marginBottom: 12 }, input: { minHeight: 150, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundElement, color: colors.text, fontSize: 16, lineHeight: 23, padding: 16 }, counter: { color: colors.textSecondary, fontSize: 11, textAlign: 'right', marginTop: 7, marginBottom: 17 }, error: { color: colors.accent, fontSize: 13, marginBottom: 15 }, note: { color: colors.textSecondary, fontSize: 11, textAlign: 'center', marginTop: 14 } });
