import './App.css';
import { useState, useEffect, useCallback } from 'react';
import useWallet from './hooks/useWallet';
import useBills from './hooks/useBills';
import usePaymentHistory from './hooks/usePaymentHistory';
import usePaymentEngine, { calculateNextDueDate } from './hooks/usePaymentEngine';
import useTelegram from './hooks/useTelegram';
import useMultisig from './hooks/useMultisig';
import useApprovalHistory from './hooks/useApprovalHistory';
import useAnalytics from './hooks/useAnalytics';
import { sendPayment, buildPaymentTxXdr, classifyError } from './utils/stellar';
import { logger } from './utils/logger';
import { makeSessionSignFn, makeWalletSignFn, executeProposal as executeProposalContract, getAllBills, contractBillToFrontend } from './utils/contractClient';
import WalletConnect from './components/WalletConnect';
import BillDashboard from './components/BillDashboard';
import PaymentHistory from './components/PaymentHistory';
import MetricsStrip from './components/MetricsStrip';
import LowBalanceWarning from './components/LowBalanceWarning';
import TelegramSettings from './components/TelegramSettings';
import FeedbackForm from './components/FeedbackForm';

function App() {
  const wallet = useWallet();
  const { bills, addBill, updateBill, completeBill, markBillPaid, pauseBill, deleteBill, fetchBills, contractReady, loading: billsLoading, error: billsError } = useBills(
    wallet.publicKey,
    wallet.signTransaction,
    wallet.getSessionKeypair
  );
  const { history, addEntry, loadHistory, clearHistory } = usePaymentHistory();

  const {
    telegramConfig,
    updateTelegramConfig,
    sendTelegramMessage,
    testTelegramConnection,
    testStatus,
  } = useTelegram();

  const {
    pendingProposals,
    proposalsAsApprover,
    loading: multisigLoading,
    error: multisigError,
    createProposal: createProposalBase,
    approveProposal: approveProposalBase,
    rejectProposal: rejectProposalBase,
    executeProposal: executeProposalOnChain,
  } = useMultisig(wallet.publicKey, wallet.signTransaction);

  const { voteHistory, recordVote, clearVoteHistory } = useApprovalHistory(wallet.publicKey);
  const analytics = useAnalytics(wallet.publicKey, history);

  /**
   * Find bill details for a proposal — checks own bills first (fast),
   * then falls back to fetching the proposer's on-chain bills (needed when
   * the current wallet is a co-signer, not the bill owner).
   */
  async function resolveBillForProposal(proposal) {
    const local = bills.find((b) => String(b.contractId) === String(proposal.billId));
    if (local) return local;
    if (!proposal.proposer) return null;
    try {
      const raw = await getAllBills(proposal.proposer);
      const match = raw.find((b) => String(b.id) === String(proposal.billId));
      return match ? contractBillToFrontend(match) : null;
    } catch {
      return null;
    }
  }

  // Wrap approve/reject to record vote history and send Telegram notifications
  const approveProposal = useCallback(async (proposerKey, proposalId) => {
    // Capture proposal data before the base call mutates state
    const proposal = [...pendingProposals, ...proposalsAsApprover].find(
      (p) => p.id === String(proposalId)
    );
    await approveProposalBase(proposerKey, proposalId);
    if (proposal) {
      const bill = await resolveBillForProposal(proposal);
      recordVote(proposal, 'approved', bill);
      if (sendTelegramMessage) {
        sendTelegramMessage(
          `✅ *Multisig Approval Received*\n\n` +
          `Bill: *${proposal.billName || `#${proposal.billId}`}*\n` +
          `Approved by: \`${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-4)}\`\n` +
          `Approvals: *${(proposal.approvals || []).length + 1}/${proposal.threshold}*`
        ).catch((e) => logger.error('Telegram', e?.message));
      }
    }
  }, [approveProposalBase, pendingProposals, proposalsAsApprover, bills, wallet.publicKey, sendTelegramMessage, recordVote]); // eslint-disable-line

  const rejectProposal = useCallback(async (proposerKey, proposalId) => {
    // Capture proposal data before the base call mutates state
    const proposal = [...pendingProposals, ...proposalsAsApprover].find(
      (p) => p.id === String(proposalId)
    );
    await rejectProposalBase(proposerKey, proposalId);
    if (proposal) {
      const bill = await resolveBillForProposal(proposal);
      recordVote(proposal, 'rejected', bill);
      if (sendTelegramMessage) {
        sendTelegramMessage(
          `❌ *Multisig Proposal Rejected*\n\n` +
          `Bill: *${proposal.billName || `#${proposal.billId}`}*\n` +
          `Rejected by: \`${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-4)}\``
        ).catch((e) => logger.error('Telegram', e?.message));
      }
    }
  }, [rejectProposalBase, pendingProposals, proposalsAsApprover, bills, wallet.publicKey, sendTelegramMessage, recordVote]); // eslint-disable-line

  // Wrap createProposal to send a Telegram when a multisig request is created
  const createProposal = useCallback(async (billId, approvers, threshold) => {
    const result = await createProposalBase(billId, approvers, threshold);
    if (sendTelegramMessage) {
      const bill = bills.find((b) => String(b.contractId) === String(billId));
      sendTelegramMessage(
        `🔐 *Multisig Request Created*\n\n` +
        `Bill: *${bill?.name || `#${billId}`}*\n` +
        `Amount: *${bill?.amount ?? '?'} ${bill?.asset ?? 'XLM'}*\n` +
        `Co-signers required: *${approvers.length}*\n` +
        `Threshold: *${threshold}/${approvers.length}*\n\n` +
        `Co-signer(s) must approve before automatic execution.`
      ).catch((e) => logger.error('Telegram', e?.message));
    }
    return result;
  }, [createProposalBase, bills, sendTelegramMessage]); // eslint-disable-line

  /**
   * Execute a proposal on-chain and immediately send the real Stellar payment.
   * Mirrors the exact payment + post-payment flow from usePaymentEngine.
   */
  const executeProposalAndPay = useCallback(async (proposerKey, proposalId) => {
    // Step 1: Find proposal → bill
    const proposal = pendingProposals.find((p) => p.id === String(proposalId));
    if (!proposal) throw new Error('Proposal not found in pending list');
    const bill = bills.find((b) => String(b.contractId) === String(proposal.billId));
    if (!bill) throw new Error(`Bill #${proposal.billId} not found`);

    // Step 2: Choose sign function — session key in auto mode (no Freighter popup),
    //         wallet sign in manual mode. execute_proposal has no require_auth so
    //         any valid signer works; the on-chain threshold already guards security.
    const sessionKp = wallet.getSessionKeypair?.();
    const isAutoMode = wallet.autoPayEnabled && !!sessionKp;
    const contractSignFn = isAutoMode
      ? makeSessionSignFn(sessionKp)
      : wallet.signTransaction
      ? makeWalletSignFn(wallet.signTransaction, wallet.publicKey)
      : null;

    if (!contractSignFn) throw new Error('No sign function available');

    // Step 3: Mark executed on-chain (signed silently with session key in auto mode)
    await executeProposalContract(wallet.publicKey, contractSignFn, proposerKey, proposalId);

    // Step 4: Send the actual Stellar payment
    let result;
    try {
      if (isAutoMode) {
        result = await sendPayment(sessionKp, wallet.publicKey, bill.recipientAddress, bill.amount, bill.asset);
      } else {
        const xdr = await buildPaymentTxXdr(wallet.publicKey, bill.recipientAddress, bill.amount, bill.asset);
        result = await wallet.walletSignAndSubmit(xdr);
      }
    } catch (err) {
      const classified = classifyError(err);
      addEntry({
        billName: bill.name, billId: bill.id,
        recipientAddress: bill.recipientAddress,
        amount: bill.amount, asset: bill.asset,
        txHash: '', status: 'failed', error: classified.message,
      }, wallet.publicKey, contractSignFn).catch(() => {});
      throw err;
    }

    // Step 5: Record payment in history
    await addEntry({
      billName: bill.name, billId: bill.id,
      recipientAddress: bill.recipientAddress,
      amount: bill.amount, asset: bill.asset,
      txHash: result.hash, status: 'success', error: '',
    }, wallet.publicKey, contractSignFn);

    // Step 6: Update bill status on-chain
    if (bill.type === 'one-time') {
      markBillPaid(bill.id, contractSignFn).catch((e) => console.warn('mark_paid failed:', e?.message));
    } else {
      updateBill(bill.id, {
        nextDueDate: calculateNextDueDate(bill.nextDueDate, bill.frequency, bill.dayOfMonth ?? 0),
      }, contractSignFn).catch((e) => console.warn('update_next_due failed:', e?.message));
    }

    // Step 7: Refresh balance
    wallet.refreshBalance?.().catch(() => {});

    // Step 8: Telegram notification
    if (sendTelegramMessage) {
      const paidAt = new Date().toLocaleString('en-GB');
      const typeLabel = bill.type === 'one-time' ? 'One-time payment' : 'Recurring bill';
      sendTelegramMessage(
        `✅ *Multisig Payment Executed*\n\n${typeLabel}: *${bill.name}*\nAmount: *${bill.amount} ${bill.asset}*\nRecipient: \`${bill.recipientAddress.slice(0, 8)}...${bill.recipientAddress.slice(-4)}\`\nDate: ${paidAt}\n\n[View on Stellar Explorer](https://stellar.expert/explorer/testnet/tx/${result.hash})`
      ).catch((e) => logger.error('Telegram', e?.message));
    }
  }, [pendingProposals, bills, wallet, addEntry, updateBill, markBillPaid, sendTelegramMessage]); // eslint-disable-line

  // Load on-chain history when wallet connects; clear it on disconnect
  useEffect(() => {
    if (wallet.publicKey) {
      loadHistory(wallet.publicKey);
    } else {
      clearHistory();
    }
  }, [wallet.publicKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [showTelegramSettings, setShowTelegramSettings] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  usePaymentEngine(
    wallet.publicKey,
    wallet.getSessionKeypair,
    wallet.autoPayEnabled,
    contractReady,
    bills,
    updateBill,
    completeBill,
    markBillPaid,
    addEntry,
    wallet.refreshBalance,
    wallet.balances,
    sendTelegramMessage,
    wallet.walletSignAndSubmit,
    wallet.signTransaction,
    pendingProposals,
    executeProposalAndPay
  );

  if (!wallet.publicKey) {
    return (
      <WalletConnect
        onConnect={wallet.connect}
        loading={wallet.loading}
        error={wallet.error}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <span className="logo-icon">✦</span>
          <h1>Stellar Autopay</h1>
        </div>
        <div className="header-right">
          <div className="wallet-info">
            <div className="wallet-balances">
              <div className="balance-chip balance-xlm">
                <span className="balance-icon">✦</span>
                <span className="balance-amount">{(wallet.balances.XLM || 0).toFixed(2)}</span>
                <span className="balance-ticker">XLM</span>
              </div>
              {wallet.balances.USDC !== undefined && (
                <div className="balance-chip balance-usdc">
                  <span className="balance-icon">$</span>
                  <span className="balance-amount">{wallet.balances.USDC.toFixed(2)}</span>
                  <span className="balance-ticker">USDC</span>
                </div>
              )}
            </div>
            <div className="wallet-meta">
              <span className="wallet-address">
                {wallet.publicKey.slice(0, 6)}...{wallet.publicKey.slice(-4)}
              </span>
              {wallet.autoPayEnabled ? (
                <span className="autopay-badge autopay-on">⚡ Auto-Pay ON</span>
              ) : (
                <span className="autopay-badge autopay-off">⏸ Auto-Pay OFF</span>
              )}
              {contractReady ? (
                <span className="autopay-badge autopay-on">📜 Contract ON</span>
              ) : (
                <span className="autopay-badge autopay-off">📜 Contract...</span>
              )}
            </div>
          </div>
          <button className="btn-secondary btn-sm" onClick={wallet.refreshBalance}>
            ↻
          </button>
          <button
            className={`btn-sm ${telegramConfig.enabled ? 'btn-telegram-on' : 'btn-secondary'}`}
            onClick={() => setShowTelegramSettings(true)}
          >
            {telegramConfig.enabled ? '📨 Telegram ON' : '📨 Telegram'}
          </button>
          {wallet.autoPayEnabled ? (
            <button
              className="btn-warning btn-sm"
              onClick={wallet.disableAutoPay}
              disabled={wallet.autoPayLoading}
            >
              {wallet.autoPayLoading ? '...' : 'Disable Auto-Pay'}
            </button>
          ) : (
            <button
              className="btn-success btn-sm"
              onClick={wallet.enableAutoPay}
              disabled={wallet.autoPayLoading}
            >
              {wallet.autoPayLoading ? 'Signing...' : '⚡ Enable Auto-Pay'}
            </button>
          )}
          <button className="btn-feedback btn-sm" onClick={() => setShowFeedback(true)}>
            💬 Feedback
          </button>
          <button className="btn-danger btn-sm" onClick={wallet.disconnect}>
            Disconnect
          </button>
        </div>
      </header>

      {wallet.error && (
        <div className="error-msg" style={{ margin: '0 0 1rem' }}>{wallet.error}</div>
      )}
      {billsError && (
        <div className="error-msg" style={{ margin: '0 0 1rem' }}>{billsError}</div>
      )}

      {!wallet.autoPayEnabled && (
        <div className="autopay-prompt">
          <div className="autopay-prompt-icon">⚡</div>
          <div>
            <strong>Auto-Pay is OFF — Manual signing mode active</strong>
            <p>
              Due payments will still run, but your wallet (Freighter) will pop up to sign each one.
              Click <strong>⚡ Enable Auto-Pay</strong> to authorize a one-time session key —
              after that, payments happen fully automatically with no interruptions.
            </p>
          </div>
        </div>
      )}

      <main className="app-main">
        <LowBalanceWarning balances={wallet.balances} bills={bills} />
        <MetricsStrip bills={bills} history={history} analytics={analytics} />
        <BillDashboard
          bills={bills}
          addBill={addBill}
          pauseBill={pauseBill}
          deleteBill={deleteBill}
          publicKey={wallet.publicKey}
          signTransaction={wallet.signTransaction}
          pendingProposals={pendingProposals}
          proposalsAsApprover={proposalsAsApprover}
          multisigLoading={multisigLoading}
          multisigError={multisigError}
          createProposal={createProposal}
          approveProposal={approveProposal}
          rejectProposal={rejectProposal}
          executeProposal={executeProposalAndPay}
          voteHistory={voteHistory}
          clearVoteHistory={clearVoteHistory}
          paymentHistory={history}
        />
        <PaymentHistory history={history} clearHistory={clearHistory} />
      </main>

      {showFeedback && (
        <FeedbackForm onClose={() => setShowFeedback(false)} />
      )}

      {showTelegramSettings && (
        <TelegramSettings
          config={telegramConfig}
          onUpdate={updateTelegramConfig}
          onTest={testTelegramConnection}
          testStatus={testStatus}
          onClose={() => setShowTelegramSettings(false)}
        />
      )}
    </div>
  );
}

export default App;
