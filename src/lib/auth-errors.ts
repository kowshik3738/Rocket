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
      return 'Choose a stronger password with at least 8 characters.';
    case 'auth/email-already-in-use':
    case 'auth/credential-already-in-use':
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email. Sign in using its existing method; accounts are not merged automatically.';
    case 'auth/provider-already-linked':
      return 'This sign-in method is already linked to your account. Confirm your existing password and try again.';
    case 'auth/requires-recent-login':
      return 'For your security, sign in again and retry this action.';
    case 'auth/expired-action-code':
    case 'auth/invalid-action-code':
      return 'This verification link has expired or is invalid. Request a new verification email.';
    case 'auth/invalid-continue-uri':
    case 'auth/unauthorized-continue-uri':
      return 'Firebase email-action link settings are not configured for this app. Contact support.';
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
