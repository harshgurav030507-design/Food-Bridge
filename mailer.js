// Sends the OTP email. Three modes, picked automatically:
//   1. BREVO_API_KEY set      -> sends over HTTPS using Brevo's API (works on hosts that block SMTP, e.g. Render free)
//   2. EMAIL_USER + EMAIL_APP_PASSWORD set -> sends through Gmail SMTP (good for localhost / VPS / paid hosts)
//   3. nothing set (not production) -> prints the OTP in the terminal for testing

let transporter = null;

function getTransporter() {
  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD
      }
    });
  }
  return transporter;
}

function buildEmail(otp, name) {
  const safeName = String(name).replace(/[<>&"]/g, '');
  return {
    subject: 'Your FoodBridge verification code',
    text: `Hi ${safeName},\n\nYour FoodBridge verification code is ${otp}.\nIt is valid for 10 minutes. If you did not try to register, please ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px">
        <h2 style="color:#059669;margin:0 0 12px">FoodBridge</h2>
        <p>Hi ${safeName},</p>
        <p>Use this code to finish registering your account:</p>
        <p style="font-size:32px;letter-spacing:8px;font-weight:bold;text-align:center;margin:20px 0">${otp}</p>
        <p style="color:#64748b;font-size:13px">This code is valid for 10 minutes. If you did not try to register, you can ignore this email.</p>
      </div>`
  };
}

async function sendViaBrevo(to, otp, name) {
  const mail = buildEmail(otp, name);
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify({
      sender: { name: 'FoodBridge', email: process.env.BREVO_SENDER_EMAIL },
      to: [{ email: to }],
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text
    })
  });
  if (!res.ok) {
    throw new Error(`Brevo API error ${res.status}: ${await res.text()}`);
  }
}

async function sendOtpEmail(to, otp, name) {
  if (process.env.BREVO_API_KEY) {
    return sendViaBrevo(to, otp, name);
  }

  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_APP_PASSWORD;

  if (!user || !pass) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email service is not configured on the server.');
    }
    console.log(`\n[DEV MODE] OTP for ${to} is: ${otp}\n`);
    return;
  }

  const mail = buildEmail(otp, name);
  await getTransporter().sendMail({
    from: `"FoodBridge" <${user}>`,
    to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html
  });
}

module.exports = { sendOtpEmail };
