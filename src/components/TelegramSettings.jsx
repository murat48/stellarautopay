import { useState } from 'react';

export default function TelegramSettings({
  config,
  onUpdate,
  onTest,
  testStatus,
  onClose,
}) {
  const [form, setForm] = useState({
    botToken: config.botToken,
    chatId: config.chatId,
  });

  const handleSave = () => {
    onUpdate({
      botToken: form.botToken.trim(),
      chatId: form.chatId.trim(),
      enabled: !!(form.botToken.trim() && form.chatId.trim()),
    });
    onClose();
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
          <p><strong>Setup Instructions:</strong></p>
          <ol>
            <li>Open Telegram, search for <strong>@BotFather</strong></li>
            <li>Send <code>/newbot</code> and follow the prompts</li>
            <li>Copy the <strong>Bot Token</strong> you receive</li>
            <li>Start a chat with your new bot, then visit:<br/>
              <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code><br/>
              to find your <strong>Chat ID</strong></li>
          </ol>
        </div>

        <div className="form-group">
          <label>Bot Token</label>
          <input
            type="password"
            placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
            value={form.botToken}
            onChange={(e) => setForm((prev) => ({ ...prev, botToken: e.target.value }))}
          />
        </div>

        <div className="form-group">
          <label>Chat ID</label>
          <input
            placeholder="e.g. 123456789"
            value={form.chatId}
            onChange={(e) => setForm((prev) => ({ ...prev, chatId: e.target.value }))}
          />
        </div>

        {testStatus && (
          <div className={`test-status ${testStatus === 'success' ? 'test-success' : testStatus === 'sending' ? 'test-sending' : 'test-error'}`}>
            {testStatus === 'sending' && '⏳ Sending test message...'}
            {testStatus === 'success' && '✅ Test message sent! Check your Telegram.'}
            {testStatus.startsWith('error') && `❌ ${testStatus}`}
          </div>
        )}

        <div className="telegram-actions">
          <button
            className="btn-secondary"
            onClick={onTest}
            disabled={!form.botToken.trim() || !form.chatId.trim() || testStatus === 'sending'}
          >
            🧪 Test Connection
          </button>
          <button className="btn-primary" onClick={handleSave}>
            💾 Save & Enable
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
