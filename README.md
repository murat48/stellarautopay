# Stellar Autopay

> Automated recurring & one-time payment system built on the Stellar blockchain.  
> No secret keys. No backend server. Fully on-chain via Soroban smart contracts.

---

## 🔗 Quick Links

| | |
|---|---|
| **Live Demo** | [https://stellarautopay.vercel.app](https://stellarautopay.vercel.app) |
| **Smart Contract** | [`CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS`](https://stellar.expert/explorer/testnet/contract/CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS) |
| **GitHub** | [https://github.com/murat48/stellarautopay](https://github.com/murat48/stellarautopay) |
| **Network** | Stellar Testnet |
| **Telegram Bot** | [@StellarAutopay_Bot](https://t.me/StellarAutopay_Bot) |

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Smart Contract](#smart-contract)
4. [Tech Stack](#tech-stack)
5. [Getting Started](#getting-started)
6. [Usage Guide](#usage-guide)
7. [Security Model](#security-model)
8. [Project Structure](#project-structure)
9. [User Feedback & Onboarding](#user-feedback--onboarding)
10. [Improvement Plan](#improvement-plan)

---

## Overview

**Stellar Autopay** is a React single-page application that brings scheduled and automated recurring payments to the Stellar blockchain. Users connect their wallet, define payment rules (amount, recipient, frequency), and let the app execute payments automatically — no manual approval needed for each transaction.

All bill data and payment history live **on-chain** in a Soroban smart contract. There is no backend, no database, and no custody of user funds.

---

## ✨ Features

### 💳 Non-Custodial Wallet Connect
- Supports Freighter, xBull, Lobstr, Albedo via Stellar Wallets Kit
- Secret key never touches the application
- Live XLM and USDC balance display

### 📅 On-Chain Bill Management
- Create recurring (weekly / biweekly / monthly / monthly on specific day / quarterly) and one-time payments
- Supported assets: **XLM** and **USDC**
- Pause, resume, and delete bills at any time
- Default dashboard view shows unpaid bills sorted by due date (soonest first)
- All data stored in the Soroban contract — persists across sessions and devices

### ⚡ Auto-Pay Engine
- One-time wallet signature adds a **session signing key** to the account
- Payment engine polls every 15 seconds; executes any bill that is due
- Checks balance before each payment; skips if insufficient
- Records every attempt on-chain: tx hash, amount, date, status
- Without Auto-Pay: Freighter signs each payment manually (one popup per payment)

### 📊 On-Chain Payment History
- Every payment attempt (success / failed / skipped) stored in the contract
- Direct links to [Stellar Expert](https://stellar.expert/explorer/testnet) for each tx hash

### 🔔 Telegram Notifications
- Scan QR or message [@StellarAutopay_Bot](https://t.me/StellarAutopay_Bot), enter only your Chat ID
- Alerts: 24 hours before payment due, payment success, payment failure

### 📉 Dashboard Metrics
- Paid this month · Active bills · Due now · Next payment · Completed total

### ⚠️ Low Balance Warning
- Banner shown when XLM balance is below upcoming due payments

---

## 📜 Smart Contract

**Contract ID:** `CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS`  
**Network:** Stellar Testnet  
**Language:** Rust · Soroban SDK v22  
**Source:** `contracts/autopay/src/lib.rs`  
**Explorer:** [View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CCGU4EROJG3XVYIRGE5TOYDVUOOCRSPUCSUF4QCHRY3KEBFVLQGS5NIS)

### Exported Functions

| Function | Description | Auth Required |
|----------|-------------|---------------|
| `add_bill` | Create a new payment schedule | Caller |
| `pause_bill` | Toggle pause / resume | Caller |
| `delete_bill` | Remove a bill permanently | Caller |
| `complete_bill` | Mark one-time bill as completed | Caller |
| `mark_paid` | Mark bill as paid after on-chain transfer | Caller |
| `update_status` | Update bill status | Caller |
| `update_next_due` | Advance next due date after recurring payment | Caller |
| `get_all_bills` | Fetch all bills for a wallet | None |
| `get_bill` | Fetch single bill | None |
| `get_active_bills` | Fetch only active / low-balance bills | None |
| `record_payment` | Write a payment attempt to on-chain history | Caller |
| `get_payment_history` | Fetch all payment records for a wallet | None |

### Storage Layout

Per-user namespace — no global owner, no initialization required:

```
DataKey::Bill(Address, u64)        → Bill struct
DataKey::BillIds(Address)          → Vec<u64>
DataKey::NextId(Address)           → u64
DataKey::Payment(Address, u64)     → PaymentRecord struct
DataKey::PaymentIds(Address)       → Vec<u64>
DataKey::PaymentNextId(Address)    → u64
```

### Wallets That Have Used This Contract

Verified on [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet):

| # | Wallet Address | Actions |
|---|----------------|---------|
| 1 | `GC4COEPJQRXZFTRZJYOYEIHVX6OCSZD5GMOAI6JGRDM3Y33VKBLODYUE` | add_bill, mark_paid, pause_bill |
| 2 | `GCNA5EMJNXZPO57ARVJYQ5SN2DYYPD6ZCCENQ5AQTMVNKN77RDIPMI3A` | add_bill, record_payment, update_next_due |
| 3 | `GALDPLQ62RAX3V7RJE73D3C2F4SKHGCJ3MIYJ4MLU2EAIUXBDSUVS7SA` | add_bill, record_payment, mark_paid |
| 4 | `GDBOBVGP6HNLL66IOTSR6COGSZYRTSRDXBUD2CDDN3C5XGUT23TQ54J2` | add_bill, record_payment, mark_paid |
| 5 | `GAJXYRRBECPQVCOCCLBCCZ2KGGNEHL32TLJRT2JWLNVE4HJ35OAKAPH2` | add_bill, record_payment, mark_paid |
| 6 | `GD72JZQAJPGLSLND6GPTSZ64PWMVY3JP5QKQJ32RW2GJCSVOSBPNX2EF` | add_bill, record_payment, mark_paid |
| 7 | `GDQJJRU6LA6R5KT6AZA6P2H7NGOC4EQCMZALQBTPKXFJLVT32QXWFXYW` | Contract deployer |

### Build & Deploy

```bash
cd contracts/autopay

# Build WASM
stellar contract build

# Run tests
cargo test

# Deploy to testnet
stellar contract deploy \
  --wasm target/wasm32v1-none/release/autopay_contract.wasm \
  --source <YOUR_STELLAR_CLI_ALIAS> \
  --network testnet
```

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite 8 |
| Blockchain SDK | `@stellar/stellar-sdk` v15 |
| Wallet Integration | `@creit.tech/stellar-wallets-kit` v2 |
| Smart Contract | Rust + Soroban SDK v22 |
| Network | Stellar Testnet (Horizon + Soroban RPC) |
| Notifications | Telegram Bot API (direct browser fetch, no server) |
| Hosting | Vercel |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- [Freighter Wallet](https://freighter.app/) browser extension
- A funded Stellar **testnet** account → [Friendbot](https://friendbot.stellar.org/?addr=YOUR_KEY)

### Local Setup

```bash
git clone https://github.com/murat48/stellarautopay.git
cd stellarautopay
npm install
npm run dev          # http://localhost:5173
```

### Environment Variables

Create a `.env` file:

```
VITE_TELEGRAM_BOT_TOKEN=your_telegram_bot_token
```

### Production Build

```bash
npm run build        # outputs to dist/
vercel deploy --prod # or push to GitHub for auto-deploy
```

---

## 📖 Usage Guide

1. **Connect Wallet** — Click Connect Wallet, choose Freighter (recommended for testnet), approve.
2. **Add a Payment** — Click `+ Add Payment`, fill in recipient address, amount (XLM or USDC), frequency, and scheduled date.
3. **Enable Auto-Pay** — Click ⚡ Enable Auto-Pay → sign one `setOptions` tx → all future payments are automatic.
4. **Monitor** — Dashboard shows unpaid bills sorted by due date. Metrics strip shows key numbers.
5. **Telegram Alerts** — Click 📨 Telegram, scan QR or search @StellarAutopay_Bot, paste your Chat ID, Test, Save.
6. **Disable Auto-Pay** — Click ⚡ Auto-Pay ON → Disable → removes session signer from your account.

---

## 🔒 Security Model

| Risk | Mitigation |
|------|-----------|
| Secret key exposure | Never entered; wallet extensions hold all keys |
| Auto-pay abuse | Session key has weight=1; removed immediately on disable/disconnect |
| Session key leakage | Lives only in React `useRef` (RAM) — never written to localStorage |
| Double payments | In-memory `paidBillsRef` + localStorage paid-keys guard |
| Contract manipulation | `caller.require_auth()` on every write function |

---

## 📁 Project Structure

```
stellarautopay/
├── contracts/autopay/src/lib.rs     # Soroban smart contract (Rust)
├── src/
│   ├── utils/
│   │   ├── stellar.js               # Horizon payment builder / signer
│   │   └── contractClient.js        # Direct Soroban RPC client
│   ├── hooks/
│   │   ├── useWallet.js             # Wallet connect + session key management
│   │   ├── useBills.js              # Bill CRUD (Soroban contract)
│   │   ├── usePaymentEngine.js      # 15s auto-payment polling loop
│   │   ├── usePaymentHistory.js     # On-chain payment history
│   │   └── useTelegram.js           # Telegram Bot API notifications
│   ├── components/
│   │   ├── WalletConnect.jsx        # Login screen
│   │   ├── BillDashboard.jsx        # Bill cards + filter tabs
│   │   ├── AddBillForm.jsx          # Schedule payment modal
│   │   ├── PaymentHistory.jsx       # History table with tx links
│   │   ├── MetricsStrip.jsx         # Summary numbers bar
│   │   ├── LowBalanceWarning.jsx    # Balance warning banner
│   │   ├── TelegramSettings.jsx     # Telegram config modal
│   │   └── FeedbackForm.jsx         # Embedded Google Form
│   ├── App.jsx / App.css
│   └── main.jsx
├── vercel.json
└── package.json
```

---

## 💬 User Feedback & Onboarding

### Google Form

Users submit feedback via the **💬 Feedback** button in the app or directly:

**→ [Open Feedback Form](https://docs.google.com/forms/d/e/1FAIpQLSfp4qWFnQUWYiruEyvELlv1RJkK7_Q7UtrEXu4Ze-QmYMtb8A/viewform)**

Fields collected:
- Full Name
- Email Address
- Stellar Testnet Wallet Address
- Product Rating (1–5 stars)
- Comments / Suggestions

### Exported Responses (Excel)

All form responses exported to Google Sheets:

**→ [View Feedback Responses & Analytics](https://docs.google.com/forms/d/e/1FAIpQLSfp4qWFnQUWYiruEyvELlv1RJkK7_Q7UtrEXu4Ze-QmYMtb8A/viewanalytics)**

To download as Excel: open in Google Sheets → **File → Download → Microsoft Excel (.xlsx)**

---

## 🔄 Improvement Plan

### Iteration 1 — Completed (based on early tester feedback)

| # | Problem Reported | Fix Applied | Commit |
|---|-----------------|-------------|--------|
| 1 | `mark_paid` and `record_payment` not firing in manual mode | Added `externalSignFn` parameter so contract writes work without auto-pay | [55d36b7](https://github.com/murat48/stellarautopay/commit/55d36b7) |
| 2 | Auto-pay failing with HTTP 400 error | Improved error extraction from Horizon `result_codes`; added readable error messages | [fff4287](https://github.com/murat48/stellarautopay/commit/fff4287) |
| 3 | `op_too_many_signers` when enabling auto-pay | Orphaned session keys are now removed atomically in the same transaction | [65e5c14](https://github.com/murat48/stellarautopay/commit/65e5c14) |
| 4 | Fees too high (1M stroops per contract call) | Reduced Soroban fee to 300K, classic tx fee to 1K stroops | [bc024a9](https://github.com/murat48/stellarautopay/commit/bc024a9) |
| 5 | Multiple Freighter popups for a single payment | Eliminated repeated popups in manual mode — one popup per payment | [bc024a9](https://github.com/murat48/stellarautopay/commit/bc024a9) |
| 6 | Telegram test button silently did nothing before saving | `testConnection` now bypasses `enabled` check, sends directly with provided Chat ID | [9d872e9](https://github.com/murat48/stellarautopay/commit/9d872e9) |
| 7 | Dashboard showed all bills by default, hard to find unpaid | Default filter changed to "Unpaid", sorted soonest-due first | [414a760](https://github.com/murat48/stellarautopay/commit/414a760) |
| 8 | Completed count showed 0 despite paid bills existing | Fixed metrics to count both `completed` and `paid` statuses | [31f2e21](https://github.com/murat48/stellarautopay/commit/31f2e21) |
| 9 | Telegram instructions in Turkish, hard for international users | Full English UI + QR code for @StellarAutopay_Bot added | [31f2e21](https://github.com/murat48/stellarautopay/commit/31f2e21) |
| 10 | Old contract had stale data from development | Redeployed fresh contract to testnet | [414a760](https://github.com/murat48/stellarautopay/commit/414a760) |

### Next Phase — Planned Improvements

Based on ongoing user feedback patterns:

1. **Mainnet support** — Add a testnet / mainnet toggle with appropriate risk warnings
2. **Offline notifications via Service Worker** — Send alerts even when the browser tab is closed
3. **Bill categories & tags** — Tag bills (rent, utilities, subscriptions) and filter by category
4. **CSV / Excel payment history export** — Let users download on-chain history for accounting
5. **Mobile layout** — Optimize for mobile browsers; Freighter mobile support

---

## 📄 License

MIT License

---

## 🙏 Acknowledgements

- [Stellar Development Foundation](https://stellar.org) — Horizon API & Soroban smart contracts
- [Creit Tech](https://github.com/Creit-Tech/Stellar-Wallets-Kit) — Stellar Wallets Kit
- [Stellar Expert](https://stellar.expert) — Testnet transaction explorer
