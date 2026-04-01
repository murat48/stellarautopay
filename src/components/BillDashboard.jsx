import { useState } from 'react';
import AddBillForm from './AddBillForm';

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

export default function BillDashboard({ bills, addBill, pauseBill, deleteBill }) {
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('all'); // all, recurring, one-time, completed

  const filteredBills = bills.filter((bill) => {
    if (filter === 'recurring') return bill.type !== 'one-time' && bill.status !== 'completed' && bill.status !== 'paid';
    if (filter === 'one-time') return bill.type === 'one-time' && bill.status !== 'completed' && bill.status !== 'paid';
    if (filter === 'completed') return bill.status === 'completed' || bill.status === 'paid';
    return true;
  });

  return (
    <div className="bill-dashboard">
      <div className="section-header">
        <h2>Payments</h2>
        <div className="section-header-actions">
          <div className="filter-tabs">
            {['all', 'recurring', 'one-time', 'completed'].map((f) => (
              <button
                key={f}
                className={`filter-tab ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'one-time' ? 'One-Time' : f === 'completed' ? 'Paid / Done' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            + Add Payment
          </button>
        </div>
      </div>

      {filteredBills.length === 0 ? (
        <div className="empty-state">
          <p>{filter === 'all' ? 'No payments yet. Add your first payment to get started.' : `No ${filter} payments.`}</p>
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
              {bill.status !== 'completed' && bill.status !== 'paid' && (
                <div className="bill-card-actions">
                  <button onClick={() => pauseBill(bill.id)} className="btn-secondary">
                    {bill.status === 'active' || bill.status === 'low_balance' ? '⏸ Pause' : '▶ Resume'}
                  </button>
                  <button onClick={() => deleteBill(bill.id)} className="btn-danger">
                    🗑 Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <AddBillForm onAdd={addBill} onClose={() => setShowForm(false)} />
      )}
    </div>
  );
}
