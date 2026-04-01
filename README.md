# Stellar Autopay

> Automated recurring & scheduled payment system built on the Stellar blockchain (testnet).  
> No secret keys. No backend. Fully on-chain bill management via Soroban smart contracts.

---

## 🔗 Links

| | |
|---|---|
| **Live Demo** | _Deploy to Vercel/Netlify and add your URL here_ |
| **Demo Video** | _Record and add your Loom/YouTube link here_ |
| **Smart Contract** | [`CC7XBIWVBKEAKUMADCPRDC5O2WAI6D2WK5KJS4CTEKQ2ZS3TEHXYHSY5`](https://stellar.expert/explorer/testnet/contract/CC7XBIWVBKEAKUMADCPRDC5O2WAI6D2WK5KJS4CTEKQ2ZS3TEHXYHSY5) |
| **User Feedback** | [Google Form](https://docs.google.com/forms/d/e/1FAIpQLSfp4qWFnQUWYiruEyvELlv1RJkK7_Q7UtrEXu4Ze-QmYMtb8A/viewform) |

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Smart Contract](#smart-contract)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Usage Guide](#usage-guide)
- [Security Model](#security-model)
- [Project Structure](#project-structure)
- [Test Wallet Addresses](#test-wallet-addresses)
- [Demo Video](#demo-video)
- [User Feedback](#user-feedback)
- [Contributing](#contributing)

---

## Overview

**Stellar Autopay** is a React single-page application that brings automated recurring payments to the Stellar blockchain. Users connect their wallet (Freighter, xBull, Lobstr, Albedo), define payment schedules, and optionally enable a **Session Signing Key** system so payments execute automatically — no manual approval needed for each transaction.

All bill data and payment history are stored **on-chain** via a Soroban smart contract deployed on Stellar testnet. No backend server is required.

---

## ✨ Features

### 💳 Wallet Connect (No Secret Key)
- Connect via Stellar Wallets Kit (Freighter, xBull, Lobstr, Albedo, and more)
- Secret key never enters the application
- Live balance display from Horizon testnet API

### 📅 Bill Management (On-Chain)
- Add recurring and one-time scheduled payments
- Supported assets: **XLM** and **USDC**
- Supported frequencies: Weekly, Biweekly, Monthly, Monthly on specific day, Quarterly, One-Time
- Smart month-end handling: 31 → 30 in April, 28/29 in February (leap-year aware)
- Pause, resume, and delete bills
- All bills stored in Soroban smart contract — persists across sessions and devices

### ⚡ Auto-Pay Engine
- **Session Signing Key** system: on first enable, browser generates a temporary keypair → user signs one `setOptions` transaction adding it as an account signer → subsequent payments are signed automatically
- Payment engine polls every 60 seconds for due bills
- Balance check before each payment — skips if insufficient
- On success: logs tx hash to on-chain payment history, updates next due date
- On failure: logs error, retries next cycle
- Auto-Pay OFF mode: Freighter popup for each due payment (manual approval)

### 🗓 Smart Date Scheduling
- **Monthly on specific day**: choose day 1–31; engine clamps to last day of short months
- **February handling**: day 29/30/31 automatically maps to 28 (or 29 on leap year)
- **30-second tolerance**: prevents clock jitter from missing payments
- `paidBillsRef` in-memory guard + localStorage "paid-keys" persistent guard prevent double payments

### 📊 Payment History (On-Chain)
- All payment attempts recorded in Soroban contract: bill name, amount, date, tx hash, status
- Links to [Stellar Expert](https://stellar.expert/explorer/testnet) and [Horizon API](https://horizon-testnet.stellar.org) for each transaction
- History persists across page reloads and logins

### 🔔 Telegram Notifications
- Configure bot token + chat ID for real-time alerts
- Notifications sent for: payment approaching (1 hour before), payment successful, payment failed
- Powered by Telegram Bot API — no server required, direct browser fetch

### 📉 Dashboard Metrics
- Total paid this month
- Active recurring bills
- Scheduled one-time payments
- Due now count
- Next payment date
- Completed payments

### ⚠️ Low Balance Warning
- Banner displayed when wallet XLM balance is below the sum of upcoming due payments

### 💬 User Feedback
- Embedded Google Form in the app for collecting user feedback
- Collects: name, email, wallet address, product rating

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────┐
│                   React Frontend                │
│                                                 │
│  useWallet ──────► Stellar Wallets Kit          │
│      │             (Freighter / xBull / Lobstr) │
│      │                                          │
│  useBills ───────► contractClient.js            │
│      │                    │                     │
│  usePaymentEngine         │                     │
│      │             ┌──────▼──────────────┐      │
│  usePaymentHistory │  Soroban RPC         │      │
│      │             │  soroban-testnet     │      │
│  useTelegram       └──────────┬──────────┘      │
│                               │                 │
└───────────────────────────────┼─────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Soroban Smart        │
                    │  Contract (Rust)      │
                    │  CC7XBIWV...YSY5      │
                    │                       │
                    │  Per-user storage:    │
                    │  • Bills              │
                    │  • Payment History    │
                    └───────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Horizon Testnet      │
                    │  (Classic payments)   │
                    │  horizon-testnet.     │
                    │  stellar.org          │
                    └───────────────────────┘
```

**Two transaction layers:**
1. **Classic Stellar payments** → XLM/USDC transfers via `TransactionBuilder + Operation.payment()` → Horizon API
2. **Soroban contract calls** → Bill CRUD + payment history → Soroban RPC

---

## 📜 Smart Contract

**Contract ID:** `CC7XBIWVBKEAKUMADCPRDC5O2WAI6D2WK5KJS4CTEKQ2ZS3TEHXYHSY5`  
**Network:** Stellar Testnet  
**Language:** Rust (Soroban SDK)  
**Path:** `contracts/autopay/src/lib.rs`

### Contract Functions

| Function | Description | Auth |
|----------|-------------|------|
| `add_bill(caller, name, recipient, amount, asset, bill_type, frequency, day_of_month, next_due)` | Create a new bill | Caller |
| `pause_bill(caller, bill_id)` | Toggle pause/resume | Caller |
| `delete_bill(caller, bill_id)` | Delete a bill | Caller |
| `complete_bill(caller, bill_id)` | Mark one-time bill completed | Caller |
| `mark_paid(caller, bill_id)` | Mark bill as paid after successful payment | Caller |
| `update_status(caller, bill_id, status)` | Update bill status | Caller |
| `update_next_due(caller, bill_id, new_next_due)` | Update next due date after recurring payment | Caller |
| `get_all_bills(caller)` | Fetch all bills for caller | None |
| `get_bill(caller, bill_id)` | Fetch single bill | None |
| `record_payment(...)` | Record a payment attempt on-chain | Caller |
| `get_payment_history(caller)` | Fetch all payment records | None |

### Storage Design
Per-user namespace — no global owner, no initialization required:
```
DataKey::Bill(Address, u64)        → Bill struct
DataKey::BillIds(Address)          → Vec<u64>
DataKey::NextId(Address)           → u64 (counter)
DataKey::Payment(Address, u64)     → PaymentRecord struct
DataKey::PaymentIds(Address)       → Vec<u64>
DataKey::PaymentNextId(Address)    → u64 (counter)
```

### Build & Deploy

```bash
cd contracts/autopay

# Build
cargo build --release --target wasm32v1-none

# Test
cargo test

# Deploy (requires Stellar CLI + funded testnet account)
stellar contract deploy \
  --wasm target/wasm32v1-none/release/autopay.wasm \
  --source <YOUR_ACCOUNT_ALIAS> \
  --network testnet

# Generate TypeScript bindings
stellar contract bindings typescript \
  --contract-id <CONTRACT_ID> \
  --network testnet \
  --output-dir src/contract-client
```

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend Framework | React 19 + Vite 8 |
| Blockchain SDK | `@stellar/stellar-sdk` v15 |
| Wallet Integration | `@creit.tech/stellar-wallets-kit` v2 |
| Smart Contracts | Rust + Soroban SDK |
| Network | Stellar Testnet (Horizon + Soroban RPC) |
| Storage | Soroban contract (primary) + localStorage (paid-keys guard only) |
| Notifications | Telegram Bot API (direct browser fetch) |
| Deployment | Vercel / Netlify (static SPA) |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- [Rust](https://rustup.rs/) + `wasm32v1-none` target
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/install)
- [Freighter Wallet](https://freighter.app/) browser extension (or another supported wallet)
- A funded Stellar **testnet** account ([Stellar Friendbot](https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY))

### Install & Run

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/stellarautopay.git
cd stellarautopay

# Install dependencies
npm install

# Start development server
npm run dev
# → http://localhost:5173

# Production build
npm run build
```

### Deploy to Vercel

```bash
npm install -g vercel
vercel --prod
```

Or connect your GitHub repo to [Vercel](https://vercel.com) for automatic deployments.

### Deploy to Netlify

```bash
npm run build
# Drag and drop the dist/ folder to https://app.netlify.com/drop
```

---

## 📖 Usage Guide

### 1. Connect Your Wallet
Click **Connect Wallet** → choose your wallet extension (Freighter recommended for testnet) → approve the connection request.

### 2. Add a Payment
Click **+ Add Payment** → fill in:
- **Name**: friendly label (e.g. "Rent", "Netflix")
- **Recipient**: Stellar public key (G...)
- **Amount**: in XLM or USDC
- **Type**: Recurring or One-Time
- **Frequency** (recurring): Weekly / Biweekly / Monthly / Monthly on day X / Quarterly
- **Scheduled Date/Time**: when the first (or only) payment should occur

### 3. Enable Auto-Pay (Recommended)
Click **⚡ Enable Auto-Pay** → your wallet signs one `setOptions` transaction adding a session key as account signer → all future payments in this session are signed automatically.

> Without Auto-Pay, Freighter opens a popup for each due payment (manual mode).

### 4. Monitor Payments
- **Dashboard**: live bill cards with status badges and next due dates
- **Metrics Strip**: month total, active bills, due now count
- **Payment History**: full on-chain log of every attempt with tx hash links to Stellar Expert and Horizon
- **Low Balance Warning**: banner appears when balance is insufficient for upcoming payments

### 5. Telegram Alerts
Click **📨 Telegram** → enter your Bot Token and Chat ID → Test → Save.  
You will receive alerts 1 hour before each payment and confirmation/failure after execution.

**Setup:**
1. Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` → copy the bot token
2. Send a message to your new bot
3. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` → copy your `chat.id`
4. Paste both into the Telegram settings in the app

### 6. Disable Auto-Pay
Click **⚡ Auto-Pay ON** → **Disable** → your wallet signs one transaction to remove the session signer from your account.

---

## 🔒 Security Model

| Risk | Mitigation |
|------|-----------|
| Secret key exposure | **Never entered** — wallet extensions hold keys; app only sees public key |
| Auto-pay abuse | Session signing key has weight=1 only; removed on disable/disconnect |
| Session key leakage | Stored only in React `useRef` (memory) — never localStorage, never persisted |
| Double payments | `paidBillsRef` (in-memory) + localStorage paid-keys guard prevent re-execution |
| Stale bill re-payments | `mark_paid` writes on-chain; guard catches contract write failures |
| Contract manipulation | Per-user `caller.require_auth()` on all write functions |

---

## 📁 Project Structure

```
stellarautopay/
├── contracts/
│   └── autopay/
│       └── src/lib.rs              # Soroban smart contract (Rust)
├── src/
│   ├── utils/
│   │   ├── stellar.js              # Horizon payment helpers (build/sign/submit)
│   │   └── contractClient.js       # Direct Soroban RPC client (no ContractClient wrapper)
│   ├── hooks/
│   │   ├── useWallet.js            # Wallet kit connect, auto-pay session key management
│   │   ├── useBills.js             # Bill CRUD → Soroban contract
│   │   ├── usePaymentEngine.js     # Auto-payment loop (60s interval)
│   │   ├── usePaymentHistory.js    # On-chain payment history fetch
│   │   └── useTelegram.js          # Telegram Bot API notifications
│   ├── components/
│   │   ├── WalletConnect.jsx       # Login screen (wallet kit modal)
│   │   ├── BillDashboard.jsx       # Bill cards grid with filter tabs
│   │   ├── AddBillForm.jsx         # Add/schedule payment modal
│   │   ├── PaymentHistory.jsx      # History table with explorer links
│   │   ├── MetricsStrip.jsx        # Summary metrics bar
│   │   ├── LowBalanceWarning.jsx   # Insufficient balance banner
│   │   ├── TelegramSettings.jsx    # Telegram bot configuration modal
│   │   └── FeedbackForm.jsx        # Embedded Google Form modal
│   ├── contract-client/
│   │   └── src/index.ts            # Generated TypeScript bindings
│   ├── App.jsx
│   ├── App.css
│   └── main.jsx
├── package.json
├── vite.config.js
└── README.md
```

---

## 👛 Test Wallet Addresses

The following Stellar testnet addresses have interacted with this contract and can be verified on [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet):

| # | Address | Note |
|---|---------|------|
| 1 | `GAJXYRRBECPQVCOCCLBCCZ2KGGNEHL32TLJRT2JWLNVE4HJ35OAKAPH2` | Primary test sender |
| 2 | `GC4COEPJQRXZFTRZJYOYEIHVX6OCSZD5GMOAI6JGRDM3Y33VKBLODYUE` | Test payment recipient |
| 3 | _Add after testing_ | |
| 4 | _Add after testing_ | |
| 5 | _Add after testing_ | |

> Fund a testnet wallet: `https://friendbot.stellar.org/?addr=YOUR_ADDRESS`

---

## 🎥 Demo Video

> **Add your demo video link here** (Loom, YouTube, etc.)

The demo should show:
1. Connecting Freighter wallet
2. Adding a recurring bill (XLM, weekly)
3. Adding a one-time scheduled payment (USDC)
4. Enabling Auto-Pay (signing the session key transaction)
5. Automated payment execution at due time
6. Payment History table with tx hash links
7. Telegram notification received

---

## 💬 User Feedback

Feedback is collected via the embedded Google Form accessible from the **💬 Feedback** button in the app header.

**Form:** https://docs.google.com/forms/d/e/1FAIpQLSfp4qWFnQUWYiruEyvELlv1RJkK7_Q7UtrEXu4Ze-QmYMtb8A/viewform

Collected fields: Full name · Email · Stellar wallet address · Product rating (1–5) · Comments

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit: `git commit -m 'Add your feature'`
4. Push: `git push origin feature/your-feature`
5. Open a Pull Request

---

## 📄 License

MIT License

---

## 🙏 Acknowledgements

- [Stellar Development Foundation](https://stellar.org) — Horizon API & Soroban smart contracts
- [Creit Tech](https://github.com/Creit-Tech/Stellar-Wallets-Kit) — Stellar Wallets Kit
- [Stellar Expert](https://stellar.expert) — Transaction explorer
