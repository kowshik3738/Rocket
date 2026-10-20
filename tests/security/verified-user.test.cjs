const { readFileSync } = require('node:fs');
const { test } = require('node:test');

const {
  initializeTestEnvironment,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');

test('Verified users can read permitted profiles', async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: 'rocket-87c6a',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  try {
    const verifiedUser = testEnv.authenticatedContext('test-user-2', {
      email: 'verified@example.com',
      email_verified: true,
    });

    const db = verifiedUser.firestore();

    await assertSucceeds(
      db.collection('users').doc('test-user-2').get()
    );

    console.log('PASS: Verified user can read permitted profiles.');
  } finally {
    await testEnv.cleanup();
  }
});
