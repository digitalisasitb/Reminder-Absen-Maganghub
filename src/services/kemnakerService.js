const store = require('../lib/store');
const { launchBrowser } = require('../lib/browser');
const { addLog } = require('./logService');

const PESERTA_URL = 'https://monev.maganghub.kemnaker.go.id/dashboard/peserta';

const DEFAULT_PHONES = {
  'Khoirul Fazri Nurrokhman': '085221393477',
  'MUHAMAD ILHAM RYAN KUSUMA': '085156824580',
  'Muhammad Parhan': '081368372775',
  'Shabrina Dzakiyah Adani': '0895392047904'
};

const DEFAULT_EMAILS = {
  'Khoirul Fazri Nurrokhman': 'khoirulfazri16@gmail.com',
  'MUHAMAD ILHAM RYAN KUSUMA': 'milhamryank@gmail.com',
  'Muhammad Parhan': 'muhparhan565@gmail.com',
  'Shabrina Dzakiyah Adani': 'shabrinadzakiyah@gmail.com'
};

// ---------- State helpers ----------
const getConfig = async () => (await store.get('config', {})) || {};
const saveConfig = (cfg) => store.set('config', cfg);
const getInterns = async () => (await store.get('interns', [])) || [];
const saveInterns = (interns) => store.set('interns', interns);

/** Tanggal & jam WIB (Asia/Jakarta) */
function wibDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d); // YYYY-MM-DD
}
function wibTime(d = new Date()) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(d).replace('.', ':');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Gabungkan hasil scrape dengan data lama.
 * ATURAN PENTING: kalau peserta sudah tercatat "hadir" HARI INI, status itu tidak
 * boleh turun lagi menjadi "belum_absen" oleh sync berikutnya (scrape portal bisa
 * saja salah baca). Status baru di-reset otomatis ketika tanggal berganti.
 */
