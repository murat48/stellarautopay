import { useState } from 'react';

/** Days in a given month (month 0-indexed, JS style) */
function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/** Clamp targetDay to the last day of the month */
function effectiveDayForMonth(targetDay, year, month) {
  return Math.min(targetDay, daysInMonth(year, month));
}

function getDefaultDate(type, frequency, dayOfMonth = null) {
  const d = new Date();
  d.setSeconds(0, 0);

  if (type === 'one-time') {
    d.setHours(d.getHours() + 1);
  } else if (frequency === 'weekly') {
    d.setDate(d.getDate() + 7);
  } else if (frequency === 'biweekly') {
    d.setDate(d.getDate() + 14);
  } else if (frequency === 'quarterly') {
    d.setMonth(d.getMonth() + 3);
  } else if (frequency === 'monthly_day' && dayOfMonth) {
    // Next month on the specific day (clamped)
    let nextYear  = d.getFullYear();
    let nextMonth = d.getMonth() + 1;
    if (nextMonth > 11) { nextMonth = 0; nextYear++; }
    const day = effectiveDayForMonth(dayOfMonth, nextYear, nextMonth);
    d.setFullYear(nextYear, nextMonth, day);
    d.setHours(9, 0);
  } else {
    // monthly (plain)
    d.setMonth(d.getMonth() + 1);
  }

  return d.toISOString().slice(0, 16);
}

/** Human-readable tooltip about how Feb/short months are handled for a given day */
function dayWarning(day) {
  if (!day || day <= 28) return null;
  if (day === 29) return '⚠️ February: paid on Feb 28 in non-leap years, Feb 29 in leap years.';
  if (day === 30) return '⚠️ February: paid on Feb 28/29. All other months have 30+ days — no adjustment needed.';
  if (day === 31) return '⚠️ Shorter months: Apr/Jun/Sep/Nov → paid on 30th. Feb → paid on 28th/29th. All others → 31st as scheduled.';
  return null;
}

