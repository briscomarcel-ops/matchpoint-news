const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_CREDENTIALS_BASE64, 'base64').toString('utf8')
  );
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

exports.handler = async (event) => {
  const token = event.queryStringParameters?.token;

  if (!token) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Kein Token angegeben.' }) };
  }

  try {
    const docRef = db.collection('pending_subscribers').doc(token);
    const doc = await docRef.get();

    if (!doc.exists) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Ungültiger oder bereits verwendeter Link.' }) };
    }

    const data = doc.data();

    if (new Date() > data.expires_at.toDate()) {
      await docRef.delete();
      return { statusCode: 410, body: JSON.stringify({ error: 'Dieser Link ist abgelaufen. Bitte melde dich erneut an.' }) };
    }

    // Abonnent aktivieren
    await db.collection('subscribers').add({
      name: data.name,
      email: data.email,
      subscribed_at: admin.firestore.FieldValue.serverTimestamp(),
      active: true,
    });

    // Pending-Eintrag löschen
    await docRef.delete();

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Erfolgreich bestätigt!' }),
    };
  } catch (err) {
    console.error('Confirm error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Serverfehler.' }) };
  }
};
