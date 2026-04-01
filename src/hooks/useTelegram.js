import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'stellar_autopay_telegram';

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { botToken: '', chatId: '', enabled: false };
  } catch {
    return { botToken: '', chatId: '', enabled: false };
  }
}

function saveConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
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
    if (!config.enabled || !config.botToken || !config.chatId) return;

    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
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
      await sendMessage('✅ *Stellar Autopay* connected successfully!\n\nYou will receive payment notifications here.');
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
