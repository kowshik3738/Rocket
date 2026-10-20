const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const {
  initializeTestEnvironment,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');

test('Unverified user can create profile and reserve username together', async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: 'rocket-87c6a',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  try {
    const uid = 'complete-signup-user';
    const username = 'rocketsignup2026';

    const user = testEnv.authenticatedContext(uid, {
      email: 'signup@example.com',
      email_verified: false,
    });

    const db = user.firestore();
    const batch = db.batch();

    batch.set(db.collection('usernames').doc(username), {
      uid,
    });

    batch.set(db.collection('users').doc(uid), {
      uid,
      displayName: 'Rocket Test User',
      username,
      usernameLower: username,
      bio: '',
      createdAt: new Date(),
    });

    await assertSucceeds(batch.commit());

    console.log('PASS: Unverified user completed profile creation.');
  } finally {
    await testEnv.cleanup();
  }
});
