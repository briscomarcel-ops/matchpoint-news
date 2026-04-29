const admin = require('firebase-admin');
const { Resend } = require('resend');

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

    // Welcome-Newsletter senden (letzte Ausgabe aus Firestore)
    try {
      const latestDoc = await db.collection('newsletter_latest').doc('current').get();
      if (latestDoc.exists) {
        const latest = latestDoc.data();
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Matchpoint News <newsletter@matchpoint-news.cloud>',
          to: data.email,
          subject: `🎾 Willkommen! ${latest.subject}`,
          html: latest.html,
        });
        console.log('Welcome newsletter sent to', data.email);
      }
    } catch (welcomeErr) {
      console.error('Welcome newsletter error (non-fatal):', welcomeErr.message);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Erfolgreich bestätigt!' }),
    };
  } catch (err) {
    console.error('Confirm error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Serverfehler.' }) };
  }
};
