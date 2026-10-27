const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function extractParticipants() {
  console.log('Starting browser extraction...');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors', '--window-size=1280,850']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 850 });

  console.log('Navigating to https://monev.maganghub.kemnaker.go.id/dashboard/peserta ...');
  await page.goto('https://monev.maganghub.kemnaker.go.id/dashboard/peserta', {
    waitUntil: 'networkidle2',
    timeout: 60000
  });

  await new Promise(r => setTimeout(r, 2000));
  const currentUrl = page.url();
  console.log('Current URL:', currentUrl);

  if (currentUrl.includes('account.kemnaker.go.id') || currentUrl.includes('login') || currentUrl.includes('auth')) {
    console.log('Filling credentials...');
    const userInput = await page.$('input[name="username"], input[name="email"], input[type="text"], input[type="tel"]');
    if (userInput) {
      await userInput.click({ clickCount: 3 });
      await userInput.type('0811917603', { delay: 40 });
    }

    const passInput = await page.$('input[type="password"]');
    if (passInput) {
      await passInput.click({ clickCount: 3 });
      await passInput.type('Tb#12345', { delay: 40 });
    }

    const submitBtn = await page.$('button[type="submit"], input[type="submit"], button.btn-primary');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }

    console.log('Waiting for login redirect to complete...');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 35000 }).catch(() => {});
  }

  console.log('Waiting on dashboard page. Current URL:', page.url());
  await new Promise(r => setTimeout(r, 3000));

  // If on /dashboard, click on Peserta or navigate to /dashboard/peserta
  if (!page.url().includes('/dashboard/peserta')) {
    console.log('Navigating to /dashboard/peserta ...');
    await page.goto('https://monev.maganghub.kemnaker.go.id/dashboard/peserta', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await new Promise(r => setTimeout(r, 4000));
  }

  // Extract participants directly from DOM
  const extracted = await page.evaluate(() => {
    const list = [];
    // The participants are rendered as cards in Nuxt / Vuetify
    // Let's find all cards that contain participant names or positions
    const cardElements = document.querySelectorAll('.v-card, [class*="ParticipantListCard"], [class*="card"]');
    
    cardElements.forEach((card, idx) => {
      const text = card.innerText || '';
      if (text.includes('Batch 2') || text.includes('Junior')) {
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        
        // Find name (usually line with name or first bold/strong/h3/h4/title)
        let nama = lines[0] || `Peserta ${idx + 1}`;
        let posisi = '';
        let batch = '';
        let alertText = '';
        let status = 'Aktif';

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

        // If line 0 is 'Aktif', name might be line 1
        if (nama === 'Aktif' && lines.length > 1) {
          nama = lines[1];
        }

        const isBelumAbsen = text.includes('belum mengisi kehadiran') || text.includes('Perlu dipantau');

        list.push({
          id: `MGN-${String(idx + 1).padStart(3, '0')}`,
          nama,
          posisi: posisi || 'Peserta Magang Batch 2',
          batch: batch || 'Batch 2 · 21 Sep 2026 - 20 Mar 2027',
          statusAbsen: isBelumAbsen ? 'belum_absen' : 'hadir',
          jamAbsen: isBelumAbsen ? '-' : '08:00 WIB',
          keterangan: alertText || (isBelumAbsen ? 'Perlu dipantau: Peserta belum mengisi kehadiran hari ini' : 'Hadir'),
          fullText: text
        });
      }
    });

    return {
      count: list.length,
      participants: list,
      pageTitle: document.title,
      url: window.location.href
    };
  });

  console.log('Extracted result:', JSON.stringify(extracted, null, 2));

  // Screenshot for visual proof
  const screenshotPath = path.join(__dirname, 'data', 'kemnaker_peserta_extracted.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Saved screenshot to:', screenshotPath);

  // Also collect cookies for subsequent runs
  const cookies = await page.cookies();
  fs.writeFileSync(path.join(__dirname, 'data', 'session.json'), JSON.stringify({
    authenticatedAt: new Date().toISOString(),
    cookies,
    emailOrPhone: '0811917603'
  }, null, 2));

  setTimeout(async () => {
    await browser.close();
  }, 2000);

  return extracted;
}

extractParticipants().catch(console.error);
