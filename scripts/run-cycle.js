/**
 * CLI manual (untuk test lokal):
 *   node scripts/run-cycle.js --time=09:30   (sync pagi)
 *   node scripts/run-cycle.js --time=15:30   (WhatsApp reminder)
 *   node scripts/run-cycle.js --time=21:00   (Email Mentor & Magang)
 */
require('dotenv').config();
const { CYCLES } = require('../src/services/schedulerService');

async function main() {
  const timeArg = process.argv.slice(2).find((a) => a.startsWith('--time='));
  const t = timeArg ? timeArg.split('=')[1] : '15:30';
  const job = t.startsWith('09') ? 'morning' : t.startsWith('21') ? 'night' : 'afternoon';

  console.log(`[CLI] Menjalankan siklus: ${job} (${t} WIB)`);
  const res = await CYCLES[job](true);
  console.log('[CLI] Hasil:', JSON.stringify({ ...res, interns: undefined }, null, 2));
}

main().catch((err) => {
  console.error('[CLI Error]:', err);
  process.exit(1);
});
