const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_CREDENTIALS_BASE64, 'base64').toString('utf8')
  );
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

exports.handler = async (event) => {
  const email = event.queryStringParameters?.email;

  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Keine E-Mail angegeben.' }) };
  }

  try {
    const snap = await db.collection('subscribers')
      .where('email', '==', email.toLowerCase())
      .where('active', '==', true)
      .get();

    if (snap.empty) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Bereits abgemeldet.' }) };
    }

    const batch = db.batch();
    snap.forEach(doc => batch.update(doc.ref, { active: false }));
    await batch.commit();

    return { statusCode: 200, body: JSON.stringify({ message: 'Erfolgreich abgemeldet.' }) };
  } catch (err) {
    console.error('Unsubscribe error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Serverfehler.' }) };
  }
};
