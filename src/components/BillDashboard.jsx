import { useState } from 'react';
import AddBillForm from './AddBillForm';
import MultisigModal from './MultisigModal';
import ApprovalsTab from './ApprovalsTab';

function AnalyticsTab({ analytics, paymentHistory = [], bills = [] }) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const paidThisMonth = paymentHistory
    .filter((e) => {
      const s = Array.isArray(e.status) ? e.status[0] : e.status;
      return s?.toLowerCase() === 'success' && new Date(e.date) >= startOfMonth;
    })
    .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

  const totalTx     = analytics?.totalTx     ?? paymentHistory.length;
  const successTx   = analytics?.successTx   ?? paymentHistory.filter((e) => { const s = Array.isArray(e.status) ? e.status[0] : e.status; return s?.toLowerCase() === 'success'; }).length;
  const failedTx    = analytics?.failedTx    ?? 0;
  const successRate = analytics?.successRate ?? (totalTx > 0 ? Math.round((successTx / totalTx) * 100) : 0);
  const activeDays  = analytics?.activeDays  ?? 1;
  const retention   = analytics?.retentionDays ?? 1;
  const firstSeen   = analytics?.firstSeen ? new Date(analytics.firstSeen).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const lastSeen    = analytics?.lastSeen  ? new Date(analytics.lastSeen).toLocaleDateString('en-US',  { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  const completedBills = bills.filter((b) => b.status === 'completed' || b.status === 'paid').length;
  const activeBills    = bills.filter((b) => b.status === 'active').length;

  return (
    <div className="analytics-tab">
      <h3 className="analytics-title">📊 Your Usage Analytics</h3>

      <div className="analytics-section">
        <h4>Activity</h4>
        <div className="analytics-grid">
          <div className="analytics-card">
            <span className="analytics-value">{activeDays}</span>
            <span className="analytics-label">Active Days <span className="analytics-sub">(last 90d)</span></span>
          </div>
          <div className="analytics-card">
            <span className="analytics-value">{retention}d</span>
            <span className="analytics-label">Retention <span className="analytics-sub">(first → last login)</span></span>
          </div>
          <div className="analytics-card">
            <span className="analytics-value">{firstSeen}</span>
            <span className="analytics-label">First Seen</span>
          </div>
          <div className="analytics-card">
            <span className="analytics-value">{lastSeen}</span>
            <span className="analytics-label">Last Active</span>
          </div>
        </div>
      </div>

      <div className="analytics-section">
        <h4>Transactions</h4>
        <div className="analytics-grid">
          <div className="analytics-card">
            <span className="analytics-value">{totalTx}</span>
            <span className="analytics-label">Total TX</span>
          </div>
          <div className="analytics-card">
            <span className="analytics-value analytics-success">{successTx}</span>
            <span className="analytics-label">Successful</span>
          </div>
          <div className="analytics-card">
            <span className="analytics-value analytics-failed">{failedTx}</span>
            <span className="analytics-label">Failed</span>
          </div>
          <div className="analytics-card">
            <span className="analytics-value" style={{ color: successRate >= 80 ? '#22c55e' : successRate >= 50 ? '#f59e0b' : '#ef4444' }}>
              {successRate}%
            </span>
            <span className="analytics-label">TX Success Rate</span>
          </div>
        </div>
      </div>

      <div className="analytics-section">
        <h4>Bills</h4>
        <div className="analytics-grid">
          <div className="analytics-card">
            <span className="analytics-value">{bills.length}</span>
            <span className="analytics-label">Total Bills</span>
          </div>
          <div className="analytics-card">
            <span className="analytics-value analytics-success">{activeBills}</span>
            <span className="analytics-label">Active</span>
          </div>
          <div className="analytics-card">
            <span className="analytics-value">{completedBills}</span>
            <span className="analytics-label">Completed / Paid</span>
          </div>
          <div className="analytics-card">
            <span className="analytics-value analytics-success">{paidThisMonth.toFixed(2)}</span>
            <span className="analytics-label">Paid This Month</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function statusBadge(status) {
  const labels = {
    active: 'Active',
    paused: 'Paused',
    low_balance: 'Low Balance',
    completed: 'Completed',
    paid: '✅ Paid',
  };
  return <span className={`badge badge-${status}`}>{labels[status] || status}</span>;
}

function typeBadge(type) {
  if (type === 'one-time') {
    return <span className="badge badge-onetime">One-Time</span>;
  }
  return <span className="badge badge-recurring">Recurring</span>;
}

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

export default function BillDashboard({
  bills, addBill, pauseBill, deleteBill, publicKey, _signTransaction,
  pendingProposals, proposalsAsApprover, multisigLoading, multisigError,
  createProposal, approveProposal, rejectProposal, executeProposal,
  voteHistory, clearVoteHistory, paymentHistory, analytics,
}) {
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('unpaid'); // unpaid, recurring, one-time, completed, all, approvals
  const [multisigBill, setMultisigBill] = useState(null); // bill for which MultisigModal is open

  /**
   * Called by AddBillForm with an optional second arg for multisig.
   * If multisigOpts = { approvers, threshold } → create proposal immediately after adding.
   */
  async function handleAddBill(bill, multisigOpts) {
    const newBill = await addBill(bill);
    if (multisigOpts && newBill?.contractId) {
      try {
        await createProposal(newBill.contractId, multisigOpts.approvers, multisigOpts.threshold);
      } catch (e) {
        console.error('[Multisig] Could not create proposal after adding bill:', e?.message);
      }
    }
  }

  // Find an active multisig proposal for a given bill (created by the current wallet)
  const getProposalForBill = (bill) =>
    (pendingProposals || []).find(
      (p) => p.status === 'pending' && String(p.billId) === String(bill.contractId)
    ) ?? null;

  const isUnpaid = (bill) => bill.status !== 'completed' && bill.status !== 'paid';

  const filteredBills = bills
    .filter((bill) => {
      if (filter === 'unpaid')    return isUnpaid(bill);
      if (filter === 'recurring') return bill.type !== 'one-time' && isUnpaid(bill);
      if (filter === 'one-time')  return bill.type === 'one-time' && isUnpaid(bill);
      if (filter === 'completed') return bill.status === 'completed' || bill.status === 'paid';
      return true; // all
    })
    .sort((a, b) => {
      // unpaid views: sort by nextDueDate ascending (soonest first)
      if (filter !== 'completed' && filter !== 'all') {
        const aDate = a.nextDueDate ? new Date(a.nextDueDate).getTime() : Infinity;
        const bDate = b.nextDueDate ? new Date(b.nextDueDate).getTime() : Infinity;
        return aDate - bDate;
      }
      return 0;
    });

  return (
    <div className="bill-dashboard">
      <div className="section-header">
        <h2>Payments</h2>
        <div className="section-header-actions">
          <div className="filter-tabs">
            {['unpaid', 'recurring', 'one-time', 'completed', 'all', 'approvals', 'analytics'].map((f) => (
              <button
                key={f}
                className={`filter-tab ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'unpaid' ? 'Unpaid' : f === 'one-time' ? 'One-Time' : f === 'completed' ? 'Paid / Done' : f === 'all' ? 'All' : f === 'approvals' ? 'Approvals' : f === 'analytics' ? '📊 Analytics' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            + Add Payment
          </button>
        </div>
      </div>

      {filter === 'analytics' ? (
        <AnalyticsTab analytics={analytics} paymentHistory={paymentHistory} bills={bills} />
      ) : filter === 'approvals' ? (
        <ApprovalsTab
          publicKey={publicKey}
          pendingProposals={pendingProposals}
          proposalsAsApprover={proposalsAsApprover}
          loading={multisigLoading}
          error={multisigError}
          approveProposal={approveProposal}
          rejectProposal={rejectProposal}
          executeProposal={executeProposal}
          voteHistory={voteHistory}
          clearVoteHistory={clearVoteHistory}
          paymentHistory={paymentHistory}
        />
      ) : filteredBills.length === 0 ? (
        <div className="empty-state">
          <p>{filter === 'unpaid' ? 'No unpaid payments.' : filter === 'all' ? 'No payments yet. Add your first payment to get started.' : `No ${filter} payments.`}</p>
        </div>
      ) : (
        <div className="bill-grid">
          {filteredBills.map((bill) => (
            <div key={bill.id} className={`bill-card bill-card-${bill.status}`}>
              <div className="bill-card-header">
                <h3>{bill.name}</h3>
                <div className="bill-badges">
                  {typeBadge(bill.type)}
                  {statusBadge(bill.status)}
                </div>
              </div>
              <div className="bill-card-body">
                <div className="bill-detail">
                  <span className="label">Amount</span>
                  <span className="value">{bill.amount} {bill.asset}</span>
                </div>
                <div className="bill-detail">
                  <span className="label">{bill.type === 'one-time' ? 'Type' : 'Frequency'}</span>
                  <span className="value">{
                    bill.type === 'one-time' ? 'One-time' :
                    bill.frequency === 'weekly'      ? 'Weekly' :
                    bill.frequency === 'biweekly'    ? 'Biweekly' :
                    bill.frequency === 'monthly'     ? 'Monthly' :
                    bill.frequency === 'monthly_day' ? `Monthly — day ${bill.dayOfMonth ?? '?'}` :
                    bill.frequency === 'quarterly'   ? 'Quarterly' :
                    bill.frequency ?? '—'
                  }</span>
                </div>
                <div className="bill-detail">
                  <span className="label">{bill.status === 'completed' || bill.status === 'paid' ? 'Paid On' : 'Scheduled'}</span>
                  <span className="value">{formatDate(bill.nextDueDate)}</span>
                </div>
                <div className="bill-detail">
                  <span className="label">Recipient</span>
                  <span className="value mono">
                    {bill.recipientAddress.slice(0, 8)}...{bill.recipientAddress.slice(-4)}
                  </span>
                </div>
              </div>
              {bill.status !== 'completed' && bill.status !== 'paid' && (function() {
                  const proposal = getProposalForBill(bill);
                  const thresholdMet = proposal && (proposal.approvals || []).length >= proposal.threshold;
                  return (
                    <div className="bill-card-actions">
                      <button onClick={() => pauseBill(bill.id)} className="btn-secondary">
                        {bill.status === 'active' || bill.status === 'low_balance' ? '⏸ Pause' : '▶ Resume'}
                      </button>

                      {!proposal ? (
                        // No proposal yet — allow creating one
                        <button onClick={() => setMultisigBill(bill)} className="btn-secondary">
                          🔐 Require Approval
                        </button>
                      ) : thresholdMet ? (
                        // Threshold met — ready to execute
                        <button
                          className="btn-primary"
                          onClick={() => executeProposal(proposal.proposer, proposal.id)}
                        >
                          ⚡ Execute ({(proposal.approvals || []).length}/{proposal.threshold} ✓)
                        </button>
                      ) : (
                        // Proposal pending, waiting for co-signers
                        <span className="badge badge-pending" style={{ padding: '0.35rem 0.75rem' }}>
                          ⏳ {(proposal.approvals || []).length}/{proposal.threshold} Approvals
                        </span>
                      )}

                      <button onClick={() => deleteBill(bill.id)} className="btn-danger">
                        🗑 Delete
                      </button>
                    </div>
                  );
                })()}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <AddBillForm onAdd={handleAddBill} onClose={() => setShowForm(false)} />
      )}

      {multisigBill && (
        <MultisigModal
          bill={multisigBill}
          onConfirm={createProposal}
          onClose={() => setMultisigBill(null)}
        />
      )}
    </div>
  );
}
