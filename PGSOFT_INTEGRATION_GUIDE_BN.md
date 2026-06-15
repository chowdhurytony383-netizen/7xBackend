# 7XBET — PG SOFT Seamless Wallet Integration Guide

এই replacement backend ও frontend-এ PG SOFT **HTML Scheme + recommended iframe mode** এবং **Seamless Wallet** callback flow যুক্ত করা হয়েছে। Provider credential না পাওয়া পর্যন্ত integration নিরাপদভাবে disabled থাকবে।

## Provider থেকে যে তথ্যগুলো এখনও আবশ্যক

Production চালুর আগে PG SOFT Support থেকে নিচের মানগুলো সংগ্রহ করে backend environment-এ বসাতে হবে:

- `PGSOFT_API_DOMAIN`
- `PGSOFT_OPERATOR_TOKEN`
- `PGSOFT_SECRET_KEY`
- PG SOFT callback/source IP list → `PGSOFT_CALLBACK_ALLOWED_IPS`
- Hash authentication চালু করলে `PGSOFT_HASH_SALT`
- Official game ID/list অথবা Web Lobby entitlement

`PGSOFT_ENABLED=true` কেবল সব production value বসানোর পরে করুন। কোনো secret frontend-এ দেবেন না।

## Integration form অনুযায়ী callback URL

PG SOFT-এর portal/configuration-এ এই URL-গুলো ব্যবহার করুন:

- Verify Session: `https://api.7xbet.asia/api/pgsoft/verify-session`
- Get Wallet: `https://api.7xbet.asia/api/pgsoft/wallet`
- Bet & Payout: `https://api.7xbet.asia/api/pgsoft/bet-payout`
- Balance Adjustment: `https://api.7xbet.asia/api/pgsoft/adjustment`
- Update Bet Detail: `https://api.7xbet.asia/api/pgsoft/update-bet-details`

Document-style aliases (`/VerifySession`, `/Cash/Get`, `/Cash/TransferInOut`, `/Cash/Adjustment`, `/Cash/UpdateBetDetail`) backend-এও রাখা হয়েছে।

## IP whitelist

Integration form-এ operator server IP হিসেবে `167.233.41.237` দেওয়া আছে। PG SOFT-কে তাদের game-launch API whitelist-এ এই IP যোগ করতে বলুন।

`PGSOFT_CALLBACK_ALLOWED_IPS`-এ **PG SOFT-এর outgoing callback IP** দিতে হবে; সেখানে 7XBET server IP বা office IP দেবেন না। Provider IP না পাওয়া পর্যন্ত field ফাঁকা থাকলে IP validation bypass হবে, তাই production activation-এর আগে সেট করা জরুরি।

## Currency ও language

Configured currencies: `BDT, INR, PKR, NPR, LKR, USD`; submitted form অনুযায়ী conversion ratio 1:1। User currency supported না হলে `USD` fallback হবে।

- বাংলা → `bn-BD`
- হিন্দি → `hi-IN`
- উর্দু → `ur-PK`
- সিংহলি → `si-LK`
- Nepali code PG SOFT document-এর supported list-এ নেই, তাই English fallback হবে।

## Launch flow

1. Logged-in player `/pgsoft/:gameId` অথবা lobby (`gameId=lobby`) খোলে।
2. Frontend `/api/pgsoft/launch-ticket` থেকে short-lived one-time ticket নেয়।
3. iframe একই backend origin-এর `/api/pgsoft/play/:ticket` খোলে।
4. Backend PG SOFT `GetLaunchURLHTML` API call করে response HTML browser-এ পাঠায়।
5. iframe-এ required permission রয়েছে: `web-share`, `clipboard-write`, `screen-wake-lock`, `fullscreen`।

একই player-এর একাধিক active PG SOFT session default-এ revoke করা হয়, কারণ provider multiple simultaneous game windows সমর্থন করে না।

## Wallet safety

- Form-urlencoded callback body এবং JSON response
- Success ও protocol error—দুটোতেই HTTP 200
- Operator token/secret timing-safe validation
- Optional PG HMAC SHA256 validation
- GUID `trace_id` validation
- Currency/player/session validation
- `win_amount - bet_amount = transfer_amount` validation
- `real_transfer_amount` validation
- Duplicate transaction idempotency
- Atomic MongoDB wallet update ও balance-before/after audit
- Insufficient balance rejection
- Bet turnover tracking
- Update Bet Detail support

MongoDB production deployment-এ transaction support-এর জন্য replica set/managed MongoDB ব্যবহার করুন।

## Deployment checklist

1. Backend `.env`-এ PG SOFT values বসান।
2. `PGSOFT_PUBLIC_API_ORIGIN=https://api.7xbet.asia` নিশ্চিত করুন।
3. PG SOFT launch API-তে `167.233.41.237` whitelist করান।
4. Provider callback IP allowlist বসান।
5. HTTPS certificate ও reverse proxy-তে form body অপরিবর্তিত যাচ্ছে নিশ্চিত করুন।
6. Staging credential দিয়ে Verify Session, Cash/Get, TransferInOut, duplicate transaction, insufficient balance, Adjustment এবং launch test করুন।
7. Hash authentication production-এ enable করার সুপারিশ করা হয়েছে।
8. সব test সফল হলে `PGSOFT_ENABLED=true` করুন।

## Local verification commands

```bash
npm ci
npm run check
npm run test:pgsoft
```

Frontend:

```bash
npm ci
npm run build
```

## Replacement package verification

এই package তৈরির সময়:

- Backend syntax/import check সফল হয়েছে।
- PG SOFT service unit test ৬/৬ সফল হয়েছে।
- Callback protocol smoke test-এ form-urlencoded request-এর জন্য HTTP 200 JSON error contract সফল হয়েছে।
- Frontend production build সফল হয়েছে।

Provider credential এবং whitelisting অনুপস্থিত থাকায় live PG SOFT endpoint-এর end-to-end launch/real-money callback test করা সম্ভব নয়; staging/production credential পাওয়ার পরে deployment checklist অনুযায়ী test করতে হবে।