function mergeParticipants(rawParticipants, existingInterns) {
  const today = wibDate();
  const prevByName = new Map(existingInterns.map((i) => [i.nama, i]));

  const uniqueMap = new Map();
  rawParticipants.forEach((item) => {
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

  let nextId = existingInterns.length + 1;
  const result = [];

  uniqueMap.forEach((item, name) => {
    const prev = prevByName.get(name);
    const sameDay = prev && prev.statusDate === today;

    let statusAbsen = item.isBelumAbsen ? 'belum_absen' : 'hadir';
    let jamAbsen = statusAbsen === 'hadir' ? `${wibTime()} WIB` : '-';
    let keterangan = item.alertText;

    if (sameDay && prev.statusAbsen === 'hadir') {
      statusAbsen = 'hadir';
      jamAbsen = prev.jamAbsen;
      keterangan = 'Hadir';
    }

    result.push({
      id: (prev && prev.id) || `MGN-${String(nextId++).padStart(3, '0')}`,
      nama: name,
      posisi: item.posisi,
      kampus: 'PT Rekayasa Industri',
      batch: item.batch,
      pembimbing: (prev && prev.pembimbing) || 'Mentor Muhammad (PT Rekayasa Industri)',
      phone: item.scrapedPhone || (prev && prev.phone) || DEFAULT_PHONES[name] || '',
      email: item.scrapedEmail || (prev && prev.email) || DEFAULT_EMAILS[name] || '',
      statusAbsen,
      statusDate: today,
      jamAbsen,
      keterangan,
      lastReminderSent: sameDay ? prev.lastReminderSent || null : null,
      reminderCount: sameDay ? prev.reminderCount || 0 : 0
    });
  });

  return result;
}

/**
 * Login ke Monev MagangHub & tarik status presensi semua peserta.
 * Melempar error jika login gagal atau tidak ada peserta terbaca, supaya
 * siklus reminder TIDAK mengirim notifikasi berdasarkan data kosong/usang.
 */
async function performBrowserLogin(customCredentials = {}) {
  const config = await getConfig();
  config.kemnaker = config.kemnaker || {};
  const kemnakerCfg = config.kemnaker;

  const email = customCredentials.email || process.env.KEMNAKER_PHONE || kemnakerCfg.email || '';
  const password = customCredentials.password || process.env.KEMNAKER_PASS || kemnakerCfg.password || '';
  const isHeadless =
    customCredentials.headless !== undefined
      ? customCredentials.headless
      : process.env.CI || process.env.VERCEL
        ? true
        : kemnakerCfg.headless ?? true;

  if (!email || !password) {
    const err = 'Kredensial Kemnaker belum diset (env KEMNAKER_PHONE & KEMNAKER_PASS).';
    await addLog('auth', 'error', err);
    throw new Error(err);
  }

  await addLog('auth', 'info', `Memulai koneksi Kemnaker (${isHeadless ? 'Headless' : 'Window Terbuka'}) untuk akun: ${email}...`);

  let browser = null;
  try {
    browser = await launchBrowser({ headless: isHeadless, preferredPath: kemnakerCfg.browserPath });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 850 });

    // Samarkan User-Agent dan hilangkan tanda otomatisasi navigator.webdriver
    await page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'languages', { get: () => ['id-ID', 'id', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });

    // Pasang session cookies jika tersedia (untuk bypass Cloudflare & SSO)
    const rawCookie = customCredentials.cookie || process.env.KEMNAKER_COOKIE || kemnakerCfg.sessionCookie || '';
    if (rawCookie) {
      const cookieList = [];
      const parts = rawCookie.split(';').map((c) => c.trim()).filter(Boolean);
      for (const part of parts) {
        const eqIdx = part.indexOf('=');
        if (eqIdx > 0) {
          const name = part.slice(0, eqIdx).trim();
          const value = part.slice(eqIdx + 1).trim();
          cookieList.push({
            name,
            value,
            domain: name === 'cf_clearance' ? '.kemnaker.go.id' : 'monev.maganghub.kemnaker.go.id',
            path: '/'
          });
        }
      }
      if (cookieList.length > 0) {
        await page.setCookie(...cookieList);
        await addLog('auth', 'info', `Menginjeksi ${cookieList.length} session cookie (termasuk Cloudflare bypass)...`);
      }
    }

    await page.goto(PESERTA_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(2000);

    // Jika masuk ke halaman verifikasi Cloudflare ("Performing security verification"),
    // beri waktu 5-8 detik agar Cloudflare memverifikasi fingerprint Chrome asli & otomatis redirect
    for (let c = 0; c < 6; c++) {
      const isCfChallenge = await page.evaluate(() => {
        const txt = document.body ? document.body.innerText : '';
        return txt.includes('security verification') || txt.includes('verifies you are not a bot');
      }).catch(() => false);

      if (!isCfChallenge) break;
      await addLog('auth', 'info', `Menunggu verifikasi keamanan otomatis (${c + 1}/6)...`);
      await sleep(2500);
    }

    if (/account\.kemnaker\.go\.id|login|auth/.test(page.url())) {
      await addLog('auth', 'info', 'Mengisi kredensial SSO Kemnaker...');

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
      if (submitBtn) await submitBtn.click();
      else await page.keyboard.press('Enter');

      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 35000 }).catch(() => {});
    }

    await sleep(3000);

    if (!page.url().includes('/dashboard/peserta')) {
      await page.goto(PESERTA_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(4000);
    }

    if (/account\.kemnaker\.go\.id|\/login|\/auth/.test(page.url())) {
      const diag = await page
        .evaluate(() => {
          const text = (document.body.innerText || '').replace(/\s+/g, ' ');
          const alerts = Array.from(
            document.querySelectorAll('[role="alert"], .alert, .error, .text-danger, .invalid-feedback, .v-messages__message')
          )
            .map((e) => (e.innerText || '').trim())
            .filter(Boolean);
          const hasCaptcha = !!document.querySelector('iframe[src*="captcha"], .g-recaptcha, [class*="captcha"], iframe[src*="turnstile"]');
          const hasOtp = /otp|kode verifikasi|verification code/i.test(text);
          return { alerts: alerts.slice(0, 3), hasCaptcha, hasOtp, snippet: text.slice(0, 200) };
        })
        .catch(() => ({ alerts: [], hasCaptcha: false, hasOtp: false, snippet: '' }));

      const hints = [];
      if (diag.alerts.length) hints.push(`Pesan portal: "${diag.alerts.join(' | ')}"`);
      if (diag.hasCaptcha) hints.push('Terdeteksi CAPTCHA');
      if (diag.hasOtp) hints.push('Portal meminta OTP/kode verifikasi');
      if (!hints.length && diag.snippet) hints.push(`Isi halaman: "${diag.snippet}"`);

      throw new Error(
        `Login Kemnaker gagal (masih di ${page.url()}). Periksa kredensial. ${hints.join('. ')}`.trim()
      );
    }

    await addLog('sync', 'info', 'Mengekstrak kartu peserta magang dan status presensi...');

    // Ambil HANYA kartu paling dalam (per peserta). Sebelumnya wrapper luar yang berisi
    // semua peserta ikut terbaca, sehingga "Perlu dipantau" milik satu orang menandai
    // peserta lain sebagai belum absen.
    const rawParticipants = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('.v-card, [class*="ParticipantListCard"], [class*="card"]'));
      const withBatch = all.filter((el) => /Batch\s*\d/i.test(el.innerText || ''));
      const innermost = withBatch.filter((el) => !withBatch.some((o) => o !== el && el.contains(o)));

      return innermost.map((card, idx) => {
        card.setAttribute('data-kmr-idx', String(idx));
        const lines = (card.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);

        let nama = lines[0] || `Peserta ${idx + 1}`;
        if (nama === 'Aktif' && lines.length > 1) nama = lines[1];

        let posisi = '';
        let batch = '';
        let alertText = '';
        lines.forEach((line) => {
          if (/Junior|Officer|Analyst|Engineer/.test(line)) posisi = line;
          if (line.includes('Batch')) batch = line;
          if (line.includes('Perlu dipantau') || line.includes('belum mengisi kehadiran')) alertText = line;
        });

        const text = card.innerText || '';
        const isBelumAbsen = text.includes('belum mengisi kehadiran') || text.includes('Perlu dipantau');
        const anchor = card.querySelector('a') || card.closest('a');

        return {
          nama,
          posisi: posisi || 'Peserta Magang Batch 2',
          batch: batch || 'Batch 2',
          isBelumAbsen,
          alertText: alertText || (isBelumAbsen ? 'Perlu dipantau: Peserta belum mengisi kehadiran hari ini' : 'Hadir'),
          href: anchor ? anchor.getAttribute('href') || '' : '',
          cardIndex: idx
        };
      });
    });

    if (!rawParticipants.length) {
      throw new Error('Tidak ada peserta terbaca dari portal (login gagal / layout berubah). Sync dibatalkan.');
    }

    const existingInterns = await getInterns();
    const known = new Map(existingInterns.map((i) => [i.nama, i]));

    // Scrape detail kontak hanya jika email/HP peserta belum diketahui (hemat waktu serverless)
    for (const p of rawParticipants) {
      const prev = known.get(p.nama);
      const hasContact =
        (prev && prev.phone && prev.email) || (DEFAULT_PHONES[p.nama] && DEFAULT_EMAILS[p.nama]);
      if (hasContact) continue;

      try {
        if (p.href && p.href.includes('participant=')) {
          const detailUrl = p.href.startsWith('http') ? p.href : `https://monev.maganghub.kemnaker.go.id${p.href}`;
          const detailPage = await browser.newPage();
          await detailPage.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 20000 });
          await sleep(2000);
          const contact = await detailPage.evaluate(() => {
            const body = document.body.innerText || '';
            const e = body.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            const ph = body.match(/(\+62|62|08)[0-9]{8,13}/);
            return { email: e ? e[0] : null, phone: ph ? ph[0] : null };
          });
          if (contact.email) p.scrapedEmail = contact.email;
          if (contact.phone) p.scrapedPhone = contact.phone;
          await detailPage.close().catch(() => {});
        }
      } catch (detErr) {
        // lanjut jika detail satu peserta gagal
      }
    }

    const finalInterns = mergeParticipants(rawParticipants, existingInterns);
    if (!finalInterns.length) {
      throw new Error('Daftar peserta kosong setelah normalisasi. Sync dibatalkan.');
    }
    await saveInterns(finalInterns);

    config.kemnaker.email = email;
    config.kemnaker.lastSync = new Date().toISOString();
    config.kemnaker.syncStatus = 'authenticated';
    await saveConfig(config);

    const unclockedCount = finalInterns.filter((i) => i.statusAbsen === 'belum_absen').length;
    await addLog(
      'sync',
      'success',
      `Berhasil menarik ${finalInterns.length} peserta magang dari Monev MagangHub Kemnaker!`,
      `Peserta: ${finalInterns.map((i) => `${i.nama} (${i.statusAbsen})`).join(', ')}`
    );

    return { success: true, interns: finalInterns, unclockedCount };
  } catch (err) {
    await addLog('auth', 'error', `Gagal koneksi Kemnaker: ${err.message}`);
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Sinkronisasi Langsung via REST API Monev Kemnaker (Cepat, Akurat, 100% Anti Cloudflare)
 */
async function syncViaDirectApi(token) {
  const axios = require('axios');
  const today = wibDate(); // YYYY-MM-DD
  const cleanToken = token.trim().replace(/^Bearer\s+/i, '');

  await addLog('sync', 'info', 'Menghubungi Monev API Kemnaker secara langsung...');

  const headers = {
    accept: '*/*',
    authorization: `Bearer ${cleanToken}`,
    origin: 'https://monev.maganghub.kemnaker.go.id',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
    'x-frontend-build-id': 'e77b4e10ebce5ee3dfad1b9f16c7f86ca561569d-production'
  };

  // 1. Tarik daftar peserta
  const partRes = await axios.get('https://monev-api.maganghub.kemnaker.go.id/api/v1/users/participants?page=1&limit=25', {
    headers,
    timeout: 10000
  });

  const participants = (partRes.data && partRes.data.data) || [];
  if (!participants.length) {
    throw new Error('Daftar peserta kosong dari API Monev Kemnaker.');
  }

  const existingInterns = await getInterns();
  const prevByName = new Map(existingInterns.map((i) => [i.nama, i]));
  const finalInterns = [];

  let idx = 1;
  for (const p of participants) {
    const name = p.name;
    const prev = prevByName.get(name);
    const sameDay = prev && prev.statusDate === today;

    let statusAbsen = 'belum_absen';
    let jamAbsen = '-';
    let keterangan = 'Belum mengisi kehadiran hari ini';

    // 2. Tarik status presensi asli hari ini untuk peserta ini
    try {
      const attUrl = `https://monev-api.maganghub.kemnaker.go.id/api/v1/attendances?participant_id=${p.id}&start_date=${today}&end_date=${today}`;
      const attRes = await axios.get(attUrl, { headers, timeout: 8000 });
      const attList = (attRes.data && attRes.data.data) || [];

      if (attList.length > 0) {
        const att = attList[0];
        if (att.status === 'PRESENT') {
          statusAbsen = 'hadir';
          keterangan = 'Hadir';
          if (att.created_at) {
            const d = new Date(att.created_at);
            jamAbsen = `${wibTime(d)} WIB`;
          } else {
            jamAbsen = '08:00 WIB';
          }
        } else if (att.status === 'ON_LEAVE') {
          statusAbsen = 'izin';
          keterangan = att.leave_reason || 'Izin/Sakit';
          jamAbsen = 'Izin';
        }
      }
    } catch (attErr) {
      // Jika attendance gagal ditarik, pertahankan status sebelumnya jika sameDay
      if (sameDay && prev.statusAbsen === 'hadir') {
        statusAbsen = 'hadir';
        jamAbsen = prev.jamAbsen;
        keterangan = prev.keterangan || 'Hadir';
      }
    }

    finalInterns.push({
      id: (prev && prev.id) || `MGN-${String(idx++).padStart(3, '0')}`,
      participantId: p.id,
      nama: name,
      posisi: p.job_role || 'Peserta Magang Batch 2',
      kampus: p.internship_company || 'PT Rekayasa Industri',
      batch: `Batch ${p.internship_batch_name || '2'}`,
      photoUrl: p.photo_url || '',
      pembimbing: p.mentor_name ? `${p.mentor_name} (${p.internship_company || 'PT Rekayasa Industri'})` : (prev && prev.pembimbing) || 'Mentor Muhammad',
      phone: p.phone_number || (prev && prev.phone) || DEFAULT_PHONES[name] || '',
      email: p.email || (prev && prev.email) || DEFAULT_EMAILS[name] || '',
      statusAbsen,
      statusDate: today,
      jamAbsen,
      keterangan,
      lastReminderSent: sameDay ? prev.lastReminderSent || null : null,
      reminderCount: sameDay ? prev.reminderCount || 0 : 0
    });
  }

  await saveInterns(finalInterns);

  const config = await getConfig();
  config.kemnaker = config.kemnaker || {};
  config.kemnaker.bearerToken = cleanToken;
  config.kemnaker.lastSync = new Date().toISOString();
  config.kemnaker.syncStatus = 'authenticated';
  await saveConfig(config);

  const unclockedCount = finalInterns.filter((i) => i.statusAbsen === 'belum_absen').length;
  await addLog(
    'sync',
    'success',
    `[Direct API] Berhasil menarik ${finalInterns.length} peserta magang via REST API Monev!`,
    `Peserta: ${finalInterns.map((i) => `${i.nama} (${i.statusAbsen} - ${i.jamAbsen})`).join(', ')}`
  );

  return { success: true, interns: finalInterns, unclockedCount, mode: 'api' };
}

/** Sinkronisasi data presensi (dipakai semua siklus terjadwal) */
async function syncAttendanceData() {
  const config = await getConfig();
  const token = process.env.KEMNAKER_BEARER_TOKEN || (config.kemnaker && config.kemnaker.bearerToken);

  // Jika token tersedia, gunakan Direct API (sangat cepat & anti Cloudflare)
  if (token) {
    try {
      return await syncViaDirectApi(token);
    } catch (apiErr) {
      await addLog('sync', 'warn', `Direct API gagal (${apiErr.message}), mencoba fallback browser...`);
    }
  }

  return performBrowserLogin({});
}

module.exports = {
  performBrowserLogin,
  syncAttendanceData,
  mergeParticipants,
  getInterns,
  saveInterns,
  getConfig,
  saveConfig,
  wibDate,
  wibTime
};
