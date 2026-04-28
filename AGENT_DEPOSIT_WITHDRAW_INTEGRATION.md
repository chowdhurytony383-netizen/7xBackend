# Agent Deposit / Withdraw Integration

This backend includes real MongoDB integration for the Agent Admin panel, user deposit requests, user withdraw requests, agent balance, and user wallet.

## Agent flow

- Main Admin creates agents from `/admin/agents`.
- Agent logs in from `/agent/login`.
- Agent updates payment methods from `/agent/payment-methods`.
- Active payment methods appear on the main website Deposit page.
- User submits deposit request.
- Deposit request appears in Agent Panel.
- Agent confirms/rejects.
- Confirm deposit:
  - User wallet increases.
  - Agent balance decreases.
- User submits withdraw request.
- Withdraw request appears in Agent Panel.
- Agent confirms/rejects.
- Confirm withdraw:
  - User wallet decreases.
  - Agent balance increases.

## New backend routes

```txt
GET    /api/transaction/agent-deposit-options
POST   /api/transaction/agent-deposit-request
POST   /api/transaction/agent-withdraw-request

GET    /api/agent/payment-methods
PUT    /api/agent/payment-methods/:methodKey
GET    /api/agent/requests
POST   /api/agent/requests/:requestId/confirm
POST   /api/agent/requests/:requestId/reject

GET    /api/admin/agent-payment-requests
```

## New/updated backend files

```txt
src/models/Agent.js
src/models/AgentPaymentRequest.js
src/models/AgentTransaction.js
src/models/Transaction.js
src/controllers/transactionController.js
src/controllers/agentPaymentController.js
src/controllers/agentRequestController.js
src/routes/transactionRoutes.js
src/routes/agentPaymentRoutes.js
src/routes/agentRequestRoutes.js
src/routes/adminAgentRequestRoutes.js
src/app.js
```

## Important

Uploads are stored in `/uploads/agent-payments`. On Render free web service disk is not permanent after redeploy. For production, move uploads to Cloudinary/S3 or another persistent storage provider.
