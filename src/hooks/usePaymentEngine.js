import { useEffect, useRef, useCallback } from 'react';
import { sendPayment, buildPaymentTxXdr, classifyError } from '../utils/stellar';
import { makeSessionSignFn, makeWalletSignFn } from '../utils/contractClient';
import { loadPaidKeys } from './useBills';
import { logger } from '../utils/logger';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Smart month-aware date calculation ────────────────────────────────────

/** Days in a given month. month is 0-indexed (JS style). */
function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Clamp targetDay to the actual last day of the given month.
 * Examples:
 *   targetDay=31, April (30 days)   → 30
 *   targetDay=31, February non-leap → 28
 *   targetDay=29, February leap     → 29
 */
function effectiveDayForMonth(targetDay, year, month) {
  return Math.min(targetDay, daysInMonth(year, month));
}

/**
 * Calculate the next due date for a recurring bill.
 *
 * @param {string} currentDueIso  ISO string of current nextDueDate
 * @param {string} frequency      'weekly' | 'biweekly' | 'monthly' | 'monthly_day' | 'quarterly'
 * @param {number} dayOfMonth     1-31 for specific-day monthly (0 = not set)
 */
export function calculateNextDueDate(currentDueIso, frequency, dayOfMonth = 0) {
  const current = new Date(currentDueIso);

  if (frequency === 'weekly') {
    current.setDate(current.getDate() + 7);
    return current.toISOString();
  }

  if (frequency === 'biweekly') {
    current.setDate(current.getDate() + 14);
    return current.toISOString();
  }

  if (frequency === 'quarterly') {
    current.setMonth(current.getMonth() + 3);
    return current.toISOString();
  }

  if (frequency === 'monthly' || frequency === 'monthly_day') {
    if (frequency === 'monthly_day' && dayOfMonth > 0) {
      // Smart monthly: advance one month, then clamp to the specific day
      let nextYear  = current.getFullYear();
      let nextMonth = current.getMonth() + 1;
      if (nextMonth > 11) { nextMonth = 0; nextYear++; }

      const day = effectiveDayForMonth(dayOfMonth, nextYear, nextMonth);
      // Keep same HH:mm:ss as the current due date
      return new Date(
        nextYear, nextMonth, day,
        current.getHours(), current.getMinutes(), current.getSeconds()
      ).toISOString();
    }
    // Standard monthly: JS setMonth handles end-of-month rollover
    current.setMonth(current.getMonth() + 1);
    return current.toISOString();
  }

  return current.toISOString(); // fallback
}

/**
 * A payment is "due" if its scheduled time has passed.
 * No early grace — we pay on time, not before.
 * A tiny 30-second window absorbs engine-cycle jitter only.
 */
function isPaymentDue(bill, now) {
  const due = new Date(bill.nextDueDate);
  return now >= new Date(due.getTime() - 30_000); // 30s jitter only
}

