const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_CREDENTIALS_BASE64, 'base64').toString('utf8')
  );
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function verifyCaptcha(token) {
  const res = await fetch('https://hcaptcha.com/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${process.env.HCAPTCHA_SECRET}&response=${token}`,
  });
  const data = await res.json();
  return data.success === true;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültige Anfrage.' }) };
  }

  const { name, email, website, captchaToken } = body;

  // Honeypot: Bots füllen dieses Feld aus, Menschen nicht
  if (website) {
    return { statusCode: 200, body: JSON.stringify({ message: 'Erfolgreich angemeldet!' }) };
  }

  // hCaptcha verifizieren
  if (!captchaToken) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bitte bestätige, dass du kein Roboter bist.' }) };
  }
  const captchaOk = await verifyCaptcha(captchaToken);
  if (!captchaOk) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Captcha-Überprüfung fehlgeschlagen. Bitte versuche es nochmal.' }) };
  }

  // Input-Validierung
  if (!email || !EMAIL_REGEX.test(email)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Bitte gib eine gültige E-Mail-Adresse ein.' }),
    };
  }
  if (email.length > 254) {
    return { statusCode: 400, body: JSON.stringify({ error: 'E-Mail-Adresse zu lang.' }) };
  }
  if (name && name.length > 100) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Name zu lang.' }) };
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    // Rate Limiting: max 3 Anmeldungen pro IP in 10 Minuten
    const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentSnap = await db.collection('subscribe_attempts')
      .where('ip', '==', ip)
      .where('at', '>', tenMinutesAgo)
      .get();

    if (recentSnap.size >= 3) {
      return {
        statusCode: 429,
        body: JSON.stringify({ error: 'Zu viele Versuche. Bitte warte kurz und versuche es erneut.' }),
      };
    }

    // Versuch loggen
    await db.collection('subscribe_attempts').add({ ip, at: new Date() });

    // Duplikat-Check
    const existing = await db.collection('subscribers')
      .where('email', '==', normalizedEmail)
      .get();

    if (!existing.empty) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Du bist bereits angemeldet!' }),
      };
    }

    // Abonnent speichern
    await db.collection('subscribers').add({
      name: (name || '').trim(),
      email: normalizedEmail,
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
