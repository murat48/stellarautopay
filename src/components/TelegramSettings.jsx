import { useState } from 'react';

export default function TelegramSettings({
  config,
  onUpdate,
  onTest,
  testStatus,
  onClose,
}) {
  const [chatId, setChatId] = useState(config.chatId);

  const handleSave = () => {
    onUpdate({
      chatId: chatId.trim(),
      enabled: !!chatId.trim(),
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
          <h2>📨 Telegram Bildirimleri</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="telegram-setup-info">
          <p><strong>Nasıl Kurulur?</strong></p>
          <ol>
            <li>Telegram'da <strong>@StellarAutopayBot</strong> adresine gidin ve <strong>Start</strong> tuşuna basın.</li>
            <li>Bota herhangi bir mesaj gönderin (örn. <code>/start</code>).</li>
            <li>Aşağıdaki linki tarayıcınızda açın ve <code>id</code> alanındaki numarayı kopyalayın:<br/>
              <code>https://api.telegram.org/bot8713519999:AAE7lqqUVZmSMM3hU_0pCGg4aawp5JF6cSU/getUpdates</code>
            </li>
            <li>Kopyaladığınız numarayı aşağıdaki <strong>Chat ID</strong> alanına yapıştırın.</li>
          </ol>
        </div>

        <div className="form-group">
          <label>Chat ID</label>
          <input
            placeholder="örn. 123456789"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
          />
        </div>

        {testStatus && (
          <div className={`test-status ${testStatus === 'success' ? 'test-success' : testStatus === 'sending' ? 'test-sending' : 'test-error'}`}>
            {testStatus === 'sending' && '⏳ Test mesajı gönderiliyor...'}
            {testStatus === 'success' && '✅ Test mesajı gönderildi! Telegram\'ınızı kontrol edin.'}
            {testStatus.startsWith('error') && `❌ ${testStatus}`}
          </div>
        )}

        <div className="telegram-actions">
          <button
            className="btn-secondary"
            onClick={onTest}
            disabled={!chatId.trim() || testStatus === 'sending'}
          >
            🧪 Bağlantıyı Test Et
          </button>
          <button className="btn-primary" onClick={handleSave}>
            💾 Kaydet &amp; Etkinleştir
          </button>
        </div>

        {config.enabled && (
          <button className="btn-danger telegram-disable-btn" onClick={handleDisable}>
            Bildirimleri Devre Dışı Bırak
          </button>
        )}
      </div>
    </div>
  );
}

