const cron = require('node-cron');
const { syncAttendanceData, getInterns, saveInterns, getConfig, saveConfig } = require('./kemnakerService');
const { sendWhatsAppMessage, formatMessage } = require('./whatsappService');
const { sendNightReminderEmails } = require('./emailService');
const { addLog } = require('./logService');

let activeCronTasks = [];

/**
 * Convert user config time & days to standard cron expression
 */
function buildCronExpression(timeStr = '15:30', activeDays = []) {
  const parts = timeStr.split(':');
  const minute = parseInt(parts[1] || '0', 10);
  const hour = parseInt(parts[0] || '15', 10);

  const dayMap = { Minggu: '0', Senin: '1', Selasa: '2', Rabu: '3', Kamis: '4', Jumat: '5', Sabtu: '6' };

  let dayExpr = '*';
  if (Array.isArray(activeDays) && activeDays.length > 0 && activeDays.length < 7) {
    const dayNumbers = activeDays
      .map((d) => (dayMap[d] !== undefined ? dayMap[d] : d))
      .filter((n) => !isNaN(n));
    if (dayNumbers.length > 0) dayExpr = dayNumbers.join(',');
  }

  return `${minute} ${hour} * * ${dayExpr}`;
}

/**
 * 0. 09:30 WIB - Sync pagi (tanpa notifikasi).
 * Tidak ada lagi "reset semua ke belum_absen": hari baru ditangani lewat
 * statusDate di mergeParticipants, sehingga kegagalan sync tidak menimbun
 * status palsu "belum absen".
 */
