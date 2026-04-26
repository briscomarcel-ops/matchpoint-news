const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_CREDENTIALS_BASE64, 'base64').toString('utf8')
  );
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { name, email } = JSON.parse(event.body);

    if (!email || !email.includes('@')) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Bitte gib eine gültige E-Mail-Adresse ein.' }),
      };
    }

    const existing = await db.collection('subscribers')
      .where('email', '==', email.toLowerCase())
      .get();

    if (!existing.empty) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Du bist bereits angemeldet!' }),
      };
    }

    await db.collection('subscribers').add({
      name: name || '',
      email: email.toLowerCase(),
      subscribed_at: admin.firestore.FieldValue.serverTimestamp(),
      active: true,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Erfolgreich angemeldet!' }),
    };
  } catch (err) {
    console.error('Subscribe error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Serverfehler. Bitte versuche es später nochmal.' }),
    };
  }
};
