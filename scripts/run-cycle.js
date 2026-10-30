/**
 * Runner untuk GitHub Actions & CLI lokal:
 *   node scripts/run-cycle.js --job=morning
 *   node scripts/run-cycle.js --job=afternoon
 *   node scripts/run-cycle.js --job=night
 */
require('dotenv').config();
const axios = require('axios');
const { CYCLES } = require('../src/services/schedulerService');
const { getInterns, getConfig } = require('../src/services/kemnakerService');
const { getLogs } = require('../src/services/logService');

async function notifyVercelDashboard(job, res) {
  const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
  const secret = process.env.CRON_SECRET;
  if (!appUrl || !secret) {
    console.log('[Runner] APP_URL atau CRON_SECRET tidak diset, melewati update dashboard via webhook.');
    return;
  }

  try {
    console.log(`[Runner] Mengirim update data ke Dashboard Vercel: ${appUrl}/api/sync/webhook...`);
    const interns = await getInterns();
    const config = await getConfig();
    const logs = await getLogs(15);

    await axios.post(
      `${appUrl}/api/sync/webhook`,
      {
        job,
        result: res,
        interns,
        config,
        logs,
        syncedAt: new Date().toISOString()
      },
      {
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    console.log('[Runner] Berhasil memperbarui data di Dashboard Vercel!');
  } catch (err) {
    console.warn('[Runner] Gagal mengirim webhook ke Vercel:', err.response?.data || err.message);
  }
}

async function main() {
  const jobArg = process.argv.slice(2).find((a) => a.startsWith('--job='));
  const timeArg = process.argv.slice(2).find((a) => a.startsWith('--time='));

  let job = 'morning';
  if (jobArg) {
    job = jobArg.split('=')[1];
  } else if (timeArg) {
    const t = timeArg.split('=')[1];
    job = t.startsWith('09') ? 'morning' : t.startsWith('21') ? 'night' : 'afternoon';
  }

  if (!CYCLES[job]) {
    throw new Error(`Job tidak valid: "${job}". Pilihan: morning, afternoon, night`);
  }

  console.log(`====================================================`);
  console.log(`[Runner] Memulai siklus: ${job.toUpperCase()} pada ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`);
  console.log(`====================================================`);

  const res = await CYCLES[job](true);
  console.log('[Runner] Hasil siklus:', JSON.stringify({ ...res, interns: undefined }, null, 2));

  await notifyVercelDashboard(job, res);

  if (!res.success && res.error) {
    console.error('[Runner] Peringatan: siklus selesai dengan status error:', res.error);
  }
}

main().catch((err) => {
  console.error('[Fatal Error]:', err);
  process.exit(1);
});
