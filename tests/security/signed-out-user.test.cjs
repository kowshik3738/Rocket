const { readFileSync } = require('node:fs');
const { test } = require('node:test');

const {
  initializeTestEnvironment,
  assertFails,
} = require('@firebase/rules-unit-testing');

test('Signed-out users cannot read protected profiles', async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: 'rocket-87c6a',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  try {
    const signedOutUser = testEnv.unauthenticatedContext();
    const db = signedOutUser.firestore();

    await assertFails(
      db.collection('users').doc('test-user-3').get()
    );

    console.log('PASS: Signed-out user was denied access.');
  } finally {
    await testEnv.cleanup();
  }
});
