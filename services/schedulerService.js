const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
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

  const dayMap = {
    Minggu: '0',
    Senin: '1',
    Selasa: '2',
    Rabu: '3',
    Kamis: '4',
    Jumat: '5',
    Sabtu: '6'
  };

  let dayExpr = '*';
  if (Array.isArray(activeDays) && activeDays.length > 0 && activeDays.length < 7) {
    const dayNumbers = activeDays
      .map((d) => (dayMap[d] !== undefined ? dayMap[d] : d))
      .filter((n) => !isNaN(n));
    if (dayNumbers.length > 0) {
      dayExpr = dayNumbers.join(',');
    }
  }

  return `${minute} ${hour} * * ${dayExpr}`;
}

/**
 * 0. Cycle 0: 09:30 WIB (Morning Reset & Sync - no notifications)
 */
async function runMorningSyncCycle(isManual = false) {
  const triggerType = isManual ? 'manual' : 'otomatis (09:30 WIB)';
  addLog('scheduler', 'info', `[JADWAL 09:30 WIB] Memulai reset status harian & sync presensi (${triggerType})...`);

  try {
    // Reset semua status ke belum_absen dulu sebelum sync
    const existingInterns = getInterns();
    if (existingInterns.length > 0) {
      const resetInterns = existingInterns.map(i => ({
        ...i,
        statusAbsen: 'belum_absen',
        jamAbsen: '-',
        keterangan: 'Perlu dipantau: Peserta belum mengisi kehadiran hari ini',
        lastReminderSent: null,
        reminderCount: 0
      }));
      saveInterns(resetInterns);
      addLog('scheduler', 'info', `[09:30 WIB] Reset status ${resetInterns.length} peserta ke belum_absen.`);
    }

    // Sync data terbaru dari Kemnaker
    const syncResult = await syncAttendanceData();

    const hadirCount = (syncResult.interns || []).filter(i => i.statusAbsen === 'hadir').length;
    const belumCount = (syncResult.interns || []).filter(i => i.statusAbsen === 'belum_absen').length;

    addLog(
      'scheduler',
      'success',
      `[09:30 WIB] Sync selesai. ${hadirCount} sudah absen, ${belumCount} belum absen.`,
      `Peserta: ${(syncResult.interns || []).map(i => `${i.nama} (${i.statusAbsen})`).join(', ')}`
    );

    return { success: true, hadirCount, belumCount, interns: syncResult.interns };
  } catch (err) {
    addLog('scheduler', 'error', `Gagal siklus sync pagi 09:30 WIB: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * 1. Cycle 1: 15:30 WIB (WhatsApp Reminder)
 */
async function runAfternoonReminderCycle(isManual = false) {
  const triggerType = isManual ? 'manual' : 'otomatis (15:30 WIB)';
  addLog('scheduler', 'info', `[JADWAL 15:30 WIB] Memulai siklus reminder sore (${triggerType})...`);

  try {
    await syncAttendanceData();

    const config = getConfig();
    const interns = getInterns();
    const template = (config.whatsapp && config.whatsapp.template) || '';
    const deadline = (config.whatsapp && config.whatsapp.deadlineTime) || '24:00';

    const unclockedInterns = interns.filter((i) => i.statusAbsen === 'belum_absen');

    if (unclockedInterns.length === 0) {
      addLog('reminder', 'info', '[15:30 WIB] Semua peserta sudah absen hari ini!');
      return { success: true, sentCount: 0, totalUnclocked: 0 };
    }

    let sentCount = 0;
    for (const intern of unclockedInterns) {
      const message = formatMessage(template, intern, deadline);
      const res = await sendWhatsAppMessage({
        phone: intern.phone,
        message,
        internName: intern.nama
      });

      if (res.success) {
        sentCount++;
        intern.lastReminderSent = new Date().toISOString();
        intern.reminderCount = (intern.reminderCount || 0) + 1;
      }
    }

    saveInterns(interns);
    config.scheduler.lastRunAfternoon = new Date().toISOString();
    saveConfig(config);

    addLog(
      'reminder',
      'success',
      `[15:30 WIB] Berhasil mengirim ${sentCount} reminder WhatsApp ke anak magang belum absen.`,
      `Peserta: ${unclockedInterns.map((i) => i.nama).join(', ')}`
    );

    return { success: true, sentCount, totalUnclocked: unclockedInterns.length };
  } catch (err) {
    addLog('scheduler', 'error', `Gagal siklus 15:30 WIB: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * 2. Cycle 2: 21:00 WIB (Night Alert - Email to Mentor & Interns)
 */
async function runNightReminderCycle(isManual = false) {
  const triggerType = isManual ? 'manual' : 'otomatis (21:00 WIB)';
  addLog('scheduler', 'info', `[JADWAL 21:00 WIB] Memulai pengecekan malam & pengiriman email (${triggerType})...`);

  try {
    await syncAttendanceData();

    const config = getConfig();
    const interns = getInterns();
    const unclockedInterns = interns.filter((i) => i.statusAbsen === 'belum_absen');

    if (unclockedInterns.length === 0) {
      addLog('reminder', 'info', '[21:00 WIB] Semua anak magang sudah presensi sebelum batas 24:00!');
      return { success: true, totalUnclocked: 0, message: 'Semua sudah absen' };
    }

    // Send Email to Mentor and Interns
    const targetMentorEmail = process.env.MENTOR_EMAIL || (config.email && config.email.mentorEmail) || 'mentor.rekind@gmail.com';
    const emailRes = await sendNightReminderEmails({
      unclockedInterns,
      mentorEmail: targetMentorEmail,
      scheduleTime: '21:00'
    });

    config.scheduler.lastRunNight = new Date().toISOString();
    saveConfig(config);

    addLog(
      'reminder',
      'success',
      `[21:00 WIB] Peringatan malam selesai diproses. ${unclockedInterns.length} anak magang belum absen.`,
      `Laporan email dikirim ke Mentor & ${unclockedInterns.length} peserta magang.`
    );

    return {
      success: true,
      totalUnclocked: unclockedInterns.length,
      emailRes
    };
  } catch (err) {
    addLog('scheduler', 'error', `Gagal siklus 21:00 WIB: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Initialize dual cron jobs: 15:30 WIB & 21:00 WIB
 */
function initScheduler() {
  const config = getConfig();
  const schedCfg = config.scheduler || {};

  // Clear existing cron tasks
  activeCronTasks.forEach(t => t.stop());
  activeCronTasks = [];

  if (!schedCfg.enabled) {
    addLog('scheduler', 'info', 'Scheduler otomatis dalam status Nonaktif.');
    return false;
  }

  const activeDays = schedCfg.activeDays || ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];

  // Cron 0: 09:30 WIB (Morning Sync - Reset & Fetch)
  const cron0930 = buildCronExpression(schedCfg.time0 || '09:30', activeDays);
  const task0 = cron.schedule(cron0930, async () => {
    addLog('scheduler', 'info', 'Waktu 09:30 WIB tercapai. Reset status harian & sync presensi dari Kemnaker...');
    await runMorningSyncCycle(false);
  });
  activeCronTasks.push(task0);

  // Cron 1: 15:30 WIB (WhatsApp Blast)
  const cron1530 = buildCronExpression(schedCfg.time1 || '15:30', activeDays);
  const task1 = cron.schedule(cron1530, async () => {
    addLog('scheduler', 'info', 'Waktu 15:30 WIB tercapai. Menjalankan penarikan presensi & reminder WhatsApp...');
    await runAfternoonReminderCycle(false);
  });
  activeCronTasks.push(task1);

  // Cron 2: 21:00 WIB (Night Email to Mentor & Interns)
  const cron2100 = buildCronExpression(schedCfg.time2 || '21:00', activeDays);
  const task2 = cron.schedule(cron2100, async () => {
    addLog('scheduler', 'info', 'Waktu 21:00 WIB tercapai. Menjalankan penarikan presensi & kirim Email ke Mentor + Magang...');
    await runNightReminderCycle(false);
  });
  activeCronTasks.push(task2);

  addLog(
    'scheduler',
    'info',
    `Scheduler otomatis aktif untuk 3x pengecekan: [09:30 WIB (Sync)], [15:30 WIB (WhatsApp)] & [21:00 WIB (Email Mentor & Magang)]. Hari: ${activeDays.join(', ')}`
  );

  return true;
}

module.exports = {
  initScheduler,
  runMorningSyncCycle,
  runAfternoonReminderCycle,
  runNightReminderCycle,
  buildCronExpression
};
