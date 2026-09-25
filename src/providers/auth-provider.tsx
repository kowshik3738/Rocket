import {
    createUserWithEmailAndPassword,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
    signInWithEmailAndPassword,
    User,
} from 'firebase/auth';
import {
    createContext,
    PropsWithChildren,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react';

import { getAuthErrorMessage } from '@/lib/auth-errors';
import { auth } from '@/lib/firebase';
import { createUserProfile, getUserProfile, updateUserProfile, UserProfile, validateUsername } from '@/services/user-service';

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  profileMissing: boolean;
  profileError: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signUp: (displayName: string, username: string, email: string, password: string) => Promise<void>;
  updateProfile: (displayName: string, username: string, bio: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileMissing, setProfileMissing] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setProfile(null);
      setProfileMissing(false);
      setProfileError(null);
      if (!nextUser) {
        setLoading(false);
        return;
      }

      setLoading(true);
      void getUserProfile(nextUser.uid)
        .then((nextProfile) => {
          setProfile(nextProfile);
          setProfileMissing(nextProfile === null);
        })
        .catch((error) => setProfileError(getAuthErrorMessage(error)))
        .finally(() => setLoading(false));
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      profileMissing,
      profileError,
      loading,
      signIn: async (email, password) => {
        try {
          await signInWithEmailAndPassword(auth, email.trim(), password);
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
      signUp: async (displayName, username, email, password) => {
        const usernameError = validateUsername(username);
        if (usernameError) {
          throw new Error(usernameError);
        }
        if (!displayName.trim()) {
          throw new Error('Enter your full name.');
        }

        try {
          const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
          const createdProfile = await createUserProfile(credential.user, displayName, username);
          setProfile(createdProfile);
        } catch (error) {
          throw new Error(getAuthErrorMessage(error));
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
      signOut: async () => {
        try {
          await firebaseSignOut(auth);
        } catch (error) {
          throw new Error(getAuthErrorMessage(error));
        }
      },
    }),
    [loading, profile, profileError, profileMissing, user],
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
