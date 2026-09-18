import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirebaseOptions, getApp, getApps, initializeApp } from 'firebase/app';
// Firebase selects the React Native Auth entry point at runtime, but its wrapper declarations currently expose only the web exports.
// @ts-expect-error Firebase 12.19.0 omits this React Native conditional export from firebase/auth types.
import { getAuth, getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig: FirebaseOptions = {
  apiKey: 'AIzaSyChm-KB17nuhSkOE7sofYt6npa65D9ywAY',
  authDomain: 'rocket-87c6a.firebaseapp.com',
  projectId: 'rocket-87c6a',
  storageBucket: 'rocket-87c6a.firebasestorage.app',
  messagingSenderId: '1058072751694',
  appId: '1:1058072751694:web:a271e2529f7574e37d5d1f',
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = (() => {
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
})();

export const db = getFirestore(app);

export { app };
