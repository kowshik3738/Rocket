const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const {
  initializeTestEnvironment,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');

test('Unverified users can reserve a username', async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: 'rocket-87c6a',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  try {
    const user = testEnv.authenticatedContext('signup-test-user', {
      email: 'signup@example.com',
      email_verified: false,
    });

    const db = user.firestore();

    await assertSucceeds(
      db.collection('usernames').doc('rocketsignuptest').set({
        uid: 'signup-test-user',
      })
    );

    console.log('PASS: Unverified user reserved a username.');
  } finally {
    await testEnv.cleanup();
  }
});
