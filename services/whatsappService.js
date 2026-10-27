const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { addLog } = require('./logService');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'config.json');

function getConfig() {
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

/**
 * Normalize Indonesian phone number to international 628... format
 */
function normalizePhone(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.substring(1);
  } else if (cleaned.startsWith('+62')) {
    cleaned = cleaned.substring(1);
  } else if (!cleaned.startsWith('62')) {
    cleaned = '62' + cleaned;
  }
  return cleaned;
}

/**
 * Format message template with intern's data
 */
function formatMessage(template, intern, deadlineTime = '10:00') {
  const now = new Date();
  const dateFormatted = now.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  const timeFormatted = now.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit'
  });

  let message = template || 'Halo *{nama}*, mohon segera absen di Kemnaker MagangHub ({link_absen}) sebelum pukul {deadline} WIB.';
  message = message.replace(/{nama}/g, intern.nama || 'Peserta Magang');
  message = message.replace(/{tanggal}/g, dateFormatted);
  message = message.replace(/{jam}/g, timeFormatted);
  message = message.replace(/{posisi}/g, intern.posisi || 'Peserta Magang');
  message = message.replace(/{kampus}/g, intern.kampus || '-');
  message = message.replace(/{pembimbing}/g, intern.pembimbing || 'Mentor');
  message = message.replace(/{deadline}/g, deadlineTime || '10:00');
  message = message.replace(/{link_absen}/g, 'https://monev.maganghub.kemnaker.go.id/dashboard/peserta');

  return message;
}

/**
 * Generate Direct WhatsApp Click-to-Chat Link (wa.me)
 */
function getDirectWaLink(phone, message) {
  const normalized = normalizePhone(phone);
  if (!normalized) return '#';
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

/**
 * Send WhatsApp message using the active provider
 */
async function sendWhatsAppMessage({ phone, message, internName = 'Peserta' }) {
  const config = getConfig();
  const waConfig = config.whatsapp || {};
  const provider = waConfig.provider || 'simulation';
  const targetPhone = normalizePhone(phone);

  if (!targetPhone) {
    const errorMsg = `Nomor WhatsApp tidak valid untuk ${internName}: ${phone}`;
    addLog('reminder', 'error', errorMsg);
    return { success: false, error: errorMsg };
  }

  // 1. Simulation Mode (Safe for demo / testing without API cost)
  if (provider === 'simulation') {
    const directLink = getDirectWaLink(targetPhone, message);
    addLog(
      'reminder',
      'info',
      `[SIMULASI WA] Reminder terkirim ke ${internName} (${targetPhone})`,
      `Pesan:\n${message.substring(0, 120)}...`
    );
    return {
      success: true,
      provider: 'simulation',
      target: targetPhone,
      message,
      directLink,
      note: 'Simulasi pengiriman berhasil. Gunakan tombol link untuk membuka langsung di WhatsApp Web / App jika diinginkan.'
    };
  }

  // 2. Fonnte API Gateway
  if (provider === 'fonnte') {
    if (!waConfig.fonnteToken) {
      const errorMsg = 'Token Fonnte belum dikonfigurasi di Pengaturan.';
      addLog('reminder', 'error', errorMsg);
      return { success: false, error: errorMsg };
    }

    try {
      const response = await axios.post(
        'https://api.fonnte.com/send',
        {
          target: targetPhone,
          message: message,
          countryCode: '62'
        },
        {
          headers: {
            Authorization: waConfig.fonnteToken,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      if (response.data && response.data.status) {
        addLog(
          'reminder',
          'success',
          `[FONNTE WA] Berhasil kirim ke ${internName} (${targetPhone})`,
          JSON.stringify(response.data)
        );
        return { success: true, provider: 'fonnte', data: response.data };
      } else {
        const errDetail = response.data.reason || JSON.stringify(response.data);
        addLog('reminder', 'error', `[FONNTE WA Gagal] ke ${internName}: ${errDetail}`);
        return { success: false, error: errDetail };
      }
    } catch (err) {
      const errDetail = err.response ? JSON.stringify(err.response.data) : err.message;
      addLog('reminder', 'error', `[FONNTE WA Error] ke ${internName}: ${errDetail}`);
      return { success: false, error: errDetail };
    }
  }

  // 3. Wablas API Gateway
  if (provider === 'wablas') {
    if (!waConfig.wablasToken) {
      const errorMsg = 'Token Wablas belum dikonfigurasi di Pengaturan.';
      addLog('reminder', 'error', errorMsg);
      return { success: false, error: errorMsg };
    }

    const domain = waConfig.wablasDomain || 'https://phone.wablas.com';
    const endpoint = `${domain.replace(/\/+$/, '')}/api/send-message`;

    try {
      const response = await axios.post(
        endpoint,
        {
          phone: targetPhone,
          message: message
        },
        {
          headers: {
            Authorization: waConfig.wablasToken,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      if (response.data && (response.data.status === true || response.data.status === 'success')) {
        addLog(
          'reminder',
          'success',
          `[WABLAS WA] Berhasil kirim ke ${internName} (${targetPhone})`,
          JSON.stringify(response.data)
        );
        return { success: true, provider: 'wablas', data: response.data };
      } else {
        const errDetail = response.data.message || JSON.stringify(response.data);
        addLog('reminder', 'error', `[WABLAS WA Gagal] ke ${internName}: ${errDetail}`);
        return { success: false, error: errDetail };
      }
    } catch (err) {
      const errDetail = err.response ? JSON.stringify(err.response.data) : err.message;
      addLog('reminder', 'error', `[WABLAS WA Error] ke ${internName}: ${errDetail}`);
      return { success: false, error: errDetail };
    }
  }

  // 4. Custom Webhook
  if (provider === 'custom_webhook') {
    if (!waConfig.customWebhookUrl) {
      const errorMsg = 'URL Custom Webhook belum diisi.';
      addLog('reminder', 'error', errorMsg);
      return { success: false, error: errorMsg };
    }

    try {
      const response = await axios.post(
        waConfig.customWebhookUrl,
        {
          phone: targetPhone,
          message: message,
          name: internName,
          timestamp: new Date().toISOString()
        },
        { timeout: 15000 }
      );
      addLog('reminder', 'success', `[WEBHOOK WA] Terkirim ke ${internName} via Webhook`);
      return { success: true, provider: 'custom_webhook', data: response.data };
    } catch (err) {
      const errDetail = err.response ? JSON.stringify(err.response.data) : err.message;
      addLog('reminder', 'error', `[WEBHOOK WA Error] ke ${internName}: ${errDetail}`);
      return { success: false, error: errDetail };
    }
  }

  return { success: false, error: `Provider ${provider} tidak dikenal.` };
}

module.exports = {
  normalizePhone,
  formatMessage,
  getDirectWaLink,
  sendWhatsAppMessage
};