async function runMorningSyncCycle(isManual = false) {
  const triggerType = isManual ? 'manual' : 'otomatis (09:30 WIB)';
  await addLog('scheduler', 'info', `[JADWAL 09:30 WIB] Memulai sync presensi pagi (${triggerType})...`);

  try {
    const syncResult = await syncAttendanceData();
    const interns = syncResult.interns || [];
    const hadirCount = interns.filter((i) => i.statusAbsen === 'hadir').length;
    const belumCount = interns.filter((i) => i.statusAbsen === 'belum_absen').length;

    await addLog(
      'scheduler',
      'success',
      `[09:30 WIB] Sync selesai. ${hadirCount} sudah absen, ${belumCount} belum absen.`,
      `Peserta: ${interns.map((i) => `${i.nama} (${i.statusAbsen})`).join(', ')}`
    );
    return { success: true, hadirCount, belumCount, interns };
  } catch (err) {
    await addLog('scheduler', 'error', `Gagal siklus sync pagi 09:30 WIB: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * 1. 15:30 WIB - WhatsApp ke peserta yang masih belum absen (sync ulang dulu).
 */
async function runAfternoonReminderCycle(isManual = false) {
  const triggerType = isManual ? 'manual' : 'otomatis (15:30 WIB)';
  await addLog('scheduler', 'info', `[JADWAL 15:30 WIB] Memulai siklus reminder sore (${triggerType})...`);

  try {
    const syncResult = await syncAttendanceData();
    const interns = syncResult.interns;

    const config = await getConfig();
    const template = (config.whatsapp && config.whatsapp.template) || '';
    const deadline = (config.whatsapp && config.whatsapp.deadlineTime) || '24:00';

    const unclockedInterns = interns.filter((i) => i.statusAbsen === 'belum_absen');

    if (unclockedInterns.length === 0) {
      await addLog('reminder', 'info', '[15:30 WIB] Semua peserta sudah absen hari ini!');
      return { success: true, sentCount: 0, totalUnclocked: 0 };
    }

    let sentCount = 0;
    for (const intern of unclockedInterns) {
      const message = formatMessage(template, intern, deadline);
      const res = await sendWhatsAppMessage({ phone: intern.phone, message, internName: intern.nama });
      if (res.success) {
        sentCount++;
        intern.lastReminderSent = new Date().toISOString();
        intern.reminderCount = (intern.reminderCount || 0) + 1;
      }
    }

    await saveInterns(interns);
    config.scheduler = config.scheduler || {};
    config.scheduler.lastRunAfternoon = new Date().toISOString();
    await saveConfig(config);

    await addLog(
      'reminder',
      'success',
      `[15:30 WIB] Berhasil mengirim ${sentCount} reminder WhatsApp ke anak magang belum absen.`,
      `Peserta: ${unclockedInterns.map((i) => i.nama).join(', ')}`
    );
    return { success: true, sentCount, totalUnclocked: unclockedInterns.length };
  } catch (err) {
    await addLog('scheduler', 'error', `Gagal siklus 15:30 WIB: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * 2. 21:00 WIB - Email ke mentor & peserta yang belum absen.
 * Selalu memakai hasil sync segar; jika sync gagal/kosong -> TIDAK kirim email.
 */
async function runNightReminderCycle(isManual = false) {
  const triggerType = isManual ? 'manual' : 'otomatis (21:00 WIB)';
  await addLog('scheduler', 'info', `[JADWAL 21:00 WIB] Memulai pengecekan malam & pengiriman email (${triggerType})...`);

  try {
    const syncResult = await syncAttendanceData();
    const interns = syncResult.interns;

    const config = await getConfig();
    const unclockedInterns = interns.filter((i) => i.statusAbsen === 'belum_absen');

    if (unclockedInterns.length === 0) {
      await addLog('reminder', 'info', '[21:00 WIB] Semua anak magang sudah presensi sebelum batas 24:00!');
      return { success: true, totalUnclocked: 0, message: 'Semua sudah absen' };
    }

    const targetMentorEmail =
      process.env.MENTOR_EMAIL || (config.email && config.email.mentorEmail) || 'mentor.rekind@gmail.com';
    const emailRes = await sendNightReminderEmails({
      unclockedInterns,
      mentorEmail: targetMentorEmail,
      scheduleTime: '21:00'
    });

    config.scheduler = config.scheduler || {};
    config.scheduler.lastRunNight = new Date().toISOString();
    await saveConfig(config);

    await addLog(
      'reminder',
      'success',
      `[21:00 WIB] Peringatan malam selesai diproses. ${unclockedInterns.length} anak magang belum absen.`,
      `Laporan email dikirim ke Mentor & ${unclockedInterns.length} peserta magang.`
    );
    return { success: true, totalUnclocked: unclockedInterns.length, emailRes };
  } catch (err) {
    await addLog('scheduler', 'error', `Gagal siklus 21:00 WIB (email TIDAK dikirim): ${err.message}`);
    return { success: false, error: err.message };
  }
}

const CYCLES = {
  morning: runMorningSyncCycle,
  afternoon: runAfternoonReminderCycle,
  night: runNightReminderCycle
};

/**
 * Cron in-process (hanya untuk server lokal / VPS). Di Vercel dipicu lewat /api/cron/:job.
 */
async function initScheduler() {
  const config = await getConfig();
  const schedCfg = config.scheduler || {};

  activeCronTasks.forEach((t) => t.stop());
  activeCronTasks = [];

  if (!schedCfg.enabled) {
    await addLog('scheduler', 'info', 'Scheduler otomatis dalam status Nonaktif.');
    return false;
  }

  const activeDays = schedCfg.activeDays || ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
  const opts = { timezone: 'Asia/Jakarta' };

  [
    ['morning', schedCfg.time0 || '09:30'],
    ['afternoon', schedCfg.time1 || '15:30'],
    ['night', schedCfg.time2 || '21:00']
  ].forEach(([job, time]) => {
    activeCronTasks.push(
      cron.schedule(buildCronExpression(time, activeDays), () => CYCLES[job](false), opts)
    );
  });

  await addLog(
    'scheduler',
    'info',
    `Scheduler lokal aktif: [09:30 Sync], [15:30 WhatsApp] & [21:00 Email]. Hari: ${activeDays.join(', ')}`
  );
  return true;
}

module.exports = {
  initScheduler,
  runMorningSyncCycle,
  runAfternoonReminderCycle,
  runNightReminderCycle,
  CYCLES,
  buildCronExpression
};
