import { useState } from 'react';

export default function TelegramSettings({
  config,
  onUpdate,
  onTest,
  testStatus,
  onClose,
}) {
  const [chatId, setChatId] = useState(config.chatId);

  // Called by useTelegram on auto-save after successful test
  const handleAutoSave = (savedId) => {
    onUpdate({ chatId: savedId, enabled: true });
  };

  const handleDisable = () => {
    onUpdate({ enabled: false });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📨 Telegram Notifications</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="telegram-setup-info">
          <div className="telegram-setup-columns">
            <div className="telegram-setup-steps">
              <p><strong>How to Set Up?</strong></p>
              <ol>
                <li>Scan the QR code or search <strong>@StellarAutopay_Bot</strong> on Telegram and press <strong>Start</strong>.</li>
                <li>Send any message to the bot (e.g. <code>/start</code>).</li>
                <li>Open the link below in your browser and copy the number from the <code>id</code> field:<br/>
                  <a
                    href="https://api.telegram.org/bot8713519999:AAE7lqqUVZmSMM3hU_0pCGg4aawp5JF6cSU/getUpdates"
                    target="_blank"
                    rel="noreferrer"
                    className="telegram-get-updates-link"
                  >
                    getUpdates →
                  </a>
                </li>
                <li>Paste the number into the <strong>Chat ID</strong> field below and click <strong>Test</strong>.</li>
              </ol>
            </div>
            <div className="telegram-qr-wrap">
              <img
                src="https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=https://t.me/StellarAutopay_Bot&margin=6"
                alt="@StellarAutopay_Bot QR"
                className="telegram-qr"
                width={130}
                height={130}
              />
              <span className="telegram-qr-label">@StellarAutopay_Bot</span>
            </div>
          </div>
        </div>

        <div className="form-group">
          <label>Chat ID</label>
          <input
            placeholder="e.g. 123456789"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
          />
        </div>

        {testStatus && (
          <div className={`test-status ${testStatus === 'success' ? 'test-success' : testStatus === 'sending' ? 'test-sending' : 'test-error'}`}>
            {testStatus === 'sending' && '⏳ Sending test message...'}
            {testStatus === 'success' && '✅ Test message sent — notifications enabled!'}
            {testStatus.startsWith('error') && `❌ ${testStatus}`}
          </div>
        )}

        {config.enabled && (
          <div className="test-status test-success" style={{ marginBottom: '0.5rem' }}>
            ✅ Notifications are enabled for Chat ID: {config.chatId}
          </div>
        )}

        <div className="telegram-actions">
          <button
            className="btn-primary"
            onClick={() => onTest(chatId.trim(), handleAutoSave)}
            disabled={!chatId.trim() || testStatus === 'sending'}
          >
            {testStatus === 'sending' ? '⏳ Testing…' : '🧪 Test & Enable'}
          </button>
        </div>

        {config.enabled && (
          <button className="btn-danger telegram-disable-btn" onClick={handleDisable}>
            Disable Notifications
          </button>
        )}
      </div>
    </div>
  );
}

