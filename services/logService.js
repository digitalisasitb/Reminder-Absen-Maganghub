const fs = require('fs');
const path = require('path');

const LOGS_FILE = path.join(__dirname, '..', 'data', 'logs.json');

function getLogs() {
  try {
    if (!fs.existsSync(LOGS_FILE)) return [];
    const data = fs.readFileSync(LOGS_FILE, 'utf-8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error('Error reading logs:', err);
    return [];
  }
}

function addLog(type, status, message, details = '') {
  try {
    const logs = getLogs();
    const newLog = {
      id: 'log-' + Date.now(),
      timestamp: new Date().toISOString(),
      type, // 'sync', 'reminder', 'auth', 'scheduler', 'config'
      status, // 'success', 'warning', 'error', 'info'
      message,
      details
    };
    logs.unshift(newLog); // latest first
    const trimmed = logs.slice(0, 150);
    fs.writeFileSync(LOGS_FILE, JSON.stringify(trimmed, null, 2), 'utf-8');
    return newLog;
  } catch (err) {
    console.error('Error writing log:', err);
    return null;
  }
}

function clearLogs() {
  try {
    fs.writeFileSync(LOGS_FILE, JSON.stringify([], null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error clearing logs:', err);
    return false;
  }
}

module.exports = {
  getLogs,
  addLog,
  clearLogs
};
