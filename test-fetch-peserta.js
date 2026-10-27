const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function fetchPeserta() {
  console.log('Launching Chrome to fetch /dashboard/peserta...');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors', '--window-size=1280,850']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 850 });

  let capturedPesertaApi = null;

  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (url.includes('monev-api.maganghub.kemnaker.go.id')) {
        const text = await res.text();
        console.log('[API]', res.status(), url.substring(0, 100));
        if (url.includes('participant') || url.includes('peserta') || url.includes('batch')) {
          fs.writeFileSync(path.join(__dirname, 'data', 'api_participants_raw.json'), text);
          capturedPesertaApi = text;
        }
      }
    } catch (e) {}
  });

  console.log('Navigating to login page...');
  await page.goto('https://account.kemnaker.go.id/auth/login', {
    waitUntil: 'networkidle2',
    timeout: 60000
  });

  // Login
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

  console.log('Waiting for login to complete and dashboard to load...');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 4000));

  console.log('Navigating directly to https://monev.maganghub.kemnaker.go.id/dashboard/peserta ...');
  await page.goto('https://monev.maganghub.kemnaker.go.id/dashboard/peserta', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });

  await new Promise(r => setTimeout(r, 5000));

  // Take screenshot of peserta page
  const screenshotPath = path.join(__dirname, 'data', 'peserta_page.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Screenshot saved to:', screenshotPath);

  // Extract the 4 participants from DOM
  const participants = await page.evaluate(() => {
    // Look for cards or items containing participant info
    const results = [];
    const elements = document.querySelectorAll('*');
    
    // Find containers that have "Perlu dipantau" or participant name
    // Let's get cards based on Vuetify / Nuxt structure
    const allCards = Array.from(document.querySelectorAll('div, section, article')).filter(el => {
      const text = el.innerText || '';
      return text.includes('Batch 2') && (text.includes('Junior IT') || text.includes('Junior Business'));
    });

    // Let's find specific text blocks
    return {
      title: document.title,
      url: window.location.href,
      bodyText: document.body.innerText
    };
  });

  console.log('Page text extracted. Length:', participants.bodyText.length);
  fs.writeFileSync(path.join(__dirname, 'data', 'peserta_dom_text.txt'), participants.bodyText, 'utf-8');

  setTimeout(async () => {
    await browser.close();
  }, 3000);
}

fetchPeserta().catch(console.error);