export default function AddBillForm({ onAdd, onClose }) {
  const [form, setForm] = useState({
    name: '',
    recipientAddress: '',
    amount: '',
    asset: 'XLM',
    type: 'recurring',
    frequency: 'monthly',
    dayOfMonth: 1,
    scheduledDate: getDefaultDate('recurring', 'monthly'),
  });
  const [error, setError] = useState('');

  // Multisig option
  const [requireMultisig, setRequireMultisig] = useState(false);
  const [approvers, setApprovers] = useState(['']);
  const [threshold, setThreshold] = useState(1);

  function handleApproverChange(index, value) {
    setApprovers((prev) => prev.map((a, i) => (i === index ? value : a)));
  }
  function addApprover() { setApprovers((prev) => [...prev, '']); }
  function removeApprover(index) {
    setApprovers((prev) => {
      const next = prev.filter((_, i) => i !== index);
      setThreshold((t) => Math.min(t, Math.max(1, next.filter(Boolean).length)));
      return next;
    });
  }

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => {
      const next = { ...prev, [name]: name === 'dayOfMonth' ? parseInt(value, 10) : value };
      // Recalculate suggested first-due date when frequency or day changes
      if (name === 'frequency') {
        next.scheduledDate = getDefaultDate(
          'recurring',
          value,
          value === 'monthly_day' ? prev.dayOfMonth : null
        );
      }
      if (name === 'dayOfMonth' && prev.frequency === 'monthly_day') {
        next.scheduledDate = getDefaultDate('recurring', 'monthly_day', parseInt(value, 10));
      }
      return next;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!form.name.trim()) return setError('Name is required');
    if (!form.recipientAddress.trim() || !form.recipientAddress.startsWith('G'))
      return setError('Valid recipient address required (starts with G)');
    if (!form.amount || parseFloat(form.amount) <= 0)
      return setError('Amount must be greater than 0');
    if (!form.scheduledDate) return setError('Date is required');
    if (form.frequency === 'monthly_day' && (!form.dayOfMonth || form.dayOfMonth < 1 || form.dayOfMonth > 31))
      return setError('Day of month must be between 1 and 31');

    const scheduledDateObj = new Date(form.scheduledDate);
    const minFuture = new Date(Date.now() + 60 * 1000);
    if (scheduledDateObj < minFuture) {
      return setError(
        form.type === 'one-time'
          ? 'Scheduled date must be in the future'
          : 'First due date must be in the future'
      );
    }

    // Map 'monthly_day' → 'monthly' for the actual frequency stored
    const frequency = form.type === 'recurring'
      ? (form.frequency === 'monthly_day' ? 'monthly_day' : form.frequency)
      : null;

    const bill = {
      name:             form.name.trim(),
      recipientAddress: form.recipientAddress.trim(),
      amount:           form.amount,
      asset:            form.asset,
      type:             form.type,
      frequency,
      dayOfMonth:       form.frequency === 'monthly_day' ? form.dayOfMonth : 0,
      nextDueDate:      scheduledDateObj.toISOString(),
    };

    if (requireMultisig) {
      const validApprovers = approvers.map((a) => a.trim()).filter(Boolean);
      if (validApprovers.length === 0) return setError('Add at least one co-signer address.');
      const validThreshold = parseInt(threshold, 10);
      if (validThreshold < 1 || validThreshold > validApprovers.length)
        return setError(`Threshold must be between 1 and ${validApprovers.length}.`);
      onAdd(bill, { approvers: validApprovers, threshold: validThreshold });
    } else {
      onAdd(bill);
    }
    onClose();
  };

  const warning = form.frequency === 'monthly_day' ? dayWarning(form.dayOfMonth) : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{form.type === 'recurring' ? 'Add Recurring Bill' : 'Schedule One-Time Payment'}</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Payment Type</label>
            <div className="type-toggle">
              <button
                type="button"
                className={`toggle-btn ${form.type === 'recurring' ? 'active' : ''}`}
                onClick={() => setForm((prev) => ({
                  ...prev,
                  type: 'recurring',
                  scheduledDate: getDefaultDate('recurring', prev.frequency, prev.dayOfMonth),
                }))}
              >
                🔄 Recurring
              </button>
              <button
                type="button"
                className={`toggle-btn ${form.type === 'one-time' ? 'active' : ''}`}
                onClick={() => setForm((prev) => ({
                  ...prev,
                  type: 'one-time',
                  scheduledDate: getDefaultDate('one-time', null),
                }))}
              >
                📅 One-Time
              </button>
            </div>
          </div>

          <div className="form-group">
            <label>Payment Name</label>
            <input
              name="name"
              placeholder={form.type === 'recurring' ? 'e.g. Server Hosting' : 'e.g. Invoice #1234'}
              value={form.name}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label>Recipient Address</label>
            <input
              name="recipientAddress"
              placeholder="G..."
              value={form.recipientAddress}
              onChange={handleChange}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Amount</label>
              <input
                name="amount"
                type="number"
                step="0.0000001"
                min="0"
                placeholder="0.00"
                value={form.amount}
                onChange={handleChange}
              />
            </div>
            <div className="form-group">
              <label>Asset</label>
              <select name="asset" value={form.asset} onChange={handleChange}>
                <option value="XLM">XLM</option>
                <option value="USDC">USDC</option>
              </select>
            </div>
          </div>

          {form.type === 'recurring' && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label>Frequency</label>
                  <select name="frequency" value={form.frequency} onChange={handleChange}>
                    <option value="weekly">Weekly (every 7 days)</option>
                    <option value="biweekly">Biweekly (every 14 days)</option>
                    <option value="monthly">Monthly (same relative day)</option>
                    <option value="monthly_day">Monthly on specific day</option>
                    <option value="quarterly">Quarterly (every 3 months)</option>
                  </select>
                </div>

                {form.frequency === 'monthly_day' && (
                  <div className="form-group">
                    <label>Day of Month</label>
                    <select name="dayOfMonth" value={form.dayOfMonth} onChange={handleChange}>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>{d}{
                          d === 28 ? ' (safe — all months)' :
                          d === 29 ? ' (⚠️ Feb adjustment)' :
                          d === 30 ? ' (⚠️ Feb adjustment)' :
                          d === 31 ? ' (⚠️ short month adjustment)' : ''
                        }</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {warning && (
                <div className="day-warning">
                  {warning}
                </div>
              )}
            </>
          )}

          <div className="form-group">
            <label>{form.type === 'recurring' ? 'First Due Date & Time' : 'Scheduled Date & Time'}</label>
            <input
              name="scheduledDate"
              type="datetime-local"
              value={form.scheduledDate}
              onChange={handleChange}
            />
            {form.type === 'recurring' && form.frequency === 'monthly_day' && (
              <span className="form-hint">
                Subsequent payments: every month on day {form.dayOfMonth}
                {form.dayOfMonth > 28 ? ', adjusted for shorter months' : ''}
              </span>
            )}
          </div>

          {error && <div className="error-msg">{error}</div>}

          {/* Multi-sig toggle */}
          <div className="form-group" style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '0.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={requireMultisig}
                onChange={(e) => setRequireMultisig(e.target.checked)}
                style={{ width: '1rem', height: '1rem', cursor: 'pointer' }}
              />
              <span>🔐 Require multi-sig approval before execution</span>
            </label>
            {requireMultisig && (
              <div style={{ marginTop: '0.75rem', paddingLeft: '1.75rem' }}>
                <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block' }}>
                  Co-signer Wallet Addresses
                </label>
                {approvers.map((approver, index) => (
                  <div key={index} className="approver-row" style={{ marginBottom: '0.4rem' }}>
                    <input
                      type="text"
                      className="form-input mono"
                      placeholder="G... Stellar address"
                      value={approver}
                      onChange={(e) => handleApproverChange(index, e.target.value)}
                      spellCheck={false}
                    />
                    {approvers.length > 1 && (
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        onClick={() => removeApprover(index)}
                        style={{ marginLeft: '0.4rem' }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" className="btn-secondary btn-sm" onClick={addApprover} style={{ marginTop: '0.25rem' }}>
                  + Add Co-signer
                </button>

                <div className="form-row" style={{ marginTop: '0.75rem', alignItems: 'center' }}>
                  <label className="form-label" style={{ whiteSpace: 'nowrap', marginBottom: 0, marginRight: '0.75rem' }}>
                    Approvals required:
                  </label>
                  <select
                    value={threshold}
                    onChange={(e) => setThreshold(parseInt(e.target.value, 10))}
                    className="form-input"
                    style={{ width: 'auto' }}
                  >
                    {Array.from({ length: Math.max(1, approvers.filter(Boolean).length) }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n} of {Math.max(1, approvers.filter(Boolean).length)}</option>
                    ))}
                  </select>
                </div>
                <p style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '0.4rem' }}>
                  Payment will only execute after {threshold} co-signer(s) approve it.
                </p>
              </div>
            )}
          </div>

          <button type="submit" className="btn-primary">
            {form.type === 'recurring' ? 'Add Recurring Bill' : 'Schedule Payment'}
          </button>
        </form>
      </div>
    </div>
  );
}