export default function usePaymentEngine(publicKey, getSessionKeypair, autoPayEnabled, contractReady, bills, updateBill, completeBill, markBillPaid, addEntry, refreshBalance, balances, sendTelegramNotification, walletSignAndSubmit, walletSignFn, pendingProposals = [], executeProposalAndPay = null) {
  const processingRef = useRef(false);
  const notifiedRef = useRef(new Set());
  // Track bills already paid in this session to prevent double-payment on re-render / stale state
  const paidBillsRef = useRef(new Set());

  const processPayments = useCallback(async () => {
    const sessionKp = getSessionKeypair();
    // Never process payments from stale localStorage data — wait for on-chain contract data
    if (!publicKey || !contractReady || processingRef.current) return;
    // Auto-pay OFF: need walletSignAndSubmit for manual path
    // Auto-pay ON: need session keypair
    const isAutoMode = autoPayEnabled && !!sessionKp;
    const isManualMode = !autoPayEnabled && typeof walletSignAndSubmit === 'function';
    if (!isAutoMode && !isManualMode) return;
    processingRef.current = true;

    // Sign function for post-payment contract writes (record_payment, mark_paid, update_next_due).
    // Auto mode:   session keypair signs silently — zero popups.
    // Manual mode: wallet sign fn — popups appear immediately after the payment popup
    //              (no 60-second wait). All contract state is properly updated on-chain.
    const contractSignFn = sessionKp
      ? makeSessionSignFn(sessionKp)
      : walletSignFn
      ? makeWalletSignFn(walletSignFn, publicKey)
      : null;

    const now = new Date();

    try {
    // --- Telegram: multi-threshold upcoming payment notifications ---
    if (sendTelegramNotification) {
      // Milestones: 1h, 30min, 10min, 5min — each fires once per due-date cycle
      const THRESHOLDS = [
        { ms: 60 * 60 * 1000, label: '1 hour'    },
        { ms: 30 * 60 * 1000, label: '30 minutes' },
        { ms: 10 * 60 * 1000, label: '10 minutes' },
        { ms:  5 * 60 * 1000, label: '5 minutes'  },
      ];

      for (const bill of bills.filter((b) => b.status === 'active' && !isPaymentDue(b, now))) {
        const msUntilDue = new Date(bill.nextDueDate).getTime() - now.getTime();
        const currentBalance = balances ? (balances[bill.asset] ?? 0) : 0;
        const hasSufficientBalance = currentBalance >= parseFloat(bill.amount);
        const proposal = pendingProposals.find(
          (p) => p.status === 'pending' && String(p.billId) === String(bill.contractId)
        );

        for (const { ms, label } of THRESHOLDS) {
          // Fire within a 15 s window around each threshold
          if (msUntilDue > ms - 15_000 && msUntilDue <= ms + 15_000) {
            const notifyKey = `${bill.id}_${bill.nextDueDate}_${label}`;
            if (notifiedRef.current.has(notifyKey)) continue;
            notifiedRef.current.add(notifyKey);

            const dueTime = new Date(bill.nextDueDate).toLocaleString('en-GB');
            const typeLabel = bill.type === 'one-time' ? 'One-time payment' : 'Recurring bill';

            let msg;
            if (proposal) {
              const approvalCount = (proposal.approvals || []).length;
              const threshold = proposal.threshold ?? 1;
              const thresholdMet = approvalCount >= threshold;
              msg =
                `🔐 *Multisig Payment Due in ${label}*\n\n` +
                `${typeLabel}: *${bill.name}*\n` +
                `Amount: *${bill.amount} ${bill.asset}*\n` +
                `Due: ${dueTime}\n` +
                `Approvals: *${approvalCount}/${threshold}*\n` +
                (thresholdMet
                  ? `✅ Threshold met — will execute automatically`
                  : `⚠️ Threshold NOT met — waiting for co-signers`);
            } else {
              msg =
                `⏰ *Payment Due in ${label}*\n\n` +
                `${typeLabel}: *${bill.name}*\n` +
                `Amount: *${bill.amount} ${bill.asset}*\n` +
                `Due: ${dueTime}\n` +
                `Recipient: \`${bill.recipientAddress.slice(0, 8)}...${bill.recipientAddress.slice(-4)}\``;
              if (!hasSufficientBalance) {
                msg +=
                  `\n\n⚠️ *INSUFFICIENT BALANCE*\n` +
                  `Current: *${currentBalance.toFixed(7)} ${bill.asset}*\n` +
                  `Required: *${bill.amount} ${bill.asset}*`;
              }
            }

            sendTelegramNotification(msg).catch((e) => logger.error('Telegram', e?.message));
          }
        }
      }
    }

    // --- Process due payments ---
    // Key = "id:nextDueDate" → recurring bills get a new key each cycle
    // so removing from paidBillsRef is never needed.
    const paidKey = (b) => `${b.id}:${b.nextDueDate}`;

    // Merge localStorage paid-keys guard into in-memory set each cycle.
    // Prevents re-triggering bills that were paid in a previous session
    // but whose contract write failed (e.g. Freighter popup was closed).
    const guardKeys = loadPaidKeys();
    guardKeys.forEach((k) => paidBillsRef.current.add(k));

    // Bills that have ANY pending multisig proposal (regardless of threshold)
    // are ALWAYS handled by the auto-execute block below, never by the normal path.
    const billsWithProposal = new Set(
      pendingProposals
        .filter((p) => p.status === 'pending')
        .map((p) => String(p.billId))
    );

    const activeBills = bills.filter(
      (b) =>
        b.status === 'active' &&
        isPaymentDue(b, now) &&
        !paidBillsRef.current.has(paidKey(b)) &&
        !billsWithProposal.has(String(b.contractId)) // exclude all multisig bills
    );

    // --- Auto-execute ready multisig proposals ---
    // Threshold met + bill due → execute silently (no Freighter popup in auto mode)
    if (typeof executeProposalAndPay === 'function') {
      const readyProposals = pendingProposals.filter(
        (p) =>
          p.status === 'pending' &&
          (p.approvals || []).length >= p.threshold
      );
      for (const proposal of readyProposals) {
        const bill = bills.find(
          (b) =>
            b.status === 'active' &&
            String(b.contractId) === String(proposal.billId) &&
            isPaymentDue(b, now) &&
            !paidBillsRef.current.has(paidKey(b))
        );
        if (!bill) continue;
        // Guard against double-execution in same session
        paidBillsRef.current.add(paidKey(bill));
        try {
          await executeProposalAndPay(proposal.proposer, proposal.id);
        } catch (e) {
          paidBillsRef.current.delete(paidKey(bill));
          logger.warn('PaymentEngine', 'Auto-execute multisig failed:', e?.message);
        }
      }
    }

    for (const bill of activeBills) {
      // ── Phase 1: Send the Stellar payment ─────────────────────────────────
      let result;
      try {
        if (isAutoMode) {
          result = await sendPayment(
            sessionKp,
            publicKey,
            bill.recipientAddress,
            bill.amount,
            bill.asset
          );
        } else {
          const xdr = await buildPaymentTxXdr(
            publicKey,
            bill.recipientAddress,
            bill.amount,
            bill.asset
          );
          result = await walletSignAndSubmit(xdr);
        }
      } catch (err) {
        // Actual payment failed — record and move on
        const classified = classifyError(err);
        if (classified.code === 'op_underfunded') {
          updateBill(bill.id, { status: 'low_balance' }).catch(() => {});
          addEntry({
            billName: bill.name, billId: bill.id,
            recipientAddress: bill.recipientAddress,
            amount: bill.amount, asset: bill.asset,
            txHash: '', status: 'skipped', error: classified.message,
          }, publicKey, contractSignFn).catch(() => {});
          if (sendTelegramNotification) {
            const currentBalance = balances ? (balances[bill.asset] ?? 0) : 0;
            sendTelegramNotification(
              `⚠️ *Insufficient Balance — Payment Skipped*\n\nBill: *${bill.name}*\nRequired: *${bill.amount} ${bill.asset}*\nCurrent balance: *${currentBalance.toFixed(7)} ${bill.asset}*\n\nPlease top up your wallet.`
            ).catch(() => {});
          }
        } else {
          addEntry({
            billName: bill.name, billId: bill.id,
            recipientAddress: bill.recipientAddress,
            amount: bill.amount, asset: bill.asset,
            txHash: '', status: 'failed', error: classified.message,
          }, publicKey, contractSignFn).catch(() => {});
          if (sendTelegramNotification) {
            sendTelegramNotification(
              `❌ *Payment Failed*\n\nBill: *${bill.name}*\nAmount: *${bill.amount} ${bill.asset}*\nError: ${classified.message}`
            ).catch(() => {});
          }
        }
        continue; // skip post-payment steps
      }

      // ── Phase 2: Payment succeeded — protect against double-processing ────
      // Use id:nextDueDate as key so recurring bills get new keys next period.
      paidBillsRef.current.add(paidKey(bill));

      // ── Phase 2b: Refresh balance so user sees the deduction immediately ─────
      if (refreshBalance) refreshBalance().catch(() => {});

      // ── Phase 3: Record in history ─────────────────────────────────────────
      // Wait 1.5 s so the Soroban RPC node syncs the account sequence that
      // the just-submitted payment transaction just incremented.
      // addEntry retries on tx_bad_seq internally (up to 3×).
      logger.info('PaymentEngine', `Payment success | bill: ${bill.name} | hash: ${result.hash}`);
      await sleep(1500);
      await addEntry({
        billName: bill.name, billId: bill.id,
        recipientAddress: bill.recipientAddress,
        amount: bill.amount, asset: bill.asset,
        txHash: result.hash, status: 'success', error: '',
      }, publicKey, contractSignFn);

      // ── Phase 4: Update contract state ─────────────────────────────────────
      // Runs AFTER Phase 3 completes so sequence numbers don't conflict.
      // markBillPaid / updateBill have their own 3-attempt retry internally.
      if (bill.type === 'one-time') {
        markBillPaid(bill.id, contractSignFn).catch((e) => logger.warn('PaymentEngine', 'mark_paid failed:', e?.message));
      } else {
        updateBill(bill.id, {
          nextDueDate: calculateNextDueDate(bill.nextDueDate, bill.frequency, bill.dayOfMonth ?? 0),
        }, contractSignFn).catch((e) => logger.warn('PaymentEngine', 'update_next_due failed:', e?.message));
      }

      // ── Phase 5: Telegram success notification ─────────────────────────────
      if (sendTelegramNotification) {
        const typeLabel = bill.type === 'one-time' ? 'One-time payment' : 'Recurring bill';
        const paidAt = new Date().toLocaleString('en-GB');
        const msg = `✅ *Payment Successful*\n\n${typeLabel}: *${bill.name}*\nAmount Paid: *${bill.amount} ${bill.asset}*\nRecipient: \`${bill.recipientAddress.slice(0, 8)}...${bill.recipientAddress.slice(-4)}\`\nDate: ${paidAt}\n\n[View on Stellar Explorer](https://stellar.expert/explorer/testnet/tx/${result.hash})`;
        sendTelegramNotification(msg).catch((e) => logger.error('Telegram', e?.message));
      }
    }

    await refreshBalance();
    } finally {
      processingRef.current = false;
    }
  }, [publicKey, getSessionKeypair, autoPayEnabled, contractReady, bills, updateBill, completeBill, markBillPaid, addEntry, refreshBalance, balances, sendTelegramNotification, walletSignAndSubmit, walletSignFn, pendingProposals, executeProposalAndPay]);

  // Keep a stable ref so the interval always calls the latest processPayments
  // without the effect itself re-running every time `bills` changes.
  const processPaymentsRef = useRef(processPayments);
  useEffect(() => { processPaymentsRef.current = processPayments; }, [processPayments]);

  useEffect(() => {
    if (!publicKey || !contractReady) return;
    const sessionKp = getSessionKeypair();
    const isAutoMode = autoPayEnabled && !!sessionKp;
    const isManualMode = !autoPayEnabled && typeof walletSignAndSubmit === 'function';
    if (!isAutoMode && !isManualMode) return;

    // Run once immediately, then every 60 s.
    // We call through the ref so stale-closure is never an issue,
    // but changing `bills` alone does NOT restart the interval.
    const run = () => processPaymentsRef.current();
    run();
    // 15 s polling → worst-case payment latency ~15 s (was 60 s)
    const interval = setInterval(run, 15_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, autoPayEnabled, contractReady, walletSignAndSubmit]);

  return { processPayments };
}
