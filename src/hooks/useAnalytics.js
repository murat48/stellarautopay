/**
 * useAnalytics — tracks per-wallet usage metrics in localStorage.
 *
 * Metrics tracked:
 *  - activeDays     : unique days the wallet was active (last 90 days)
 *  - firstSeen      : timestamp of first login
 *  - lastSeen       : timestamp of most recent login
 *  - retentionDays  : days between first and last seen
 *  - totalTx        : total payment attempts on-chain
 *  - successTx      : successful payments
 *  - failedTx       : failed payments
 *  - successRate    : 0-100 %
 */
import { useState, useEffect } from 'react';

const STORE_KEY = 'autopay_analytics';

function getStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
  catch { return {}; }
}

function saveStore(store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {}
}

export default function useAnalytics(publicKey, paymentHistory = []) {
  const [metrics, setMetrics] = useState({
    activeDays:    0,
    firstSeen:     null,
    lastSeen:      null,
    retentionDays: 0,
    totalTx:       0,
    successTx:     0,
    failedTx:      0,
    successRate:   0,
  });

  useEffect(() => {
    if (!publicKey) return;

    const store      = getStore();
    const wallet     = store[publicKey] || {};
    const now        = Date.now();
    const today      = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // First-seen / last-seen
    if (!wallet.firstSeen) wallet.firstSeen = now;
    wallet.lastSeen = now;

    // Record today as an active day
    const sessions = wallet.sessions || [];
    if (!sessions.includes(today)) sessions.push(today);

    // Keep only last 90 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    wallet.sessions = sessions.filter((d) => new Date(d) >= cutoff);

    store[publicKey] = wallet;
    saveStore(store);

    // Derived metrics
    const firstSeen      = new Date(wallet.firstSeen);
    const lastSeen       = new Date(wallet.lastSeen);
    const retentionDays  = Math.max(1, Math.ceil((lastSeen - firstSeen) / 86_400_000));

    // TX metrics — normalise both array-status and string-status shapes
    const isSuccess = (p) => {
      const s = Array.isArray(p.status) ? p.status[0] : p.status;
      return typeof s === 'string' && s.toLowerCase() === 'success';
    };
    const isFailed = (p) => {
      const s = Array.isArray(p.status) ? p.status[0] : p.status;
      return typeof s === 'string' && s.toLowerCase() === 'failed';
    };

    const totalTx   = paymentHistory.length;
    const successTx = paymentHistory.filter(isSuccess).length;
    const failedTx  = paymentHistory.filter(isFailed).length;
    const successRate = totalTx > 0 ? Math.round((successTx / totalTx) * 100) : 0;

    setMetrics({
      activeDays:    wallet.sessions.length,
      firstSeen:     wallet.firstSeen,
      lastSeen:      wallet.lastSeen,
      retentionDays,
      totalTx,
      successTx,
      failedTx,
      successRate,
    });
  }, [publicKey, paymentHistory.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return metrics;
}
