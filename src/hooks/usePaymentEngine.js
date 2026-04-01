import { useEffect, useRef, useCallback } from 'react';
import { sendPayment, buildPaymentTxXdr, classifyError } from '../utils/stellar';
import { makeSessionSignFn } from '../utils/contractClient';
import { loadPaidKeys } from './useBills';

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

export default function usePaymentEngine(publicKey, getSessionKeypair, autoPayEnabled, contractReady, bills, updateBill, completeBill, markBillPaid, addEntry, refreshBalance, balances, sendTelegramNotification, walletSignAndSubmit, walletSignFn) {
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

    // Sign function for contract record_payment calls.
    // In manual mode we deliberately use null so record_payment is local-only
    // (no extra Freighter popup — addEntry still does optimistic UI update).
    const recordSignFn = isAutoMode && sessionKp
      ? makeSessionSignFn(sessionKp)
      : null;

    const now = new Date();

    try {
    // --- Telegram: notify upcoming payments (1 day before) ---
    if (sendTelegramNotification) {
      const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const upcomingBills = bills.filter(
        (b) =>
          b.status === 'active' &&
          !isPaymentDue(b, now) &&
          new Date(b.nextDueDate) <= oneDayFromNow &&
          !notifiedRef.current.has(b.id + '_' + b.nextDueDate)
      );
      for (const bill of upcomingBills) {
        const dueTime = new Date(bill.nextDueDate).toLocaleString('tr-TR');
        const typeLabel = bill.type === 'one-time' ? 'Tek seferlik ödeme' : 'Tekrarlayan fatura';
        const currentBalance = balances ? (balances[bill.asset] ?? 0) : 0;
        const hasSufficientBalance = currentBalance >= parseFloat(bill.amount);

        let msg = `⏰ *Yaklaşan Ödeme*\n\n${typeLabel}: *${bill.name}*\nMiktar: *${bill.amount} ${bill.asset}*\nÖdeme Tarihi: ${dueTime}\nAlıcı: \`${bill.recipientAddress.slice(0, 8)}...${bill.recipientAddress.slice(-4)}\``;

        if (!hasSufficientBalance) {
          msg += `\n\n⚠️ *YETERSİZ BAKİYE UYARISI*\nMevcut ${bill.asset} bakiyeniz: *${currentBalance.toFixed(7)} ${bill.asset}*\nGerekli: *${bill.amount} ${bill.asset}*\nÖdemenin gerçekleşmesi için lütfen bakiyenizi yükleyin.`;
        }

        try {
          await sendTelegramNotification(msg);
          notifiedRef.current.add(bill.id + '_' + bill.nextDueDate);
        } catch {
          // notification failure shouldn't block payments
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

    const activeBills = bills.filter(
      (b) => b.status === 'active' && isPaymentDue(b, now) && !paidBillsRef.current.has(paidKey(b))
    );

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
          }, publicKey, recordSignFn).catch(() => {});
          if (sendTelegramNotification) {
            const currentBalance = balances ? (balances[bill.asset] ?? 0) : 0;
            sendTelegramNotification(
              `⚠️ *Yetersiz Bakiye — Ödeme Atlandı*\n\nFatura: *${bill.name}*\nGerekli: *${bill.amount} ${bill.asset}*\nMevcut bakiye: *${currentBalance.toFixed(7)} ${bill.asset}*\n\nLütfen bakiyenizi yükleyin.`
            ).catch(() => {});
          }
        } else {
          addEntry({
            billName: bill.name, billId: bill.id,
            recipientAddress: bill.recipientAddress,
            amount: bill.amount, asset: bill.asset,
            txHash: '', status: 'failed', error: classified.message,
          }, publicKey, recordSignFn).catch(() => {});
          if (sendTelegramNotification) {
            sendTelegramNotification(
              `❌ *Ödeme Başarısız*\n\nFatura: *${bill.name}*\nMiktar: *${bill.amount} ${bill.asset}*\nHata: ${classified.message}`
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

      // ── Phase 3: Record in history (best-effort, non-blocking) ─────────────
      console.log(`✅ Payment recorded | bill: ${bill.name} | hash: ${result.hash}`);
      addEntry({
        billName: bill.name, billId: bill.id,
        recipientAddress: bill.recipientAddress,
        amount: bill.amount, asset: bill.asset,
        txHash: result.hash, status: 'success', error: '',
      }, publicKey, recordSignFn).catch(() => {});

      // ── Phase 4: Update contract state (best-effort, non-blocking) ─────────
      // markBillPaid and updateBill handle their own retries internally.
      if (bill.type === 'one-time') {
        markBillPaid(bill.id).catch(() => {});
      } else {
        updateBill(bill.id, {
          nextDueDate: calculateNextDueDate(bill.nextDueDate, bill.frequency, bill.dayOfMonth ?? 0),
        }).catch(() => {});
      }

      // ── Phase 5: Telegram success notification ─────────────────────────────
      if (sendTelegramNotification) {
        const typeLabel = bill.type === 'one-time' ? 'Tek seferlik ödeme' : 'Tekrarlayan fatura';
        const paidAt = new Date().toLocaleString('tr-TR');
        const msg = `✅ *Ödeme Başarılı*\n\n${typeLabel}: *${bill.name}*\nÖdenen Miktar: *${bill.amount} ${bill.asset}*\nAlıcı: \`${bill.recipientAddress.slice(0, 8)}...${bill.recipientAddress.slice(-4)}\`\nTarih: ${paidAt}\n\n[Stellar Explorer'da Görüntüle](https://stellar.expert/explorer/testnet/tx/${result.hash})`;
        sendTelegramNotification(msg).catch(() => {});
      }
    }

    await refreshBalance();
    } finally {
      processingRef.current = false;
    }
  }, [publicKey, getSessionKeypair, autoPayEnabled, contractReady, bills, updateBill, completeBill, markBillPaid, addEntry, refreshBalance, balances, sendTelegramNotification, walletSignAndSubmit, walletSignFn]);

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
    const interval = setInterval(run, 60_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, autoPayEnabled, contractReady, walletSignAndSubmit]);

  return { processPayments };
}
