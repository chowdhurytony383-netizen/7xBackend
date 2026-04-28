export async function sendMail({ to, subject, text }) {
  // Replace this with Resend, Nodemailer, SendGrid, etc. in production.
  console.log('--- 7XBET MAIL OUTBOX ---');
  console.log('To:', to);
  console.log('Subject:', subject);
  console.log(text);
  console.log('-------------------------');
  return true;
}
