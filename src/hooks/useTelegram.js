import { useState, useEffect, useCallback } from 'react';

// Bot token is managed centrally — users only need to provide their Chat ID.
const BOT_TOKEN = '8713519999:AAE7lqqUVZmSMM3hU_0pCGg4aawp5JF6cSU';
const STORAGE_KEY = 'stellar_autopay_telegram';

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { chatId: '', enabled: false };
    const parsed = JSON.parse(raw);
    // Strip any legacy botToken that may have been stored previously
    return { chatId: parsed.chatId || '', enabled: parsed.enabled || false };
  } catch {
    return { chatId: '', enabled: false };
  }
}

function saveConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ chatId: config.chatId, enabled: config.enabled }));
}

export default function useTelegram() {
  const [config, setConfig] = useState(() => loadConfig());
  const [testStatus, setTestStatus] = useState(null);

  useEffect(() => {
    saveConfig(config);
  }, [config]);

  const updateConfig = useCallback((updates) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  const sendMessage = useCallback(async (text) => {
    if (!config.enabled || !config.chatId) return;

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.description || 'Telegram API error');
    }

    return resp.json();
  }, [config]);

  const testConnection = useCallback(async () => {
    setTestStatus('sending');
    try {
      await sendMessage('✅ *Stellar Autopay* bağlantısı başarılı!\n\nÖdeme bildirimleriniz bu sohbete gelecektir.');
      setTestStatus('success');
      setTimeout(() => setTestStatus(null), 3000);
    } catch (err) {
      setTestStatus('error: ' + (err.message || 'Failed'));
      setTimeout(() => setTestStatus(null), 5000);
    }
  }, [sendMessage]);

  return {
    telegramConfig: config,
    updateTelegramConfig: updateConfig,
    sendTelegramMessage: config.enabled ? sendMessage : null,
    testTelegramConnection: testConnection,
    testStatus,
  };
}
