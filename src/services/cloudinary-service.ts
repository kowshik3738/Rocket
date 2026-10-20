import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';

const CLOUD_NAME = 'cmpoe94k';
const UPLOAD_PRESET = 'rocket_photos';
const UPLOAD_ENDPOINT = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
const VIDEO_UPLOAD_PRESET = 'rocket_chat_videos';
const VIDEO_UPLOAD_ENDPOINT = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/video/upload`;
const FILE_UPLOAD_PRESET = 'rocket_chat_files';
const FILE_UPLOAD_ENDPOINT = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`;

export async function uploadPostImage(base64: string | null | undefined, mimeType?: string | null): Promise<string> {
  if (!base64) {
    throw new Error('The selected photo could not be read. Please choose it again.');
  }
  const formData = new FormData();
  formData.append('file', `data:${mimeType || 'image/jpeg'};base64,${base64}`);
  formData.append('upload_preset', UPLOAD_PRESET);

  const response = await fetch(UPLOAD_ENDPOINT, { method: 'POST', body: formData });
  const payload = await response.json() as { secure_url?: string; error?: { message?: string } };
  if (!response.ok || !payload.secure_url || !/^https:\/\//.test(payload.secure_url)) {
    throw new Error(payload.error?.message || 'Photo upload failed. Please try again.');
  }
  return payload.secure_url;
}

export async function uploadChatVideo(uri: string | null | undefined, mimeType?: string | null, fileName?: string | null): Promise<string> {
  if (!uri) {
    throw new Error('The selected video could not be read. Please choose it again.');
  }

  const formData = new FormData();
  const videoFile = new File(uri);
  formData.append('file', videoFile, fileName || undefined);
  formData.append('upload_preset', VIDEO_UPLOAD_PRESET);

  let response: Response;
  try {
    response = await expoFetch(VIDEO_UPLOAD_ENDPOINT, { method: 'POST', body: formData });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'Network request failed';
    throw new Error(`Video upload failed: ${message}`);
  }

  const payload = await response.json().catch(() => null) as { secure_url?: string; error?: { message?: string } } | null;
  if (!response.ok || !payload?.secure_url || !/^https:\/\//.test(payload.secure_url)) {
    throw new Error(payload?.error?.message || `Video upload failed (HTTP ${response.status}).`);
  }
  return payload.secure_url;
}

export async function uploadVoiceMessage(uri: string | null | undefined): Promise<string> {
  if (!uri) {
    throw new Error('The recorded voice message could not be read.');
  }

  let audioFile: File;
  try {
    audioFile = new File(uri);
    if (!audioFile.exists || audioFile.size <= 0) {
      throw new Error('The recorded audio file is missing or empty.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The recorded audio file is invalid.';
    throw new Error(`Voice message upload failed: ${message}`);
  }

  const extension = audioFile.extension.toLowerCase();
  if (extension !== '.m4a' && extension !== '.webm') {
    throw new Error(`Voice message upload failed: unsupported audio format (${extension || 'unknown'}).`);
  }

  const formData = new FormData();
  formData.append('file', audioFile, `voice_message${extension}`);
  formData.append('upload_preset', VIDEO_UPLOAD_PRESET);

  let response: Response;
  try {
    response = await expoFetch(VIDEO_UPLOAD_ENDPOINT, { method: 'POST', body: formData });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'Network request failed';
    throw new Error(`Voice message upload failed: ${message}`);
  }

  const payload = await response.json().catch(() => null) as { secure_url?: string; error?: { message?: string } } | null;
  if (!response.ok || !payload?.secure_url || !/^https:\/\//.test(payload.secure_url)) {
    throw new Error(payload?.error?.message || `Voice message upload failed (HTTP ${response.status}).`);
  }
  return payload.secure_url;
}

export async function uploadChatFile(uri: string | null | undefined, fileName?: string | null): Promise<string> {
  if (!uri) {
    throw new Error('The selected file could not be read. Please choose it again.');
  }

  let response: FileSystemLegacy.FileSystemUploadResult;
  try {
    response = await FileSystemLegacy.uploadAsync(FILE_UPLOAD_ENDPOINT, uri, {
      uploadType: FileSystemLegacy.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      parameters: { upload_preset: FILE_UPLOAD_PRESET },
    });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'Network request failed';
    throw new Error(`File upload failed: ${message}`);
  }

  const payload = (() => {
    try {
      return JSON.parse(response.body) as { secure_url?: string; error?: { message?: string } };
    } catch {
      return null;
    }
  })();
  if (response.status < 200 || response.status >= 300 || !payload?.secure_url || !/^https:\/\//.test(payload.secure_url)) {
    throw new Error(payload?.error?.message || `File upload failed (HTTP ${response.status}).`);
  }
  return payload.secure_url;
}
