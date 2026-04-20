import { useState, useEffect, useCallback } from 'react';
import {
  getProposals,
  getPendingProposals,
  getProposalsAsApprover,
  proposePayment,
  approveProposal as approveProposalOnChain,
  rejectProposal as rejectProposalOnChain,
  executeProposal as executeProposalOnChain,
  makeWalletSignFn,
} from '../utils/contractClient';

export default function useMultisig(publicKey, signTransaction) {
  const [proposals, setProposals]                     = useState([]);
  const [pendingProposals, setPendingProposals]        = useState([]);
  const [proposalsAsApprover, setProposalsAsApprover]  = useState([]);
  const [loading, setLoading]                         = useState(false);
  const [error, setError]                             = useState(null);

  function getWalletSignFn() {
    if (signTransaction) return makeWalletSignFn(signTransaction, publicKey);
    return null;
  }

  // Fetch all proposals for a given wallet address
  const fetchProposals = useCallback(async (wallet) => {
    if (!wallet) return;
    setLoading(true);
    try {
      const raw = await getProposals(wallet);
      setProposals(raw);
      setError(null);
    } catch (e) {
      console.warn('Proposals fetch failed:', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch only pending proposals for a given wallet address
  const fetchPendingProposals = useCallback(async (wallet) => {
    if (!wallet) return;
    setLoading(true);
    try {
      const raw = await getPendingProposals(wallet);
      setPendingProposals(raw);
      setError(null);
    } catch (e) {
      console.warn('Pending proposals fetch failed:', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch proposals where this wallet is listed as a required approver
  const fetchProposalsAsApprover = useCallback(async (wallet) => {
    if (!wallet) return;
    try {
      const raw = await getProposalsAsApprover(wallet);
      setProposalsAsApprover(raw);
    } catch (e) {
      console.warn('Approver proposals fetch failed:', e.message);
    }
  }, []);

  // Auto-fetch when wallet connects + poll every 15 s for real-time updates
  useEffect(() => {
    if (!publicKey) {
      setProposals([]);
      setPendingProposals([]);
      setProposalsAsApprover([]);
      return;
    }
    fetchProposals(publicKey);
    fetchPendingProposals(publicKey);
    fetchProposalsAsApprover(publicKey);

    const interval = setInterval(() => {
      fetchProposals(publicKey);
      fetchPendingProposals(publicKey);
      fetchProposalsAsApprover(publicKey);
    }, 15_000);
    return () => clearInterval(interval);
  }, [publicKey, fetchProposals, fetchPendingProposals, fetchProposalsAsApprover]);

  // Create a multisig proposal for a bill
  const createProposal = useCallback(async (billId, approvers, threshold) => {
    if (!publicKey || !signTransaction) return;
    setError(null);
    const signFn = getWalletSignFn();
    if (!signFn) { setError('Wallet not connected'); return; }
    try {
      const result = await proposePayment(publicKey, signFn, billId, approvers, threshold);
      await fetchPendingProposals(publicKey);
      return result;
    } catch (e) {
      const msg = e?.message || String(e);
      setError('Failed to create proposal: ' + msg);
      throw e;
    }
  }, [publicKey, signTransaction, fetchPendingProposals]); // eslint-disable-line

  // Approve a proposal created by proposerKey
  const approveProposal = useCallback(async (proposerKey, proposalId) => {
    if (!publicKey || !signTransaction) return;
    setError(null);
    const signFn = getWalletSignFn();
    if (!signFn) { setError('Wallet not connected'); return; }
    try {
      await approveProposalOnChain(publicKey, signFn, proposerKey, proposalId);
      // Optimistic update on BOTH state slices (proposer view + approver view)
      const updater = (prev) =>
        prev.map((p) =>
          p.id === String(proposalId)
            ? { ...p, approvals: [...new Set([...(p.approvals || []), publicKey])] }
            : p
        );
      setPendingProposals(updater);
      setProposalsAsApprover(updater);
      // Re-fetch accurate on-chain state
      fetchPendingProposals(publicKey);
      fetchProposalsAsApprover(publicKey);
    } catch (e) {
      setError('Failed to approve proposal: ' + (e?.message || String(e)));
    }
  }, [publicKey, signTransaction, fetchPendingProposals, fetchProposalsAsApprover]); // eslint-disable-line

  // Reject a proposal created by proposerKey
  const rejectProposal = useCallback(async (proposerKey, proposalId) => {
    if (!publicKey || !signTransaction) return;
    setError(null);
    const signFn = getWalletSignFn();
    if (!signFn) { setError('Wallet not connected'); return; }
    try {
      await rejectProposalOnChain(publicKey, signFn, proposerKey, proposalId);
      // Optimistic update on BOTH state slices
      const updater = (prev) =>
        prev.map((p) =>
          p.id === String(proposalId)
            ? { ...p, rejections: [...new Set([...(p.rejections || []), publicKey])] }
            : p
        );
      setPendingProposals(updater);
      setProposalsAsApprover(updater);
      // Re-fetch accurate on-chain state
      fetchPendingProposals(publicKey);
      fetchProposalsAsApprover(publicKey);
    } catch (e) {
      setError('Failed to reject proposal: ' + (e?.message || String(e)));
    }
  }, [publicKey, signTransaction, fetchPendingProposals, fetchProposalsAsApprover]); // eslint-disable-line

  // Execute a proposal once the approval threshold is met
  const executeProposal = useCallback(async (proposerKey, proposalId) => {
    if (!publicKey || !signTransaction) return;
    setError(null);
    const signFn = getWalletSignFn();
    if (!signFn) { setError('Wallet not connected'); return; }
    try {
      await executeProposalOnChain(publicKey, signFn, proposerKey, proposalId);
      // Remove from pending on success
      setPendingProposals((prev) => prev.filter((p) => p.id !== String(proposalId)));
    } catch (e) {
      setError('Failed to execute proposal: ' + (e?.message || String(e)));
    }
  }, [publicKey, signTransaction]); // eslint-disable-line

  return {
    proposals,
    pendingProposals,
    proposalsAsApprover,
    loading,
    error,
    fetchProposals,
    fetchPendingProposals,
    fetchProposalsAsApprover,
    createProposal,
    approveProposal,
    rejectProposal,
    executeProposal,
  };
}
