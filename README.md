# 7XBET Backend

Complete Express + MongoDB backend matching the uploaded 7XBET React frontend.

## What is included

- Cookie-based authentication with access/refresh tokens
- Registration, one-click registration, login, logout
- Google/Facebook OAuth start routes with dev fallback sessions
- Email verification route and password reset OTP flow
- Profile update and KYC/verification document upload
- Wallet transaction history and wallet chart stats
- Razorpay deposit order and signature verification support
- Withdrawal request and admin approval/rejection flow
- Dice game backend route with secure random result
- Mines game backend route with server-side mine board, reveal and cashout
- Bet history and bet statistics routes
- Sports categories, live matches and match-of-the-day routes
- Public content routes for sidebar pages
- Admin panel routes for users, deposits, withdrawals, transactions and games
- Seed script for admin user, games, sports categories, sports matches and page content

## Quick start

```bash
cd 7xbet-backend
npm install
cp .env.example .env
npm run seed
npm run dev
```

Frontend `.env` should point to this backend origin, without `/api`:

```env
VITE_API_URL=http://localhost:3000
VITE_APP_NAME=7XBET
```

Default seed admin:

```txt
Email: admin@7xbet.local
Password: Admin@123456
```

Change these in `.env` before seeding for production.

## API base

All frontend API calls use:

```txt
http://localhost:3000/api
```

Health check:

```txt
GET /api/health
```

## Auth endpoints

```txt
POST /api/user/register
POST /api/user/one-click-register
POST /api/user/login
POST /api/user/logout
POST /api/user/refresh-token
GET  /api/user/is-auth
GET  /api/user/my-details
PATCH /api/user/update-user-details
GET  /api/user/verify-user/:token
GET  /api/user/verify-user?token=...
POST /api/user/resend-verification
POST /api/user/reset-password
POST /api/user/verify-reset-password-otp
POST /api/user/set-new-password
```

## Verification endpoints

```txt
GET   /api/user/verification
POST  /api/user/verification
PATCH /api/user/verification
```

`POST/PATCH /api/user/verification` accepts multipart form-data:

```txt
fullName, email, phone, dateOfBirth, address, street, city, postCode,
documentType, documentNumber, documentFront, documentBack
```

Uploaded files are served from:

```txt
/uploads/verification/<filename>
```

## Game endpoints

```txt
GET   /api/games/get-all-games
POST  /api/games/dice/roll-dice
POST  /api/games/mines/start-mine
GET   /api/games/mines/pending-mine
PATCH /api/games/mines/reveal-tile
POST  /api/games/mines/end-mine
```

## Bet/account endpoints

```txt
GET /api/bet/fetch-bets-by-user
GET /api/bet/fetch-user-bet-by-game?gameId=...
GET /api/bet/get-user-totalwin-and-winningstreak
GET /api/bet/get-user-totalwin-and-winningstreak-by-game?gameId=...
GET /api/user/get-day-wise-wallet-stats
```

## Transaction/payment endpoints

```txt
GET  /api/transaction/get-all-transaction-by-user-id
POST /api/transaction/create-transaction
POST /api/razorpay/create-deposit-order
POST /api/razorpay/verify-deposit-payment
POST /api/razorpay/withdraw-payout-razorpay
```

If `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set, Razorpay deposit orders are created through Razorpay and signatures are verified. If not set, the backend creates dev order IDs for API testing.

## Sports/public content endpoints

```txt
GET /api/sports/categories
GET /api/sports/live-matches
GET /api/sports/match-of-the-day
GET /api/bet-on-games
GET /api/bets/slip
GET /api/bonuses
GET /api/bonuses/welcome
GET /api/bonuses/cashback
GET /api/bonuses/vip
GET /api/games/crash
GET /api/support
GET /api/esports/events
GET /api/casino/live
GET /api/casino/slots
GET /api/other
GET /api/other/promotions
GET /api/other/faq
GET /api/other/rules
GET /api/tournaments
```

## Admin endpoints

Admin access requires authenticated user with `role: "admin"` or permission `admin`.

```txt
GET   /api/admin/overview
GET   /api/admin/users
GET   /api/admin/users/:userId
PATCH /api/admin/users/:userId
PATCH /api/admin/users/:userId/status
PATCH /api/admin/users/:userId/verification
GET   /api/admin/deposits
PATCH /api/admin/deposits/:transactionId/status
GET   /api/admin/withdrawals
PATCH /api/admin/withdrawals/:transactionId/status
GET   /api/admin/transactions
GET   /api/admin/games
PATCH /api/admin/games/:gameId
```

## Production checklist

- Use strong JWT secrets
- Set `COOKIE_SECURE=true` behind HTTPS
- Set exact `FRONTEND_URL`
- Configure real email provider in `src/utils/mailer.js`
- Configure Razorpay keys and webhook handling
- Configure Google/Facebook OAuth credentials
- Add database backups and monitoring
- Review legal/compliance requirements for gaming/payment operations in your jurisdiction
