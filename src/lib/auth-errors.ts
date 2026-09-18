import { FirebaseError } from 'firebase/app';

export function getAuthErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === 'username-already-in-use') {
    return 'That username is already taken. Try another one.';
  }

  if (!(error instanceof FirebaseError)) {
    return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
  }

  switch (error.code) {
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/missing-password':
      return 'Enter your password to continue.';
    case 'auth/weak-password':
      return 'Choose a stronger password with at least 6 characters.';
    case 'auth/email-already-in-use':
      return 'An account already exists with this email.';
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'The email or password is not correct.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact support for help.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/operation-not-allowed':
      return 'Email and password sign-in is not enabled for this Firebase project.';
    case 'permission-denied':
      return 'Rocket could not save your profile. Check your Firestore security rules.';
    case 'unavailable':
      return 'Firestore is temporarily unavailable. Check your connection and try again.';
    default:
      return 'Unable to complete that request. Please try again.';
  }
}
