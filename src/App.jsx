import './App.css';
import { useState, useEffect } from 'react';
import useWallet from './hooks/useWallet';
import useBills from './hooks/useBills';
import usePaymentHistory from './hooks/usePaymentHistory';
import usePaymentEngine from './hooks/usePaymentEngine';
import useTelegram from './hooks/useTelegram';
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
  // Load on-chain history when wallet connects; clear it on disconnect
  useEffect(() => {
    if (wallet.publicKey) {
      loadHistory(wallet.publicKey);
    } else {
      clearHistory();
    }
  }, [wallet.publicKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    telegramConfig,
    updateTelegramConfig,
    sendTelegramMessage,
    testTelegramConnection,
    testStatus,
  } = useTelegram();
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
    sendTelegramMessage,
    wallet.walletSignAndSubmit,
    wallet.signTransaction
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
              <span className="balance">{(wallet.balances.XLM || 0).toFixed(2)} XLM</span>
              {wallet.balances.USDC !== undefined && (
                <span className="balance">{wallet.balances.USDC.toFixed(2)} USDC</span>
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
        <MetricsStrip bills={bills} history={history} />
        <BillDashboard
          bills={bills}
          addBill={addBill}
          pauseBill={pauseBill}
          deleteBill={deleteBill}
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
