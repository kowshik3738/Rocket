const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const {
  initializeTestEnvironment,
  assertFails,
} = require('@firebase/rules-unit-testing');

test('Unverified users cannot read protected user profiles', async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: 'rocket-87c6a',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  try {
    const unverifiedUser = testEnv.authenticatedContext('test-user-1', {
      email: 'test@example.com',
      email_verified: false,
    });

    const db = unverifiedUser.firestore();

    await assertFails(
      db.collection('users').doc('test-user-1').get()
    );

    console.log('PASS: Unverified user was denied access.');
  } finally {
    await testEnv.cleanup();
  }
});
