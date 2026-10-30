/**
 * Server lokal / VPS: dashboard + API + cron in-process (node-cron).
 * Di Vercel, file ini hanya mengekspor app (tanpa listen / scheduler);
 * cron dijalankan lewat endpoint /api/cron/:job (lihat api/index.js).
 */
require('dotenv').config();
const app = require('./src/app');

if (process.env.VERCEL) {
  module.exports = app;
} else {
  const { initScheduler } = require('./src/services/schedulerService');
  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log('====================================================');
    console.log('🚀 Kemnaker Magang Reminder running!');
    console.log(`🌐 Local URL: http://localhost:${PORT}`);
    console.log('====================================================');
    initScheduler();
  });
}
