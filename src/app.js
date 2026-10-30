const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const {
  performBrowserLogin,
  syncAttendanceData,
  getInterns,
  saveInterns,
  getConfig,
  saveConfig
} = require('./services/kemnakerService');
const { formatMessage, getDirectWaLink, sendWhatsAppMessage } = require('./services/whatsappService');
const { CYCLES, runAfternoonReminderCycle, buildCronExpression } = require('./services/schedulerService');
const { getLogs, addLog, clearLogs } = require('./services/logService');

const app = express();
app.use(cors());
app.use(express.json());

const safeEqual = (a = '', b = '') => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ----------------- CRON ENDPOINT (dipanggil GitHub Actions / Vercel Cron) -----------------
// Auth: Authorization: Bearer <CRON_SECRET>  (Vercel Cron mengirim header ini otomatis)
app.all('/api/cron/:job', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!secret || !safeEqual(bearer, secret)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const cycle = CYCLES[req.params.job];
  if (!cycle) {
    return res.status(404).json({ success: false, error: 'Job tidak dikenal (morning | afternoon | night)' });
  }

  const config = await getConfig();
  if (config.scheduler && config.scheduler.enabled === false) {
    return res.json({ success: true, skipped: 'scheduler nonaktif' });
  }

  const result = await cycle(false);
  res.status(result.success ? 200 : 500).json({ ...result, interns: undefined });
});

// ----------------- ADMIN AUTH (Basic Auth, aktif jika ADMIN_PASSWORD diset) -----------------
app.use('/api', (req, res, next) => {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return next();

  const header = req.headers.authorization || '';
  const decoded = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString() : '';
  const supplied = decoded.slice(decoded.indexOf(':') + 1);
  if (decoded && safeEqual(supplied, password)) return next();

  res.set('WWW-Authenticate', 'Basic realm="Kemnaker Reminder"');
  res.status(401).json({ success: false, error: 'Unauthorized' });
});

// ----------------- API ENDPOINTS -----------------

app.get('/api/status', wrap(async (req, res) => {
  const config = await getConfig();
  const interns = await getInterns();
  const sched = config.scheduler || {};
  const kem = config.kemnaker || {};
  const wa = config.whatsapp || {};

  res.json({
    success: true,
    data: {
      serverTime: new Date().toISOString(),
      stats: {
        total: interns.length,
        hadir: interns.filter((i) => i.statusAbsen === 'hadir').length,
        belumAbsen: interns.filter((i) => i.statusAbsen === 'belum_absen').length,
        izinSakit: interns.filter((i) => ['izin', 'sakit'].includes(i.statusAbsen)).length
      },
      kemnaker: {
        authenticated: kem.syncStatus === 'authenticated',
        lastSync: kem.lastSync || null,
        syncStatus: kem.syncStatus || 'idle',
        targetUrl: kem.targetUrl || 'https://monev.maganghub.kemnaker.go.id/dashboard/peserta'
      },
      whatsapp: {
        provider: wa.provider || 'simulation',
        hasFonnteToken: !!(wa.fonnteToken || process.env.FONNTE_TOKEN),
        hasWablasToken: !!wa.wablasToken,
        deadlineTime: wa.deadlineTime || '24:00'
      },
      scheduler: {
        enabled: sched.enabled !== undefined ? sched.enabled : true,
        time: sched.time || '15:30',
        activeDays: sched.activeDays || ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'],
        cronExpr: buildCronExpression(sched.time || '15:30', sched.activeDays || []),
        lastRun: sched.lastRunNight || sched.lastRunAfternoon || null
      }
    }
  });
}));

app.get('/api/interns', wrap(async (req, res) => {
  const interns = await getInterns();
  const config = await getConfig();
  const template = (config.whatsapp && config.whatsapp.template) || '';
  const deadline = (config.whatsapp && config.whatsapp.deadlineTime) || '24:00';

  const enriched = interns.map((item) => {
    const previewMessage = formatMessage(template, item, deadline);
    return { ...item, previewMessage, directWaLink: getDirectWaLink(item.phone, previewMessage) };
  });
  res.json({ success: true, data: enriched });
}));

