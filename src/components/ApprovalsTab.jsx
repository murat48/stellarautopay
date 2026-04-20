import { useState, useEffect } from 'react';
import { getPendingProposals, getPaymentHistory } from '../utils/contractClient';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusBadge(status) {
  const labels = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', executed: 'Executed' };
  return <span className={`badge badge-${status}`}>{labels[status] || status}</span>;
}

/**
 * ApprovalsTab — shows:
 *   1. Proposals created by the current wallet (Your Proposals)
 *   2. Proposals where this wallet is a required approver, auto-fetched on connect
 *   3. Manual lookup section for edge cases
 */
export default function ApprovalsTab({
  publicKey,
  pendingProposals,
  proposalsAsApprover,
  loading,
  error,
  approveProposal,
  rejectProposal,
  executeProposal,
  voteHistory,
  clearVoteHistory,
  paymentHistory,
}) {
  const [lookupAddress, setLookupAddress] = useState('');
  const [lookedUpProposals, setLookedUpProposals] = useState(null); // array of Proposal objects
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState(null);
  const [actionPending, setActionPending] = useState(null); // proposalId being acted on
  // Map<proposerAddress, paymentEntry[]> — fetched from contract to find executed TXes
  const [proposerHistories, setProposerHistories] = useState({});

  // Fetch payment history for each unique proposer referenced in vote history
  useEffect(() => {
    const uniqueProposers = [...new Set((voteHistory || []).map((v) => v.proposer).filter(Boolean))];
    if (uniqueProposers.length === 0) return;
    uniqueProposers.forEach((proposerAddr) => {
      if (proposerHistories[proposerAddr]) return; // already fetched
      getPaymentHistory(proposerAddr)
        .then((records) => {
          setProposerHistories((prev) => ({ ...prev, [proposerAddr]: records }));
        })
        .catch(() => {
          setProposerHistories((prev) => ({ ...prev, [proposerAddr]: [] }));
        });
    });
  }, [voteHistory]); // eslint-disable-line

  async function handleLookup() {
    const target = lookupAddress.trim();
    if (!target) return;
    setLookupError(null);
    setLookupLoading(true);
    try {
      // Fetch into local state — does NOT touch the global pendingProposals
      const results = await getPendingProposals(target);
      setLookedUpProposals(results);
    } catch (e) {
      setLookupError(e?.message || String(e));
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleAction(action, proposerKey, proposalId) {
    setActionPending(proposalId);
    try {
      await action(proposerKey, proposalId);
    } finally {
      setActionPending(null);
    }
  }

  // Proposals created by the current user
  const ownProposals = pendingProposals.filter((p) => p.proposer === publicKey);
  // proposalsAsApprover comes pre-filtered from the contract (pending only, where wallet is listed as approver)

  const renderProposalCard = (proposal) => {
    const thresholdMet = (proposal.approvals || []).length >= proposal.threshold;
    const alreadyApproved = (proposal.approvals || []).includes(publicKey);
    const alreadyRejected = (proposal.rejections || []).includes(publicKey);
    // Only wallets explicitly listed as required approvers may approve/reject
    const isApprover = (proposal.requiredApprovers || []).includes(publicKey);
    const busy = actionPending === proposal.id;

    return (
      <div key={proposal.id} className={`bill-card bill-card-${proposal.status}`}>
        <div className="bill-card-header">
          <h3>{proposal.billName || `Bill #${proposal.billId}`}</h3>
          <div className="bill-badges">
            {statusBadge(proposal.status)}
          </div>
        </div>
        <div className="bill-card-body">
          <div className="bill-detail">
            <span className="label">Proposal ID</span>
            <span className="value">#{proposal.id}</span>
          </div>
          <div className="bill-detail">
            <span className="label">Proposer</span>
            <span className="value mono">
              {proposal.proposer
                ? `${proposal.proposer.slice(0, 8)}...${proposal.proposer.slice(-4)}`
                : '—'}
            </span>
          </div>
          <div className="bill-detail">
            <span className="label">Approvals</span>
            <span className="value">
              {(proposal.approvals || []).length} / {proposal.threshold} required
            </span>
          </div>
          <div className="bill-detail">
            <span className="label">Rejections</span>
            <span className="value">{(proposal.rejections || []).length}</span>
          </div>
          <div className="bill-detail">
            <span className="label">Co-signers</span>
            <span className="value">{(proposal.requiredApprovers || []).length}</span>
          </div>
          <div className="bill-detail">
            <span className="label">Created</span>
            <span className="value">{formatDate(proposal.createdAt)}</span>
          </div>
        </div>

        {proposal.status === 'pending' && (isApprover || thresholdMet) && (
          <div className="bill-card-actions">
            {isApprover && !alreadyApproved && !alreadyRejected && (
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => handleAction(approveProposal, proposal.proposer, proposal.id)}
              >
                {busy ? '…' : '✓ Approve'}
              </button>
            )}
            {isApprover && !alreadyRejected && (
              <button
                className="btn-danger"
                disabled={busy}
                onClick={() => handleAction(rejectProposal, proposal.proposer, proposal.id)}
              >
                {busy ? '…' : '✕ Reject'}
              </button>
            )}
            {thresholdMet && (
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => handleAction(executeProposal, proposal.proposer, proposal.id)}
              >
                {busy ? '…' : '⚡ Execute'}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bill-dashboard">
      <div className="section-header">
        <h2>Pending Approvals</h2>
      </div>

      {error && <div className="error-msg" style={{ marginBottom: '1rem' }}>{error}</div>}

      {loading ? (
        <div className="empty-state"><p>Loading proposals…</p></div>
      ) : (
        <>
          {/* Proposals initiated by the connected wallet */}
          <h3 className="approvals-section-title">Your Proposals</h3>
          {ownProposals.length === 0 ? (
            <div className="empty-state"><p>No pending proposals created by your wallet.</p></div>
          ) : (
            <div className="bill-grid">
              {ownProposals.map(renderProposalCard)}
            </div>
          )}

          {/* Proposals from other wallets that need this wallet's signature */}
          {(proposalsAsApprover || []).length > 0 && (
            <>
              <h3 className="approvals-section-title" style={{ marginTop: '1.5rem' }}>
                Awaiting Your Signature
              </h3>
              <div className="bill-grid">
                {(proposalsAsApprover || []).map(renderProposalCard)}
              </div>
            </>
          )}

          {/* My Vote History — decisions this wallet has made on multisig proposals */}
          {(voteHistory || []).length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2rem' }}>
                <h3 className="approvals-section-title" style={{ margin: 0 }}>My Vote History</h3>
                <button className="btn-secondary btn-sm" onClick={clearVoteHistory}>Clear</button>
              </div>
              <div className="table-wrapper" style={{ marginTop: '0.75rem' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Bill</th>
                      <th>Amount</th>
                      <th>My Vote</th>
                      <th>Date</th>
                      <th>Executed TX</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(voteHistory || []).map((entry) => {
                      // Find a successful payment — check own history first, then proposer's
                      const allCandidates = [
                        ...(paymentHistory || []),
                        ...(proposerHistories[entry.proposer] || []),
                      ];
                      const matchingPayment = allCandidates.find(
                        (h) =>
                          h.status === 'success' &&
                          (entry.internalBillId
                            ? h.billId === entry.internalBillId
                            : h.billName === entry.billName),
                      );
                      return (
                        <tr key={entry.id}>
                          <td>{entry.billName}</td>
                          <td>
                            {entry.amount != null
                              ? `${entry.amount} ${entry.asset}`
                              : matchingPayment?.amount != null
                              ? `${matchingPayment.amount} ${matchingPayment.asset ?? entry.asset}`
                              : '—'}
                          </td>
                          <td>
                            {entry.vote === 'approved' ? (
                              <span className="badge badge-approved">✅ Approved</span>
                            ) : (
                              <span className="badge badge-rejected">❌ Rejected</span>
                            )}
                          </td>
                          <td>{formatDate(entry.timestamp)}</td>
                          <td>
                            {matchingPayment ? (
                              <span className="tx-links">
                                <a
                                  href={`https://stellar.expert/explorer/testnet/tx/${matchingPayment.txHash}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="tx-link"
                                  title="View on Stellar Expert"
                                >
                                  {matchingPayment.txHash.slice(0, 8)}...{matchingPayment.txHash.slice(-4)}
                                </a>
                                <a
                                  href={`https://horizon-testnet.stellar.org/transactions/${matchingPayment.txHash}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="tx-link-horizon"
                                  title="Verify on Horizon"
                                >
                                  [H]
                                </a>
                              </span>
                            ) : entry.vote === 'approved' ? (
                              <span style={{ opacity: 0.5, fontSize: '0.85rem' }}>Pending...</span>
                            ) : (
                              <span style={{ opacity: 0.4 }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Lookup proposals from another proposer's wallet */}
          <div className="approvals-lookup" style={{ marginTop: '2rem' }}>
            <h3 className="approvals-section-title">Look Up Proposals by Proposer</h3>
            <div className="approver-row">
              <input
                type="text"
                className="form-input mono"
                placeholder="G... Stellar address"
                value={lookupAddress}
                onChange={(e) => setLookupAddress(e.target.value)}
                spellCheck={false}
              />
              <button
                className="btn-secondary btn-sm"
                onClick={handleLookup}
                disabled={lookupLoading || !lookupAddress.trim()}
              >
                {lookupLoading ? '…' : 'Look Up'}
              </button>
            </div>
            {lookupError && <div className="error-msg" style={{ marginTop: '0.5rem' }}>{lookupError}</div>}
            {lookedUpProposals !== null && !lookupLoading && (
              <>
                <p className="mono" style={{ marginTop: '0.5rem', fontSize: '0.85rem', opacity: 0.7 }}>
                  Showing proposals for {lookupAddress.trim().slice(0, 8)}...{lookupAddress.trim().slice(-4)}
                </p>
                {lookedUpProposals.length === 0 ? (
                  <div className="empty-state"><p>No pending proposals for that address.</p></div>
                ) : (
                  <div className="bill-grid" style={{ marginTop: '1rem' }}>
                    {lookedUpProposals.map(renderProposalCard)}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
