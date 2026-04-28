# Registration and Agent Update

Added:
- Unique userId for all new users.
- One Click Registration with all-country selector, auto currency, optional referral code, and generated login/password modal.
- Manual Registration with Full Name, Country, auto currency, Email, Password, Confirm Password, and show/hide password.
- Login supports Email or User ID.
- Google/Facebook OAuth users get a unique User ID and country/currency best-effort from OAuth locale.
- Main Admin can create agents and top up agent balance by Agent ID.
- Separate Agent Login and Agent Dashboard.

Important:
- Google/Facebook providers do not always return a reliable country. The backend uses OAuth locale when available, otherwise Bangladesh is the fallback.
- For production Google/Facebook auth, configure real OAuth callback URLs and secrets in Render.
- For source games, public/originals is the correct spelling.
