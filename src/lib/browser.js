const fs = require('fs');

const LOCAL_CANDIDATES = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.LOCALAPPDATA && process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  process.env.PROGRAMFILES && process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe'
];

function getBrowserExecutablePath(preferredPath) {
  if (preferredPath && fs.existsSync(preferredPath)) return preferredPath;
  return LOCAL_CANDIDATES.find((c) => c && fs.existsSync(c)) || null;
}

/**
 * Launch browser:
 *  - Vercel (serverless): @sparticuz/chromium
 *  - Lokal / CI         : Chrome / Edge terinstall
 */
async function launchBrowser({ headless = true, preferredPath } = {}) {
  const puppeteer = require('puppeteer-core');
  if (process.env.VERCEL) {
    const chromium = require('@sparticuz/chromium');
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: 'shell',
      defaultViewport: { width: 1280, height: 850 }
    });
  }

  const executablePath = getBrowserExecutablePath(preferredPath);
  if (!executablePath) {
    throw new Error('Executable browser (Chrome atau Edge) tidak ditemukan di sistem ini.');
  }
  return puppeteer.launch({
    executablePath,
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors',
      '--window-size=1280,850'
    ]
  });
}

module.exports = { launchBrowser, getBrowserExecutablePath };
