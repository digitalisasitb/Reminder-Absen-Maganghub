const puppeteer = require('puppeteer-core');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { addLog } = require('./logService');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'config.json');
const SESSION_FILE = path.join(__dirname, '..', 'data', 'session.json');
const INTERNS_FILE = path.join(__dirname, '..', 'data', 'interns.json');

/**
 * Detect available browser executable on Windows
 */
function getBrowserExecutablePath(preferredPath) {
  if (preferredPath && fs.existsSync(preferredPath)) {
    return preferredPath;
  }
  const candidates = [
    // Linux / GitHub Actions
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe'
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getConfig() {
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving config:', e);
  }
}

function getSession() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null;
    const data = fs.readFileSync(SESSION_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

function saveSession(session) {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving session:', e);
  }
}

function getInterns() {
  try {
    if (!fs.existsSync(INTERNS_FILE)) return [];
    const data = fs.readFileSync(INTERNS_FILE, 'utf-8');
    return JSON.parse(data || '[]');
  } catch (e) {
    return [];
  }
}

function saveInterns(interns) {
  try {
    fs.writeFileSync(INTERNS_FILE, JSON.stringify(interns, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving interns:', e);
  }
}

/**
 * Perform Automated Login & Data Sync from Kemnaker Monev MagangHub
 */
async function performBrowserLogin(customCredentials = {}) {
  const config = getConfig();
  const kemnakerCfg = config.kemnaker || {};

  const email = customCredentials.email || process.env.KEMNAKER_PHONE || kemnakerCfg.email || '';
  const password = customCredentials.password || process.env.KEMNAKER_PASS || kemnakerCfg.password || '';
  const isHeadless = customCredentials.headless !== undefined 
    ? customCredentials.headless 
    : (process.env.CI ? true : (kemnakerCfg.headless ?? true));

  const browserPath = getBrowserExecutablePath(kemnakerCfg.browserPath);
  if (!browserPath) {
    const err = 'Executable browser (Chrome atau Edge) tidak ditemukan di sistem Windows ini.';
    addLog('auth', 'error', err);
    throw new Error(err);
  }

  addLog('auth', 'info', `Memulai koneksi Kemnaker (${isHeadless ? 'Headless' : 'Window Terbuka'}) untuk akun: ${email}...`);

  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: browserPath,
      headless: isHeadless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--ignore-certificate-errors',
        '--window-size=1280,850'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 850 });

    addLog('auth', 'info', 'Membuka portal https://monev.maganghub.kemnaker.go.id/dashboard/peserta ...');
    await page.goto('https://monev.maganghub.kemnaker.go.id/dashboard/peserta', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await new Promise(r => setTimeout(r, 2000));
    const currentUrl = page.url();

    // Check if redirected to SSO
    if (currentUrl.includes('account.kemnaker.go.id') || currentUrl.includes('login') || currentUrl.includes('auth')) {
      addLog('auth', 'info', 'Mengisi kredensial SSO Kemnaker (No HP & Password)...');

      const userInput = await page.$('input[name="username"], input[name="email"], input[type="text"], input[type="tel"]');
      if (userInput) {
        await userInput.click({ clickCount: 3 });
        await userInput.type(email, { delay: 40 });
      }

      const passInput = await page.$('input[type="password"]');
      if (passInput) {
        await passInput.click({ clickCount: 3 });
        await passInput.type(password, { delay: 40 });
      }

      const submitBtn = await page.$('button[type="submit"], input[type="submit"], button.btn-primary');
      if (submitBtn) {
        await submitBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }

      addLog('auth', 'info', 'Menunggu proses autentikasi dan callback SSO...');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 35000 }).catch(() => {});
    }

    await new Promise(r => setTimeout(r, 3000));

    // Ensure we are on /dashboard/peserta
    if (!page.url().includes('/dashboard/peserta')) {
      addLog('auth', 'info', 'Navigasi langsung ke https://monev.maganghub.kemnaker.go.id/dashboard/peserta ...');
      await page.goto('https://monev.maganghub.kemnaker.go.id/dashboard/peserta', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await new Promise(r => setTimeout(r, 4000));
    }

    addLog('sync', 'info', 'Mengekstrak kartu peserta magang dan status presensi...');

    // Extract participants from page DOM along with their detail links
    const rawParticipants = await page.evaluate(() => {
      const results = [];
      const cardElements = document.querySelectorAll('.v-card, [class*="ParticipantListCard"], [class*="card"]');

      cardElements.forEach((card, idx) => {
        const text = card.innerText || '';
        if (text.includes('Batch 2') || text.includes('Junior') || text.includes('Peserta')) {
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

          let nama = lines[0] || `Peserta ${idx + 1}`;
          let posisi = '';
          let batch = '';
          let alertText = '';

          lines.forEach(line => {
            if (line.includes('Junior') || line.includes('Officer') || line.includes('Analyst') || line.includes('Engineer')) {
              posisi = line;
            }
            if (line.includes('Batch')) {
              batch = line;
            }
            if (line.includes('Perlu dipantau') || line.includes('belum mengisi kehadiran')) {
              alertText = line;
            }
          });

          if (nama === 'Aktif' && lines.length > 1) {
            nama = lines[1];
          }

          const isBelumAbsen = text.includes('belum mengisi kehadiran') || text.includes('Perlu dipantau');

          // Check for link / participant ID attribute
          const anchor = card.querySelector('a') || card.closest('a');
          const href = anchor ? anchor.getAttribute('href') : '';

          results.push({
            nama,
            posisi: posisi || 'Peserta Magang Batch 2',
            batch: batch || 'Batch 2 · 21 Sep 2026 - 20 Mar 2027',
            isBelumAbsen,
            alertText: alertText || (isBelumAbsen ? 'Perlu dipantau: Peserta belum mengisi kehadiran hari ini' : 'Hadir'),
            href: href || '',
            cardIndex: idx
          });
        }
      });

      return results;
    });

    // Check detail profile for each participant to scrape email & phone if missing
    for (let i = 0; i < rawParticipants.length; i++) {
      const p = rawParticipants[i];
      try {
        let detailUrl = '';
        if (p.href && p.href.includes('participant=')) {
          detailUrl = p.href.startsWith('http') ? p.href : `https://monev.maganghub.kemnaker.go.id${p.href}`;
        }

        if (detailUrl) {
          addLog('sync', 'info', `Membuka URL detail profil ${p.nama}...`);
          const detailPage = await browser.newPage();
          await detailPage.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 20000 });
          await new Promise(r => setTimeout(r, 2000));

          const contact = await detailPage.evaluate(() => {
            const body = document.body.innerText || '';
            const emailMatch = body.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            const phoneMatch = body.match(/(\+62|62|08)[0-9]{8,13}/);
            return {
              email: emailMatch ? emailMatch[0] : null,
              phone: phoneMatch ? phoneMatch[0] : null
            };
          });

          if (contact.email) p.scrapedEmail = contact.email;
          if (contact.phone) p.scrapedPhone = contact.phone;

          await detailPage.close().catch(() => {});
        } else {
          // If no direct href (e.g. Vuetify card click event @click)
          const cards = await page.$$('.v-card, [class*="ParticipantListCard"], [class*="card"]');
          if (cards[p.cardIndex]) {
            addLog('sync', 'info', `Mengklik kartu ${p.nama} untuk membaca profil...`);
            await cards[p.cardIndex].click();
            await new Promise(r => setTimeout(r, 2500));

            const contact = await page.evaluate(() => {
              const body = document.body.innerText || '';
              const emailMatch = body.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
              const phoneMatch = body.match(/(\+62|62|08)[0-9]{8,13}/);
              return {
                email: emailMatch ? emailMatch[0] : null,
                phone: phoneMatch ? phoneMatch[0] : null
              };
            });

            if (contact.email) p.scrapedEmail = contact.email;
            if (contact.phone) p.scrapedPhone = contact.phone;

            // Return back to dashboard/peserta list
            await page.goBack({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      } catch (detErr) {
        // Continue if single participant detail timeout
      }
    }

    // Deduplicate by name
    const existingInterns = getInterns();
    const phoneMap = new Map();
    const emailMap = new Map();
    const reminderMap = new Map();
    existingInterns.forEach(i => {
      if (i.phone) phoneMap.set(i.nama, i.phone);
      if (i.email) emailMap.set(i.nama, i.email);
      if (i.lastReminderSent) reminderMap.set(i.nama, { sent: i.lastReminderSent, count: i.reminderCount });
    });

    const uniqueMap = new Map();
    rawParticipants.forEach(item => {
      if (
        item.nama &&
        !uniqueMap.has(item.nama) &&
        item.nama !== 'Aktif' &&
        !item.nama.includes('Perlu dipantau') &&
        !item.nama.includes('kehadiran') &&
        !item.nama.includes('Batch') &&
        item.nama.length > 3
      ) {
        uniqueMap.set(item.nama, item);
      }
    });

    const defaultPhones = {
      'Khoirul Fazri Nurrokhman': '085221393477',
      'MUHAMAD ILHAM RYAN KUSUMA': '085156824580',
      'Muhammad Parhan': '081368372775',
      'Shabrina Dzakiyah Adani': '0895392047904'
    };

    const defaultEmails = {
      'Khoirul Fazri Nurrokhman': 'khoirulfazri16@gmail.com',
      'MUHAMAD ILHAM RYAN KUSUMA': 'milhamryank@gmail.com',
      'Muhammad Parhan': 'muhparhan565@gmail.com',
      'Shabrina Dzakiyah Adani': 'shabrinadzakiyah@gmail.com'
    };

    let idx = 1;
    const finalInterns = [];

    uniqueMap.forEach((item, name) => {
      const reminderData = reminderMap.get(name) || {};
      finalInterns.push({
        id: `MGN-${String(idx++).padStart(3, '0')}`,
        nama: name,
        posisi: item.posisi,
        kampus: 'PT Rekayasa Industri',
        batch: item.batch,
        pembimbing: 'Mentor Muhammad (PT Rekayasa Industri)',
        phone: item.scrapedPhone || phoneMap.get(name) || defaultPhones[name] || '',
        email: item.scrapedEmail || emailMap.get(name) || defaultEmails[name] || '',
        statusAbsen: item.isBelumAbsen ? 'belum_absen' : 'hadir',
        jamAbsen: item.isBelumAbsen ? '-' : '08:00 WIB',
        keterangan: item.alertText,
        lastReminderSent: reminderData.sent || null,
        reminderCount: reminderData.count || 0
      });
    });

    if (finalInterns.length > 0) {
      saveInterns(finalInterns);
    }

    // Save cookies
    const cookies = await page.cookies();
    saveSession({
      authenticatedAt: new Date().toISOString(),
      cookies,
      emailOrPhone: email
    });

    // Update config
    config.kemnaker.email = email;
    config.kemnaker.lastSync = new Date().toISOString();
    config.kemnaker.syncStatus = 'authenticated';
    saveConfig(config);

    const unclockedCount = finalInterns.filter(i => i.statusAbsen === 'belum_absen').length;
    addLog(
      'sync',
      'success',
      `Berhasil menarik ${finalInterns.length} peserta magang dari Monev MagangHub Kemnaker!`,
      `Peserta: ${finalInterns.map(i => i.nama).join(', ')} (${unclockedCount} belum absen).`
    );

    return {
      success: true,
      interns: finalInterns,
      unclockedCount
    };
  } catch (err) {
    addLog('auth', 'error', `Gagal koneksi Kemnaker: ${err.message}`);
    throw err;
  } finally {
    if (browser) {
      setTimeout(async () => {
        try { await browser.close(); } catch (e) {}
      }, 2000);
    }
  }
}

/**
 * Synchronize attendance data
 */
async function syncAttendanceData() {
  const config = getConfig();
  const kemnakerCfg = config.kemnaker || {};
  const email = process.env.KEMNAKER_PHONE || kemnakerCfg.email || '0811917603';
  const password = process.env.KEMNAKER_PASS || kemnakerCfg.password || 'Tb#12345';
  const isHeadless = process.env.CI ? true : (kemnakerCfg.headless ?? true);

  return performBrowserLogin({ email, password, headless: isHeadless });
}

module.exports = {
  getBrowserExecutablePath,
  performBrowserLogin,
  syncAttendanceData,
  getInterns,
  saveInterns,
  getConfig,
  saveConfig,
  getSession
};
