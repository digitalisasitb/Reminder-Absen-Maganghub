/**
 * Standalone CLI script for scheduled triggers
 * Usage:
 *   node sync-and-remind.js --time=09:30   (Morning sync only - reset & fetch attendance)
 *   node sync-and-remind.js --time=15:30   (WhatsApp reminder)
 *   node sync-and-remind.js --time=21:00   (Email to Mentor & Interns)
 */

const { runAfternoonReminderCycle, runNightReminderCycle, runMorningSyncCycle } = require('./services/schedulerService');

async function main() {
  const args = process.argv.slice(2);
  const timeArg = args.find(a => a.startsWith('--time='));
  const targetTime = timeArg ? timeArg.split('=')[1] : '15:30';

  console.log(`[CLI] Running Kemnaker Magang Reminder for schedule: ${targetTime} WIB`);

  if (targetTime === '09:30' || targetTime.includes('09')) {
    console.log('[CLI] Triggering Morning 09:30 Sync Cycle (Reset & Fetch Attendance)...');
    const res = await runMorningSyncCycle(true);
    console.log('[CLI] Morning Sync Result:', JSON.stringify(res, null, 2));
  } else if (targetTime === '21:00' || targetTime.includes('21')) {
    console.log('[CLI] Triggering Night 21:00 Email Cycle (Mentor & Interns)...');
    const res = await runNightReminderCycle(true);
    console.log('[CLI] Night Cycle Result:', JSON.stringify(res, null, 2));
  } else {
    console.log('[CLI] Triggering Afternoon 15:30 WhatsApp Cycle...');
    const res = await runAfternoonReminderCycle(true);
    console.log('[CLI] Afternoon Cycle Result:', JSON.stringify(res, null, 2));
  }
}

main().catch(err => {
  console.error('[CLI Error]:', err);
  process.exit(1);
});
