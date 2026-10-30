const store = require('../lib/store');

async function getLogs() {
  try {
    return (await store.get('logs', [])) || [];
  } catch (err) {
    console.error('Error reading logs:', err.message);
    return [];
  }
}

async function addLog(type, status, message, details = '') {
  console.log(`[${type}/${status}] ${message}`);
  try {
    const logs = await getLogs();
    const newLog = {
      id: 'log-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      timestamp: new Date().toISOString(),
      type, // 'sync', 'reminder', 'auth', 'scheduler', 'config'
      status, // 'success', 'warning', 'error', 'info'
      message,
      details
    };
    logs.unshift(newLog); // latest first
    await store.set('logs', logs.slice(0, 150));
    return newLog;
  } catch (err) {
    console.error('Error writing log:', err.message);
    return null;
  }
}

async function clearLogs() {
  try {
    await store.set('logs', []);
    return true;
  } catch (err) {
    console.error('Error clearing logs:', err.message);
    return false;
  }
}

module.exports = { getLogs, addLog, clearLogs };
