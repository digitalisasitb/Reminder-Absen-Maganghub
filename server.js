/**
 * Server lokal / VPS: dashboard + API + cron in-process (node-cron).
 * Di Vercel file ini TIDAK dipakai (lihat api/index.js).
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const app = require('./src/app');
const { initScheduler } = require('./src/services/schedulerService');

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log('====================================================');
  console.log('🚀 Kemnaker Magang Reminder running!');
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log('====================================================');
  initScheduler();
});
