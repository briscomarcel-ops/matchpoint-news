const admin = require('firebase-admin');
const crypto = require('crypto');
const { Resend } = require('resend');

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

async function sendConfirmationEmail(email, name, token) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const confirmUrl = `https://matchpoint-news.netlify.app/confirm.html?token=${token}`;
  const { data, error } = await resend.emails.send({
    from: 'Matchpoint News <newsletter@matchpoint-news.cloud>',
    to: email,
    subject: '🎾 Bitte bestätige deine Anmeldung – Matchpoint News',
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:2rem;">
        <h2 style="color:#1a472a;">Fast geschafft, ${name || 'Tennis-Fan'}!</h2>
        <p>Du hast dich für den <strong>Matchpoint News</strong> Newsletter angemeldet.</p>
        <p>Klicke auf den Button um deine Anmeldung zu bestätigen:</p>
        <a href="${confirmUrl}" style="display:inline-block;margin:1.5rem 0;padding:0.9rem 2rem;background:#1a472a;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">
          Anmeldung bestätigen
        </a>
        <p style="color:#888;font-size:0.85rem;">Der Link ist 24 Stunden gültig.<br/>Falls du dich nicht angemeldet hast, kannst du diese E-Mail ignorieren.</p>
      </div>
    `,
  });
  if (error) {
    console.error('Resend error:', JSON.stringify(error));
    throw new Error(`Resend failed: ${error.message}`);
  }
  console.log('Resend success, email id:', data?.id);
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

  // Honeypot
  if (website) {
    return { statusCode: 200, body: JSON.stringify({ message: 'Erfolgreich angemeldet!' }) };
  }

  // hCaptcha
  if (!captchaToken) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bitte bestätige, dass du kein Roboter bist.' }) };
  }
  const captchaOk = await verifyCaptcha(captchaToken);
  if (!captchaOk) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Captcha-Überprüfung fehlgeschlagen. Bitte versuche es nochmal.' }) };
  }

  // Input-Validierung
  if (!email || !EMAIL_REGEX.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bitte gib eine gültige E-Mail-Adresse ein.' }) };
  }
  if (email.length > 254) {
    return { statusCode: 400, body: JSON.stringify({ error: 'E-Mail-Adresse zu lang.' }) };
  }
  if (name && name.length > 100) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Name zu lang.' }) };
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    console.log('Step 1: Rate limiting check');
    const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentSnap = await db.collection('subscribe_attempts')
      .where('ip', '==', ip)
      .where('at', '>', tenMinutesAgo)
      .get();

    if (recentSnap.size >= 3) {
      return { statusCode: 429, body: JSON.stringify({ error: 'Zu viele Versuche. Bitte warte kurz.' }) };
    }
    await db.collection('subscribe_attempts').add({ ip, at: new Date() });
    console.log('Step 2: Rate limit passed');

    const existing = await db.collection('subscribers')
      .where('email', '==', normalizedEmail)
      .where('active', '==', true)
      .get();

    if (!existing.empty) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Du bist bereits angemeldet!' }) };
    }
    console.log('Step 3: Not already subscribed');

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.collection('pending_subscribers').doc(token).set({
      name: (name || '').trim(),
      email: normalizedEmail,
      token,
      expires_at: expiresAt,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('Step 4: Pending subscriber saved');

    let emailResult = 'not called';
    try {
      await sendConfirmationEmail(normalizedEmail, name, token);
      emailResult = 'success';
    } catch (emailErr) {
      emailResult = emailErr.message;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Fast geschafft!', debug_email: emailResult }),
    };
  } catch (err) {
    console.error('Subscribe error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Serverfehler. Bitte versuche es später nochmal.' }) };
  }
};
