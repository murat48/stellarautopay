import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY_PREFIX = 'autopay_vote_history_';

/**
 * Persists a wallet's approve/reject decisions to localStorage so the
 * co-signer can review what they voted on even after proposals are executed.
 *
 * vote entry shape:
 *   { id, proposalId, billId (contractId), internalBillId, billName,
 *     amount, asset, recipientAddress, proposer, threshold,
 *     totalApprovers, vote ('approved'|'rejected'), timestamp }
 */
export default function useApprovalHistory(publicKey) {
  const storageKey = publicKey ? `${STORAGE_KEY_PREFIX}${publicKey}` : null;

  const [voteHistory, setVoteHistory] = useState(() => {
    if (!storageKey) return [];
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '[]');
    } catch {
      return [];
    }
  });

  // Reload when wallet switches
  useEffect(() => {
    if (!storageKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVoteHistory([]);
      return;
    }
    try {
      setVoteHistory(JSON.parse(localStorage.getItem(storageKey) || '[]'));
    } catch {
      setVoteHistory([]);
    }
  }, [storageKey]);

  /**
   * Record a vote decision.
   * @param {object} proposal - proposal object from useMultisig
   * @param {'approved'|'rejected'} vote
   * @param {object|null} bill - matching bill from useBills (may be null if not found)
   */
  const recordVote = useCallback(
    (proposal, vote, bill) => {
      if (!storageKey) return;
      const entry = {
        id: crypto.randomUUID(),
        proposalId: String(proposal.id),
        billId: String(proposal.billId),          // contract storage ID
        internalBillId: bill?.id ?? null,         // internal UUID — used to match payment history
        billName: proposal.billName || bill?.name || `Bill #${proposal.billId}`,
        amount: bill?.amount ?? null,
        asset: bill?.asset ?? 'XLM',
        recipientAddress: bill?.recipientAddress ?? null,
        proposer: proposal.proposer,
        threshold: proposal.threshold,
        totalApprovers: (proposal.requiredApprovers || []).length,
        vote,
        timestamp: new Date().toISOString(),
      };

      setVoteHistory((prev) => {
        // Skip duplicate: same proposal + same vote already recorded
        if (prev.some((e) => e.proposalId === entry.proposalId && e.vote === entry.vote)) {
          return prev;
        }
        const updated = [entry, ...prev];
        try {
          localStorage.setItem(storageKey, JSON.stringify(updated));
        } catch (e) {
          console.warn('[ApprovalHistory] Could not persist to localStorage:', e?.message);
        }
        return updated;
      });
    },
    [storageKey],
  );

  const clearVoteHistory = useCallback(() => {
    if (!storageKey) return;
    localStorage.removeItem(storageKey);
    setVoteHistory([]);
  }, [storageKey]);

  return { voteHistory, recordVote, clearVoteHistory };
}
