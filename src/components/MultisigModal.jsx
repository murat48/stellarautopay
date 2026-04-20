import { useState } from 'react';

/**
 * MultisigModal — opened when user clicks "Require Approval" on a bill.
 * Lets the user specify co-signer addresses and an approval threshold,
 * then calls createProposal(billContractId, approvers, threshold).
 */
export default function MultisigModal({ bill, onConfirm, onClose }) {
  const [approvers, setApprovers] = useState(['']);
  const [threshold, setThreshold] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  function handleApproverChange(index, value) {
    setApprovers((prev) => prev.map((a, i) => (i === index ? value : a)));
  }

  function addApprover() {
    setApprovers((prev) => [...prev, '']);
  }

  function removeApprover(index) {
    setApprovers((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleConfirm() {
    setError(null);
    const valid = approvers.map((a) => a.trim()).filter(Boolean);
    if (valid.length === 0) {
      setError('Add at least one co-signer address.');
      return;
    }
    if (threshold < 1 || threshold > valid.length) {
      setError(`Threshold must be between 1 and ${valid.length}.`);
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm(bill.contractId, valid, threshold);
      onClose();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const totalSigners = approvers.filter((a) => a.trim()).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Require Approval</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <p className="modal-description">
            Require co-signers to approve the payment of{' '}
            <strong>{bill.amount} {bill.asset}</strong> to{' '}
            <span className="mono">
              {bill.recipientAddress.slice(0, 8)}...{bill.recipientAddress.slice(-4)}
            </span>{' '}
            (<strong>{bill.name}</strong>).
          </p>

          <div className="form-group">
            <label className="form-label">Co-signer Wallet Addresses</label>
            {approvers.map((approver, index) => (
              <div key={index} className="approver-row">
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
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="btn-secondary btn-sm" onClick={addApprover}>
              + Add Co-signer
            </button>
          </div>

          {totalSigners > 0 && (
            <div className="form-group">
              <label className="form-label">
                Approval Threshold (required out of {totalSigners})
              </label>
              <select
                className="form-input"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              >
                {Array.from({ length: totalSigners }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} of {totalSigners}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && <div className="error-msg">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Create Proposal'}
          </button>
        </div>
      </div>
    </div>
  );
}
