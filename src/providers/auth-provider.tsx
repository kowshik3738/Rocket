import {
    EmailAuthProvider,
    GoogleAuthProvider,
    linkWithCredential,
    reauthenticateWithCredential,
    reload,
    sendEmailVerification,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
    signInWithCredential,
    signInWithEmailAndPassword,
    verifyBeforeUpdateEmail,
    User,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    createContext,
    PropsWithChildren,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import { AppState } from 'react-native';

import { getAuthErrorMessage } from '@/lib/auth-errors';
import { auth } from '@/lib/firebase';
import { startDeliveryObserver } from '@/services/messaging-service';
import { clearLocalDevicePushToken, deleteDevicePushToken } from '@/services/notification-service';
import { setUserOffline, setUserOnline } from '@/services/presence-service';
import {
  createUserProfile,
  getUserProfile,
  isUsernameAvailable,
  normalizeUsername,
  updateUserPhotoUrl,
  updateUserProfile,
  UserProfile,
  validateUsername,
} from '@/services/user-service';

type AuthContextValue = {
  user: User | null;
  verificationUser: User | null;
  verificationError: string | null;
  profile: UserProfile | null;
  profileMissing: boolean;
  profileError: string | null;
  loading: boolean;
  signIn: (identifier: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<'cancelled' | 'profile-missing' | 'complete'>;
  completeGoogleAccount: (username: string, password: string) => Promise<void>;
  refreshVerificationStatus: () => Promise<boolean>;
  getVerificationResendCooldown: () => Promise<number>;
  resendVerificationEmail: (email?: string, password?: string) => Promise<void>;
  changeVerificationEmail: (email: string, password: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updateProfile: (displayName: string, username: string, bio: string) => Promise<void>;
  updateProfilePhoto: (photoUrl: string | null) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const GOOGLE_WEB_CLIENT_ID = '1058072751694-r3ha5mfngv35l65m8aupch0mq32sfgt6.apps.googleusercontent.com';
const VERIFICATION_RESEND_COOLDOWN_MS = 60_000;
const verificationResendTimestamps = new Map<string, number>();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });

function verificationCooldownKey(uid: string): string {
  return `rocket:verification-email-last-sent:${uid}`;
}

async function getVerificationCooldownForUser(currentUser: User | null): Promise<number> {
  if (!currentUser) return 0;
  let timestamp: string | null = null;
  try {
    timestamp = await AsyncStorage.getItem(verificationCooldownKey(currentUser.uid));
  } catch (error) {
    console.warn('[Rocket auth] could not read verification resend cooldown', error);
  }
  const lastSentAt = Number(timestamp) || verificationResendTimestamps.get(currentUser.uid) || 0;
  if (!Number.isFinite(lastSentAt)) return 0;
  return Math.max(0, Math.ceil((lastSentAt + VERIFICATION_RESEND_COOLDOWN_MS - Date.now()) / 1000));
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [verificationUser, setVerificationUser] = useState<User | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileMissing, setProfileMissing] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const resendInFlight = useRef(false);

  useEffect(() => {
    let authStateVersion = 0;
    return onAuthStateChanged(auth, (nextUser) => {
      const version = ++authStateVersion;
      setProfile(null);
      setProfileMissing(false);
      setProfileError(null);
      setVerificationError(null);
      setUser(null);
      setVerificationUser(null);
      setLoading(true);
      if (!nextUser) {
        setLoading(false);
        return;
      }

      void (async () => {
        try {
          await reload(nextUser);
          await nextUser.getIdToken(true);
          if (version !== authStateVersion) return;
          if (!nextUser.emailVerified) {
            setVerificationUser(nextUser);
            setLoading(false);
            return;
          }

          setUser(nextUser);
          try {
            const nextProfile = await getUserProfile(nextUser.uid);
            if (version !== authStateVersion) return;
            setProfile(nextProfile);
            setProfileMissing(nextProfile === null);
          } catch (profileLoadError) {
            if (version === authStateVersion) {
              setProfileError(getAuthErrorMessage(profileLoadError));
            }
          }
        } catch (error) {
          if (version !== authStateVersion) return;
          setVerificationUser(nextUser);
          setVerificationError(
            `We couldn't confirm your email status. Check your connection and try again. ${getAuthErrorMessage(error)}`,
          );
        } finally {
          if (version === authStateVersion) setLoading(false);
        }
      })();
    });
  }, []);

  const refreshVerificationStatus = async (): Promise<boolean> => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setVerificationUser(null);
      setVerificationError('Your verification session has expired. Sign in again to continue.');
      return false;
    }

    setVerificationError(null);
    try {
      await reload(currentUser);
      await currentUser.getIdToken(true);
      if (!currentUser.emailVerified) {
        setVerificationUser(currentUser);
        return false;
      }

      setVerificationUser(null);
      setUser(currentUser);
      setLoading(true);
      try {
        const nextProfile = await getUserProfile(currentUser.uid);
        setProfile(nextProfile);
        setProfileMissing(nextProfile === null);
        setProfileError(null);
      } catch (error) {
        setProfileError(getAuthErrorMessage(error));
      } finally {
        setLoading(false);
      }
      return true;
    } catch (error) {
      const message = `We couldn't confirm your email status. Check your connection and try again. ${getAuthErrorMessage(error)}`;
      setVerificationUser(currentUser);
      setVerificationError(message);
      throw new Error(message);
    }
  };

  useEffect(() => {
    if (!user || profileMissing || profileError) return;

    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const startHeartbeat = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (AppState.currentState === 'active') {
          void setUserOnline(user.uid);
        }
      }, 4 * 60 * 1000); // Gentle 4-minute refresh while active
    };

    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    if (AppState.currentState === 'active') {
      void setUserOnline(user.uid);
      startHeartbeat();
    }

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        void setUserOnline(user.uid);
        startHeartbeat();
      } else if (nextAppState.match(/inactive|background/)) {
        stopHeartbeat();
        void setUserOffline(user.uid);
      }
    });

    const stopDeliveryObserver = startDeliveryObserver(user.uid);

    return () => {
      stopHeartbeat();
      subscription.remove();
      stopDeliveryObserver();
      void setUserOffline(user.uid);
    };
  }, [profileError, profileMissing, user]);

  useEffect(() => {
    if (!verificationUser) return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refreshVerificationStatus().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [verificationUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      verificationUser,
      verificationError,
      profile,
      profileMissing,
      profileError,
      loading,
      signIn: async (identifier, password) => {
        const normalizedIdentifier = identifier.trim();
        if (!EMAIL_PATTERN.test(normalizedIdentifier)) {
          if (/^[a-z0-9_.]{3,30}$/i.test(normalizedIdentifier)) {
            throw new Error('Username sign-in needs a secure backend lookup. For now, sign in with your email address.');
          }
          throw new Error('Enter a valid email address or username.');
        }
        try {
          const credential = await signInWithEmailAndPassword(auth, normalizedIdentifier, password);
          await reload(credential.user);
          await credential.user.getIdToken(true);
          if (!credential.user.emailVerified) {
            setVerificationUser(credential.user);
            throw new Error('Verify your email before signing in. We sent you to the verification screen.');
          }
          setVerificationUser(null);
          setVerificationError(null);
          setUser(credential.user);
          setProfile(null);
          setProfileMissing(false);
          setProfileError(null);
          setLoading(true);
          try {
            const nextProfile = await getUserProfile(credential.user.uid);
            setProfile(nextProfile);
            setProfileMissing(nextProfile === null);
          } catch (profileLoadError) {
            setProfileError(getAuthErrorMessage(profileLoadError));
          } finally {
            setLoading(false);
          }
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Verify your email')) {
            throw error;
          }
          throw new Error(getAuthErrorMessage(error));
        }
      },
      signInWithGoogle: async () => {
        try {
          if (!(await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true }))) {
            throw new Error('Google Play services are unavailable. Update them and try again.');
          }
          const response = await GoogleSignin.signIn();
          if (response.type === 'cancelled') {
            return 'cancelled';
          }
          if (!response.data.idToken) {
            throw new Error('Google did not return an ID token. Try again.');
          }

          const credential = await signInWithCredential(
            auth,
            GoogleAuthProvider.credential(response.data.idToken),
          );
          await reload(credential.user);
          await credential.user.getIdToken(true);
          if (!credential.user.emailVerified) {
            setVerificationUser(credential.user);
            throw new Error('Verify your email before signing in.');
          }

          setVerificationUser(null);
          setVerificationError(null);
          setUser(credential.user);
          setProfile(null);
          setProfileMissing(false);
          setProfileError(null);
          setLoading(true);
          try {
            const nextProfile = await getUserProfile(credential.user.uid);
            setProfile(nextProfile);
            setProfileMissing(nextProfile === null);
            return nextProfile === null ? 'profile-missing' : 'complete';
          } catch (profileLoadError) {
            setProfileError(getAuthErrorMessage(profileLoadError));
            return 'complete';
          } finally {
            setLoading(false);
          }
        } catch (error) {
          if (isErrorWithCode(error)) {
            if (error.code === statusCodes.SIGN_IN_CANCELLED) {
              return 'cancelled';
            }
            if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
              throw new Error('Google Play services are unavailable. Update them and try again.');
            }
            if (error.code === statusCodes.IN_PROGRESS) {
              throw new Error('Google sign-in is already in progress.');
            }
          }
          throw new Error(getAuthErrorMessage(error));
        }
      },
      completeGoogleAccount: async (username, password) => {
        const currentUser = auth.currentUser;
        if (!currentUser || !user || currentUser.uid !== user.uid || !currentUser.email) {
          throw new Error('Your Google session has expired. Sign in again to continue.');
        }
        if (!currentUser.emailVerified) {
          throw new Error('Verify your email before completing your account.');
        }
        if (!currentUser.providerData.some((provider) => provider.providerId === GoogleAuthProvider.PROVIDER_ID)) {
          throw new Error('Account setup must be completed with the Google account used to sign in.');
        }
        const usernameError = validateUsername(username);
        if (usernameError) {
          throw new Error(usernameError);
        }
        if (password.length < 8) {
          throw new Error('Choose a password with at least 8 characters.');
        }
        if (!(await isUsernameAvailable(username))) {
          throw new Error('That username is already taken. Try another one.');
        }

        const passwordCredential = EmailAuthProvider.credential(currentUser.email, password);
        const passwordProviderAlreadyLinked = currentUser.providerData.some(
          (provider) => provider.providerId === EmailAuthProvider.PROVIDER_ID,
        );

        try {
          if (passwordProviderAlreadyLinked) {
            await reauthenticateWithCredential(currentUser, passwordCredential);
          } else {
            try {
              await linkWithCredential(currentUser, passwordCredential);
            } catch (linkError) {
              if (!(linkError instanceof FirebaseError) || linkError.code !== 'auth/requires-recent-login') {
                if (linkError instanceof FirebaseError && linkError.code === 'auth/provider-already-linked') {
                  await reauthenticateWithCredential(currentUser, passwordCredential);
                } else {
                  throw linkError;
                }
              } else {
                if (!(await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true }))) {
                  throw new Error('Google Play services are unavailable. Update them and try again.');
                }
                const googleResponse = await GoogleSignin.signIn();
                if (googleResponse.type === 'cancelled') {
                  throw new Error('Google reauthentication was cancelled.');
                }
                if (!googleResponse.data.idToken) {
                  throw new Error('Google did not return an ID token. Try again.');
                }
                await reauthenticateWithCredential(
                  currentUser,
                  GoogleAuthProvider.credential(googleResponse.data.idToken),
                );
                await linkWithCredential(currentUser, passwordCredential);
              }
            }
          }

          const createdProfile = await createUserProfile(
            currentUser,
            currentUser.displayName || normalizeUsername(username),
            username,
          );
          setProfile(createdProfile);
          setProfileMissing(false);
          setProfileError(null);
        } catch (error) {
          throw new Error(getAuthErrorMessage(error));
        }
      },
      refreshVerificationStatus,
      getVerificationResendCooldown: async () => {
        return getVerificationCooldownForUser(auth.currentUser);
      },
      resendVerificationEmail: async (email, password) => {
        if (resendInFlight.current) {
          throw new Error('A verification email is already being sent. Please wait.');
        }
        resendInFlight.current = true;
        try {
          let currentUser = auth.currentUser;
          if (!currentUser && email?.trim() && password) {
            currentUser = (await signInWithEmailAndPassword(auth, email.trim(), password)).user;
          }
          if (!currentUser) {
            throw new Error('Sign in again to request a verification email.');
          }
          await reload(currentUser);
          await currentUser.getIdToken(true);
          if (currentUser.emailVerified) {
            setVerificationUser(null);
            setUser(currentUser);
            throw new Error('This email is already verified. Sign in to continue.');
          }
          const waitSeconds = await getVerificationCooldownForUser(currentUser);
          if (waitSeconds > 0) {
            throw new Error(`Please wait ${waitSeconds} seconds before requesting another verification email.`);
          }
          await sendEmailVerification(currentUser);
          const sentAt = Date.now();
          verificationResendTimestamps.set(currentUser.uid, sentAt);
          try {
            await AsyncStorage.setItem(verificationCooldownKey(currentUser.uid), String(sentAt));
            setVerificationError(null);
          } catch (storageError) {
            const warning = 'Verification email sent, but the cooldown could not be saved on this device. Firebase may still rate-limit repeated requests.';
            setVerificationError(warning);
            console.warn('[Rocket auth] could not persist verification resend cooldown', storageError);
          }
          setVerificationUser(currentUser);
        } catch (error) {
          if (error instanceof Error && (
            error.message.startsWith('This email is already verified')
            || error.message.startsWith('Please wait ')
            || error.message.startsWith('A verification email')
            || error.message.startsWith('Sign in again')
          )) {
            throw error;
          }
          throw new Error(getAuthErrorMessage(error));
        } finally {
          resendInFlight.current = false;
        }
      },
      changeVerificationEmail: async (email, password) => {
        const currentUser = auth.currentUser;
        if (!currentUser || !currentUser.email) {
          throw new Error('Your verification session has expired. Sign in again to change your email.');
        }
        const nextEmail = email.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
          throw new Error('Enter a valid email address.');
        }
        if (nextEmail.toLowerCase() === currentUser.email.toLowerCase()) {
          throw new Error('Enter a different email address.');
        }
        if (!password) {
          throw new Error('Enter your password to confirm this email change.');
        }
        try {
          const credential = EmailAuthProvider.credential(currentUser.email, password);
          await reauthenticateWithCredential(currentUser, credential);
          await verifyBeforeUpdateEmail(currentUser, nextEmail);
        } catch (error) {
          throw new Error(getAuthErrorMessage(error));
        }
      },
      sendPasswordReset: async (email) => {
        try {
          await sendPasswordResetEmail(auth, email.trim());
        } catch (error) {
          const code = typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: string }).code
            : undefined;

          // Firebase projects without email-enumeration protection can return
          // this error. Treat it as success so Rocket does not disclose which
          // email addresses have accounts.
          if (code === 'auth/user-not-found') return;
          if (code === 'auth/too-many-requests') {
            throw new Error('Too many reset requests. Please wait a moment and try again.');
          }
          if (code === 'auth/network-request-failed') {
            throw new Error('Network error. Check your connection and try again.');
          }
          if (code === 'auth/operation-not-allowed') {
            throw new Error('Password reset is not available right now. Please contact support.');
          }
          throw new Error('We could not send reset instructions. Please try again.');
        }
      },
      updateProfile: async (displayName, username, bio) => {
        if (!user) {
          throw new Error('You must be signed in to edit your profile.');
        }
        const usernameError = validateUsername(username);
        if (usernameError) {
          throw new Error(usernameError);
        }
        if (!displayName.trim()) {
          throw new Error('Enter your full name.');
        }
        if (bio.trim().length > 150) {
          throw new Error('Bio must be 150 characters or fewer.');
        }
        try {
          const updatedProfile = await updateUserProfile(user.uid, displayName, username, bio);
          setProfile(updatedProfile);
        } catch (error) {
          throw new Error(getAuthErrorMessage(error));
        }
      },
      updateProfilePhoto: async (photoUrl) => {
        if (!user) {
          throw new Error('You must be signed in to change your profile photo.');
        }
        try {
          await updateUserPhotoUrl(user.uid, photoUrl);
          setProfile((currentProfile) => currentProfile
            ? { ...currentProfile, photoUrl: photoUrl ?? undefined }
            : currentProfile);
        } catch (error) {
          throw new Error(getAuthErrorMessage(error));
        }
      },
      signOut: async () => {
        try {
          if (user) {
            await setUserOffline(user.uid).catch(() => undefined);
            // Remove the push token from Firestore and local storage so this
            // device no longer receives notifications after sign-out.
            await deleteDevicePushToken(user.uid).catch(() => undefined);
            await clearLocalDevicePushToken(user.uid).catch(() => undefined);
          }
          await firebaseSignOut(auth);
          setVerificationUser(null);
          setVerificationError(null);
        } catch (error) {
          throw new Error(getAuthErrorMessage(error));
        }
      },
    }),
    [loading, profile, profileError, profileMissing, user, verificationUser, verificationError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
