import { useState, useEffect } from 'react';
import { getPaymentHistory } from '../utils/contractClient';

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
 *   1. Pending Approvals — proposals where this wallet is a required approver (pending only)
 *   2. My Vote History — decisions this wallet has made
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
  const [actionPending, setActionPending] = useState(null);
  const [proposerHistories, setProposerHistories] = useState({});

  useEffect(() => {
    const uniqueProposers = [...new Set((voteHistory || []).map((v) => v.proposer).filter(Boolean))];
    if (uniqueProposers.length === 0) return;
    uniqueProposers.forEach((proposerAddr) => {
      if (proposerHistories[proposerAddr]) return;
      getPaymentHistory(proposerAddr)
        .then((records) => setProposerHistories((prev) => ({ ...prev, [proposerAddr]: records })))
        .catch(() => setProposerHistories((prev) => ({ ...prev, [proposerAddr]: [] })));
    });
  }, [voteHistory]); // eslint-disable-line

  async function handleAction(action, proposerKey, proposalId) {
    setActionPending(proposalId);
    try {
      await action(proposerKey, proposalId);
    } finally {
      setActionPending(null);
    }
  }

  const renderProposalCard = (proposal) => {
    const thresholdMet = (proposal.approvals || []).length >= proposal.threshold;
    const alreadyApproved = (proposal.approvals || []).includes(publicKey);
    const alreadyRejected = (proposal.rejections || []).includes(publicKey);
    const isApprover = (proposal.requiredApprovers || []).includes(publicKey);
    const busy = actionPending === proposal.id;

    return (
      <div key={proposal.id} className={`bill-card bill-card-${proposal.status}`}>
        <div className="bill-card-header">
          <h3>{proposal.billName || `Bill #${proposal.billId}`}</h3>
          <div className="bill-badges">
            {alreadyApproved
              ? <span className="badge badge-approved">✅ Approved</span>
              : alreadyRejected
              ? <span className="badge badge-rejected">❌ Rejected</span>
              : statusBadge(proposal.status)}
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
            <span className="label">Created</span>
            <span className="value">{formatDate(proposal.createdAt)}</span>
          </div>
        </div>

        {/* Only show action buttons if not yet voted and still pending */}
        {proposal.status === 'pending' && isApprover && !alreadyApproved && !alreadyRejected && (
          <div className="bill-card-actions">
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => handleAction(approveProposal, proposal.proposer, proposal.id)}
            >
              {busy ? '…' : '✓ Approve'}
            </button>
            <button
              className="btn-danger"
              disabled={busy}
              onClick={() => handleAction(rejectProposal, proposal.proposer, proposal.id)}
            >
              {busy ? '…' : '✕ Reject'}
            </button>
          </div>
        )}

        {/* Execute button for proposer when threshold is met */}
        {proposal.status === 'pending' && thresholdMet && proposal.proposer === publicKey && (
          <div className="bill-card-actions">
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => handleAction(executeProposal, proposal.proposer, proposal.id)}
            >
              {busy ? '…' : '⚡ Execute'}
            </button>
          </div>
        )}
      </div>
    );
  };

  // Pending = status pending AND user hasn't voted yet
  const pendingForMe = (proposalsAsApprover || []).filter(
    (p) => p.status === 'pending' &&
      !(p.approvals || []).includes(publicKey) &&
      !(p.rejections || []).includes(publicKey),
  );

  // Approved = user has already voted (approved or rejected)
  const votedByMe = (proposalsAsApprover || []).filter(
    (p) =>
      (p.approvals || []).includes(publicKey) ||
      (p.rejections || []).includes(publicKey),
  );

  const [subTab, setSubTab] = useState('pending');

  return (
    <div className="bill-dashboard">
      {/* Sub-tab bar */}
      <div className="filter-tabs" style={{ marginBottom: '1.25rem' }}>
        <button
          className={`filter-tab${subTab === 'pending' ? ' active' : ''}`}
          onClick={() => setSubTab('pending')}
        >
          Pending{pendingForMe.length > 0 ? ` (${pendingForMe.length})` : ''}
        </button>
        <button
          className={`filter-tab${subTab === 'approved' ? ' active' : ''}`}
          onClick={() => setSubTab('approved')}
        >
          Approved{votedByMe.length > 0 ? ` (${votedByMe.length})` : ''}
        </button>
      </div>

      {error && <div className="error-msg" style={{ marginBottom: '1rem' }}>{error}</div>}

      {loading ? (
        <div className="empty-state"><p>Loading proposals…</p></div>
      ) : subTab === 'pending' ? (
        <>
          {pendingForMe.length === 0 ? (
            <div className="empty-state"><p>No proposals awaiting your signature.</p></div>
          ) : (
            <div className="bill-grid">
              {pendingForMe.map(renderProposalCard)}
            </div>
          )}

          {/* My Vote History (under pending tab) */}
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
        </>
      ) : (
        /* ── Approved tab ── */
        <>
          {votedByMe.length === 0 ? (
            <div className="empty-state"><p>You haven't voted on any proposals yet.</p></div>
          ) : (
            <div className="bill-grid">
              {votedByMe.map(renderProposalCard)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
