const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { addLog } = require('./logService');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'config.json');

function getConfig() {
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

/**
 * Create Nodemailer Transporter based on config
 */
function createTransporter() {
  const config = getConfig();
  const emailCfg = (config && config.email) || {};

  const user = process.env.SMTP_USER || emailCfg.user;
  const pass = process.env.SMTP_PASS || emailCfg.pass;

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host: emailCfg.host || 'smtp.gmail.com',
    port: emailCfg.port || 465,
    secure: emailCfg.secure !== undefined ? emailCfg.secure : true,
    auth: {
      user,
      pass
    }
  });
}

/**
 * Send Email notification to mentor and unclocked interns
 */
async function sendNightReminderEmails({ unclockedInterns, mentorEmail, scheduleTime = '21:00' }) {
  const config = getConfig();
  const emailCfg = (config && config.email) || {};
  const targetMentor = mentorEmail || emailCfg.mentorEmail || 'mentor@rekayasa.co.id';
  const transporter = createTransporter();

  const now = new Date();
  const dateFormatted = now.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const results = {
    mentorEmailSent: false,
    internsSentCount: 0,
    details: []
  };

  // 1. Simulation / Fallback Mode if SMTP not yet configured
  if (!transporter) {
    addLog(
      'reminder',
      'info',
      `[SIMULASI EMAIL ${scheduleTime} WIB] Laporan dikirim ke Mentor (${targetMentor}) & ${unclockedInterns.length} anak magang.`,
      `Peserta belum absen: ${unclockedInterns.map(i => i.nama).join(', ')}. Batas waktu presensi: 24:00 WIB.`
    );
    return {
      success: true,
      mode: 'simulation',
      note: 'Kredensial SMTP belum diisi di Pengaturan Email. Email dicatat dalam log simulasi.',
      results: {
        mentor: targetMentor,
        internsCount: unclockedInterns.length
      }
    };
  }

  // 2. Real SMTP Delivery
  try {
    const senderEmail = process.env.SMTP_USER || emailCfg.user;

    // A. Send Summary Email to Mentor
    const internListHtml = unclockedInterns.map((i, idx) => `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px; font-weight: bold;">${idx + 1}. ${i.nama}</td>
        <td style="padding: 10px; color: #475569;">${i.posisi || '-'}</td>
        <td style="padding: 10px; color: #dc2626; font-weight: bold;">⚠️ Belum Presensi</td>
        <td style="padding: 10px; color: #0284c7;">${i.email || 'Email belum diset'}</td>
      </tr>
    `).join('');

    const mentorMailOptions = {
      from: `"Monev Kemnaker Reminder" <${senderEmail}>`,
      to: targetMentor,
      subject: `🚨 [Monev Kemnaker] Peringatan Jam ${scheduleTime} WIB: ${unclockedInterns.length} Anak Magang Belum Absen`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 650px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #0b60ea; margin-top: 0;">Laporan Presensi MagangHub Kemnaker</h2>
          <p style="color: #334155;">Halo Mentor,</p>
          <p style="color: #334155;">Pengecekan otomatis pukul <strong>${scheduleTime} WIB</strong> pada hari <strong>${dateFormatted}</strong> mendeteksi <strong>${unclockedInterns.length} peserta magang belum melakukan presensi</strong> di portal Kemnaker Monev MagangHub.</p>
          
          <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 12px; margin: 16px 0; border-radius: 4px;">
            <strong style="color: #991b1b;">⚠️ Batas Akhir Presensi Hari Ini: 24:00 WIB (Tengah Malam)</strong>
          </div>

          <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
            <thead>
              <tr style="background: #f1f5f9; text-align: left;">
                <th style="padding: 10px;">Nama</th>
                <th style="padding: 10px;">Posisi</th>
                <th style="padding: 10px;">Status</th>
                <th style="padding: 10px;">Email</th>
              </tr>
            </thead>
            <tbody>
              ${internListHtml}
            </tbody>
          </table>

          <p style="color: #64748b; font-size: 13px;">Email notifikasi peringatan juga telah otomatis diteruskan ke email masing-masing peserta magang di atas.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
          <small style="color: #94a3b8;">Sistem Otomasi Magang Kemnaker • PT Rekayasa Industri</small>
        </div>
      `
    };

    await transporter.sendMail(mentorMailOptions);
    results.mentorEmailSent = true;
    addLog('reminder', 'success', `[EMAIL MENTOR ${scheduleTime} WIB] Berhasil dikirim ke ${targetMentor}`);

    // B. Send Email to Each Intern
    for (const intern of unclockedInterns) {
      if (intern.email) {
        try {
          await transporter.sendMail({
            from: `"Monev Magang Kemnaker" <${senderEmail}>`,
            to: intern.email,
            subject: `⚠️ PENTING: Kamu Belum Absen di Portal Kemnaker Hari Ini (${dateFormatted})`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #fed7aa; border-radius: 8px; background: #fffaf5;">
                <h3 style="color: #ea580c; margin-top: 0;">Pengingat Presensi MagangHub Kemnaker</h3>
                <p>Halo <strong>${intern.nama}</strong>,</p>
                <p>Status presensi kamu di portal <strong>Kemnaker Monev MagangHub</strong> hari ini (<strong>${dateFormatted}</strong>) pada pengecekan pukul <strong>${scheduleTime} WIB</strong> masih tercatat <strong>BELUM ABSEN</strong>.</p>
                
                <div style="background: #ffffff; border: 1px solid #fdba74; padding: 14px; border-radius: 6px; margin: 16px 0;">
                  <p style="margin: 0; color: #c2410c; font-weight: bold;">⏰ Batas Akhir Presensi: Pukul 24:00 WIB (Malam Ini)</p>
                  <p style="margin: 6px 0 0; color: #475569; font-size: 13px;">Jangan sampai terlambat atau kehadiran kamu hari ini dianggap alpa di sistem Kemnaker.</p>
                </div>

                <div style="text-align: center; margin: 24px 0;">
                  <a href="https://monev.maganghub.kemnaker.go.id/dashboard/peserta" target="_blank" style="background: #0b60ea; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; display: inline-block;">
                    🚀 Klik untuk Buka Portal & Absen Sekarang
                  </a>
                </div>

                <p style="font-size: 13px; color: #64748b;">Terima kasih atas perhatiannya.<br><strong>Tim Pembimbing Magang • PT Rekayasa Industri</strong></p>
              </div>
            `
          });
          results.internsSentCount++;
          results.details.push({ intern: intern.nama, email: intern.email, status: 'sent' });
        } catch (mailErr) {
          results.details.push({ intern: intern.nama, email: intern.email, status: 'error', error: mailErr.message });
        }
      }
    }

    addLog(
      'reminder',
      'success',
      `[EMAIL MAGANG ${scheduleTime} WIB] Berhasil dikirim ke ${results.internsSentCount} anak magang.`,
      `Peserta: ${unclockedInterns.map(i => i.nama).join(', ')}`
    );

    return { success: true, mode: 'smtp', results };
  } catch (err) {
    addLog('reminder', 'error', `[EMAIL GAGAL ${scheduleTime} WIB]: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = {
  createTransporter,
  sendNightReminderEmails
};
