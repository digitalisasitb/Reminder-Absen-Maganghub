const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const {
  performBrowserLogin,
  syncAttendanceData,
  getInterns,
  saveInterns,
  getConfig,
  saveConfig,
  getSession
} = require('./services/kemnakerService');

const {
  formatMessage,
  getDirectWaLink,
  sendWhatsAppMessage,
  normalizePhone
} = require('./services/whatsappService');

const {
  initScheduler,
  runReminderCycle,
  buildCronExpression
} = require('./services/schedulerService');

const { getLogs, addLog, clearLogs } = require('./services/logService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ----------------- API ENDPOINTS -----------------

/**
 * 1. GET /api/status - Overview stats and engine health
 */
app.get('/api/status', (req, res) => {
  try {
    const config = getConfig();
    const session = getSession();
    const interns = getInterns();

    const total = interns.length;
    const hadir = interns.filter((i) => i.statusAbsen === 'hadir').length;
    const belumAbsen = interns.filter((i) => i.statusAbsen === 'belum_absen').length;
    const izinSakit = interns.filter((i) => ['izin', 'sakit'].includes(i.statusAbsen)).length;

    res.json({
      success: true,
      data: {
        serverTime: new Date().toISOString(),
        stats: { total, hadir, belumAbsen, izinSakit },
        kemnaker: {
          authenticated: !!(session && (session.bearerToken || (session.cookies && session.cookies.length > 0))),
          lastSync: config.kemnaker ? config.kemnaker.lastSync : null,
          syncStatus: config.kemnaker ? config.kemnaker.syncStatus : 'idle',
          targetUrl: config.kemnaker ? config.kemnaker.targetUrl : 'https://monev.maganghub.kemnaker.go.id/dashboard/peserta'
        },
        whatsapp: {
          provider: config.whatsapp ? config.whatsapp.provider : 'simulation',
          hasFonnteToken: !!(config.whatsapp && config.whatsapp.fonnteToken),
          hasWablasToken: !!(config.whatsapp && config.whatsapp.wablasToken),
          deadlineTime: config.whatsapp ? config.whatsapp.deadlineTime : '10:00'
        },
        scheduler: {
          enabled: config.scheduler ? config.scheduler.enabled : true,
          time: config.scheduler ? config.scheduler.time : '09:00',
          activeDays: config.scheduler ? config.scheduler.activeDays : ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'],
          cronExpr: buildCronExpression(config.scheduler ? config.scheduler.time : '09:00', config.scheduler ? config.scheduler.activeDays : []),
          lastRun: config.scheduler ? config.scheduler.lastRun : null
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 2. GET /api/interns - List all interns with WA direct links
 */
app.get('/api/interns', (req, res) => {
  try {
    const interns = getInterns();
    const config = getConfig();
    const template = (config.whatsapp && config.whatsapp.template) || '';
    const deadline = (config.whatsapp && config.whatsapp.deadlineTime) || '10:00';

    const enriched = interns.map((item) => {
      const formattedMsg = formatMessage(template, item, deadline);
      return {
        ...item,
        previewMessage: formattedMsg,
        directWaLink: getDirectWaLink(item.phone, formattedMsg)
      };
    });

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 3. PUT /api/interns/:id - Update intern details (phone, mentor, status)
 */
app.put('/api/interns/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { phone, nama, pembimbing, statusAbsen, keterangan } = req.body;
    const interns = getInterns();

    const idx = interns.findIndex((i) => i.id === id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: 'Peserta tidak ditemukan' });
    }

    if (phone !== undefined) interns[idx].phone = phone;
    if (nama !== undefined) interns[idx].nama = nama;
    if (pembimbing !== undefined) interns[idx].pembimbing = pembimbing;
    if (statusAbsen !== undefined) {
      interns[idx].statusAbsen = statusAbsen;
      if (statusAbsen === 'hadir' && (!interns[idx].jamAbsen || interns[idx].jamAbsen === '-')) {
        const now = new Date();
        interns[idx].jamAbsen = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
      }
    }
    if (keterangan !== undefined) interns[idx].keterangan = keterangan;

    saveInterns(interns);
    addLog('sync', 'info', `Data peserta ${interns[idx].nama} (${id}) berhasil diperbarui.`);

    res.json({ success: true, data: interns[idx] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 4. POST /api/kemnaker/login - Trigger automated browser login
 */
app.post('/api/kemnaker/login', async (req, res) => {
  try {
    const { email, password, headless } = req.body;
    const config = getConfig();

    if (email) config.kemnaker.email = email;
    if (password) config.kemnaker.password = password;
    if (headless !== undefined) config.kemnaker.headless = headless;
    saveConfig(config);

    const result = await performBrowserLogin({ email, password, headless });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 5. POST /api/kemnaker/sync - Trigger sync attendance
 */
app.post('/api/kemnaker/sync', async (req, res) => {
  try {
    const result = await syncAttendanceData();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 6. POST /api/kemnaker/set-token - Save direct Bearer Token
 */
app.post('/api/kemnaker/set-token', (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Token wajib diisi' });
    }
    const config = getConfig();
    config.kemnaker.bearerToken = token.trim().replace(/^Bearer\s+/i, '');
    config.kemnaker.syncStatus = 'authenticated';
    saveConfig(config);

    addLog('auth', 'success', 'Bearer Token Monev Kemnaker berhasil diperbarui secara manual.');
    res.json({ success: true, message: 'Token berhasil disimpan' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 7. POST /api/reminder/trigger-all - Trigger reminder to all unclocked interns
 */
app.post('/api/reminder/trigger-all', async (req, res) => {
  try {
    const result = await runReminderCycle(true);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 8. POST /api/reminder/send-single - Send reminder to a specific intern
 */
app.post('/api/reminder/send-single', async (req, res) => {
  try {
    const { internId } = req.body;
    const interns = getInterns();
    const config = getConfig();
    const template = (config.whatsapp && config.whatsapp.template) || '';
    const deadline = (config.whatsapp && config.whatsapp.deadlineTime) || '10:00';

    const intern = interns.find((i) => i.id === internId);
    if (!intern) {
      return res.status(404).json({ success: false, error: 'Peserta tidak ditemukan' });
    }

    const message = formatMessage(template, intern, deadline);
    const result = await sendWhatsAppMessage({
      phone: intern.phone,
      message,
      internName: intern.nama
    });

    if (result.success) {
      intern.lastReminderSent = new Date().toISOString();
      intern.reminderCount = (intern.reminderCount || 0) + 1;
      saveInterns(interns);
    }

    res.json({ success: result.success, result, intern });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 9. POST /api/reminder/test-wa - Send test message to admin number
 */
app.post('/api/reminder/test-wa', async (req, res) => {
  try {
    const { phone } = req.body;
    const config = getConfig();
    const targetPhone = phone || (config.whatsapp && config.whatsapp.adminTestPhone) || '081234567890';

    const sampleMessage = `🔔 *TES NOTIFIKASI MAGANG KEMNAKER*\n\nHalo Admin, sistem otomatisasi reminder presensi peserta magang Kemnaker aktif dan berjalan dengan baik!\n\nWaktu server: ${new Date().toLocaleString('id-ID')}`;

    const result = await sendWhatsAppMessage({
      phone: targetPhone,
      message: sampleMessage,
      internName: 'Admin / Penguji'
    });

    res.json({ success: result.success, result, targetPhone });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 10. GET /api/config & POST /api/config - Read & update system configuration
 */
app.get('/api/config', (req, res) => {
  try {
    const config = getConfig();
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/config', (req, res) => {
  try {
    const newConfig = req.body;
    saveConfig(newConfig);

    // Re-initialize scheduler with new timing
    initScheduler();

    addLog('config', 'info', 'Pengaturan sistem berhasil diperbarui.');
    res.json({ success: true, message: 'Pengaturan berhasil disimpan' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 11. GET /api/logs & DELETE /api/logs
 */
app.get('/api/logs', (req, res) => {
  try {
    const logs = getLogs();
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/logs', (req, res) => {
  try {
    clearLogs();
    res.json({ success: true, message: 'Log berhasil dibersihkan' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start Express server and initialize background cron scheduler
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Kemnaker Magang Reminder Web Server running!`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log(`====================================================`);

  initScheduler();
});
