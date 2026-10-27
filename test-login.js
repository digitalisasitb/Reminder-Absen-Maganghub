const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function testLogin() {
  console.log('Launching Chrome...');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false, // user/we can see if it needs captcha or what selector
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors', '--window-size=1280,850']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 850 });

  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (url.includes('monev-api.maganghub.kemnaker.go.id') || url.includes('/api/')) {
        console.log('[API RESPONSE]', res.status(), url);
        if (url.includes('peserta') || url.includes('participant') || url.includes('attendance') || url.includes('dashboard')) {
          const text = await res.text();
          fs.writeFileSync(path.join(__dirname, 'data', 'last_api_peserta.json'), text);
          console.log('[SAVED API DATA to last_api_peserta.json, size:', text.length, 'bytes]');
        }
      }
    } catch (e) {}
  });

  console.log('Navigating to https://monev.maganghub.kemnaker.go.id/dashboard/peserta ...');
  await page.goto('https://monev.maganghub.kemnaker.go.id/dashboard/peserta', {
    waitUntil: 'networkidle2',
    timeout: 60000
  });

  console.log('Current URL:', page.url());

  // Wait a bit to see if redirected to SSO
  await new Promise(r => setTimeout(r, 3000));
  const urlNow = page.url();
  console.log('URL after wait:', urlNow);

  // If redirected to login page or SSO
  if (urlNow.includes('account.kemnaker.go.id') || urlNow.includes('login') || urlNow.includes('auth')) {
    console.log('Looking for login input fields...');
    
    // Check available inputs
    const inputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map(i => ({
        type: i.type,
        name: i.name,
        id: i.id,
        placeholder: i.placeholder,
        class: i.className
      }));
    });
    console.log('Inputs found:', JSON.stringify(inputs, null, 2));

    // Try finding username/phone input
    const usernameSelectors = [
      'input[name="username"]',
      'input[name="email"]',
      'input[type="tel"]',
      'input[type="text"]',
      '#username',
      '#email'
    ];
    let userInput = null;
    for (const sel of usernameSelectors) {
      userInput = await page.$(sel);
      if (userInput) {
        console.log('Found username input with selector:', sel);
        break;
      }
    }

    if (userInput) {
      await userInput.click({ clickCount: 3 });
      await userInput.type('0811917603', { delay: 50 });
      console.log('Typed phone number 0811917603');
    }

    // Try finding password input
    const passInput = await page.$('input[type="password"]');
    if (passInput) {
      await passInput.click({ clickCount: 3 });
      await passInput.type('Tb#12345', { delay: 50 });
      console.log('Typed password');
    }

    // Check for submit button
    const submitBtn = await page.$('button[type="submit"], input[type="submit"], button.btn-primary');
    if (submitBtn) {
      console.log('Clicking submit button...');
      await submitBtn.click();
    } else {
      console.log('Pressing Enter...');
      await page.keyboard.press('Enter');
    }

    console.log('Waiting for navigation / redirect...');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(e => console.log('Navigation wait timed out or finished'));
  }

  // Wait to reach dashboard/peserta
  console.log('Waiting for dashboard/peserta to load...');
  await new Promise(r => setTimeout(r, 6000));
  console.log('Current URL now:', page.url());

  // Capture screenshot of page
  const screenshotPath = path.join(__dirname, 'data', 'kemnaker_logged_in.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Saved screenshot to:', screenshotPath);

  // Extract page content / peserta cards
  const pesertaData = await page.evaluate(() => {
    // Check cards
    const cards = document.querySelectorAll('.v-card, [class*="Participant"], [class*="card"], [class*="peserta"]');
    const pageText = document.body.innerText;
    return {
      cardCount: cards.length,
      pageTextSample: pageText.substring(0, 1500)
    };
  });
  console.log('Peserta data extracted:', pesertaData);

  // Save session cookies & tokens
  const cookies = await page.cookies();
  const tokens = await page.evaluate(() => {
    return {
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage }
    };
  });

  fs.writeFileSync(path.join(__dirname, 'data', 'session.json'), JSON.stringify({
    authenticatedAt: new Date().toISOString(),
    cookies,
    tokens
  }, null, 2));
  console.log('Saved session.json with', cookies.length, 'cookies');

  console.log('Done testing login!');
  setTimeout(async () => {
    await browser.close();
  }, 5000);
}

testLogin().catch(err => {
  console.error('Test login error:', err);
});
