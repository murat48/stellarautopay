export default function WalletConnect({ onConnect, loading, error }) {
  return (
    <div className="wallet-connect">
      <div className="wallet-connect-card">
        <div className="logo">
          <span className="logo-icon">✦</span>
          <h1>Stellar Autopay</h1>
        </div>
        <p className="subtitle">Automated recurring payments on Stellar Testnet</p>

        <button
          className="connect-wallet-btn"
          onClick={onConnect}
          disabled={loading}
        >
          {loading ? 'Connecting...' : '🔗 Connect Wallet'}
        </button>

        {error && <div className="error-msg">{error}</div>}

        <div className="autopay-info">
          <p className="info-title">🔐 How it works</p>
          <ul>
            <li>Connect your Stellar wallet (Freighter, xBull, Lobstr, Albedo)</li>
            <li>Enable Auto-Pay — a <strong>temporary session key</strong> is added as a signer to your account</li>
            <li>Session key signs payments automatically — your main key stays safe in your wallet</li>
            <li>Disable Auto-Pay or disconnect any time — session key is revoked instantly</li>
          </ul>
        </div>

        <p className="hint">
          Need a testnet account?{' '}
          <a href="https://laboratory.stellar.org/#account-creator?network=test" target="_blank" rel="noreferrer">
            Create one here
          </a>
        </p>
      </div>
    </div>
  );
}