app.put('/api/interns/:id', wrap(async (req, res) => {
  const { id } = req.params;
  const { phone, email, nama, pembimbing, statusAbsen, keterangan } = req.body;
  const interns = await getInterns();

  const idx = interns.findIndex((i) => i.id === id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Peserta tidak ditemukan' });

  if (phone !== undefined) interns[idx].phone = phone;
  if (email !== undefined) interns[idx].email = email;
  if (nama !== undefined) interns[idx].nama = nama;
  if (pembimbing !== undefined) interns[idx].pembimbing = pembimbing;
  if (statusAbsen !== undefined) {
    interns[idx].statusAbsen = statusAbsen;
    if (statusAbsen === 'hadir' && (!interns[idx].jamAbsen || interns[idx].jamAbsen === '-')) {
      interns[idx].jamAbsen =
        new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }) + ' WIB';
    }
  }
  if (keterangan !== undefined) interns[idx].keterangan = keterangan;

  await saveInterns(interns);
  await addLog('sync', 'info', `Data peserta ${interns[idx].nama} (${id}) berhasil diperbarui.`);
  res.json({ success: true, data: interns[idx] });
}));

app.post('/api/kemnaker/login', wrap(async (req, res) => {
  const { email, password, headless } = req.body;
  const config = await getConfig();
  config.kemnaker = config.kemnaker || {};
  if (email) config.kemnaker.email = email;
  if (password) config.kemnaker.password = password;
  if (headless !== undefined) config.kemnaker.headless = headless;
  await saveConfig(config);

  const result = await performBrowserLogin({ email, password, headless });
  res.json({ success: true, result });
}));

app.post('/api/kemnaker/sync', wrap(async (req, res) => {
  const result = await syncAttendanceData();
  res.json({ success: true, result });
}));

app.post('/api/kemnaker/set-token', wrap(async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, error: 'Token wajib diisi' });

  const config = await getConfig();
  config.kemnaker = config.kemnaker || {};
  config.kemnaker.bearerToken = token.trim().replace(/^Bearer\s+/i, '');
  config.kemnaker.syncStatus = 'authenticated';
  await saveConfig(config);

  await addLog('auth', 'success', 'Bearer Token Monev Kemnaker berhasil diperbarui secara manual.');
  res.json({ success: true, message: 'Token berhasil disimpan' });
}));

app.post('/api/reminder/trigger-all', wrap(async (req, res) => {
  res.json(await runAfternoonReminderCycle(true));
}));

app.post('/api/reminder/send-single', wrap(async (req, res) => {
  const { internId } = req.body;
  const interns = await getInterns();
  const config = await getConfig();
  const template = (config.whatsapp && config.whatsapp.template) || '';
  const deadline = (config.whatsapp && config.whatsapp.deadlineTime) || '24:00';

  const intern = interns.find((i) => i.id === internId);
  if (!intern) return res.status(404).json({ success: false, error: 'Peserta tidak ditemukan' });

  const result = await sendWhatsAppMessage({
    phone: intern.phone,
    message: formatMessage(template, intern, deadline),
    internName: intern.nama
  });

  if (result.success) {
    intern.lastReminderSent = new Date().toISOString();
    intern.reminderCount = (intern.reminderCount || 0) + 1;
    await saveInterns(interns);
  }
  res.json({ success: result.success, result, intern });
}));

app.post('/api/reminder/test-wa', wrap(async (req, res) => {
  const config = await getConfig();
  const targetPhone = req.body.phone || (config.whatsapp && config.whatsapp.adminTestPhone) || '081234567890';
  const sampleMessage = `🔔 *TES NOTIFIKASI MAGANG KEMNAKER*\n\nHalo Admin, sistem otomatisasi reminder presensi peserta magang Kemnaker aktif dan berjalan dengan baik!\n\nWaktu server: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`;

  const result = await sendWhatsAppMessage({ phone: targetPhone, message: sampleMessage, internName: 'Admin / Penguji' });
  res.json({ success: result.success, result, targetPhone });
}));

app.get('/api/config', wrap(async (req, res) => {
  res.json({ success: true, data: await getConfig() });
}));

app.post('/api/config', wrap(async (req, res) => {
  await saveConfig(req.body);
  await addLog('config', 'info', 'Pengaturan sistem berhasil diperbarui.');
  res.json({ success: true, message: 'Pengaturan berhasil disimpan' });
}));

app.get('/api/logs', wrap(async (req, res) => {
  res.json({ success: true, data: await getLogs() });
}));

app.delete('/api/logs', wrap(async (req, res) => {
  await clearLogs();
  res.json({ success: true, message: 'Log berhasil dibersihkan' });
}));

// Dashboard statis (dipakai lokal maupun Vercel)
app.use(express.static(path.join(__dirname, '..', 'public')));

module.exports = app;
