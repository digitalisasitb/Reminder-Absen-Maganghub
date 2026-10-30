// Kemnaker Magang Reminder - Modern Web Controller

const state = {
  interns: [],
  config: null,
  status: null,
  activeFilter: 'all',
  searchQuery: '',
  selectedIntern: null
};

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initEventListeners();
  loadAllData();

  // Auto refresh stats and logs every 10 seconds
  setInterval(() => {
    loadStatus();
    loadLogs();
  }, 10000);
});

// Tab Switcher
function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPane = document.getElementById(tab.dataset.target);
      if (targetPane) targetPane.classList.add('active');
    });
  });
}

// Event Listeners
function initEventListeners() {
  // Search and filter
  const searchInput = document.getElementById('search-intern');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.toLowerCase();
      renderInternsTable();
    });
  }

  const statusFilter = document.getElementById('filter-status');
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      state.activeFilter = e.target.value;
      renderInternsTable();
    });
  }

  // Top action buttons
  document.getElementById('btn-sync-top')?.addEventListener('click', handleSyncKemnaker);
  document.getElementById('btn-remind-top')?.addEventListener('click', handleSendAllReminders);

  // Kemnaker auth forms
  document.getElementById('form-kemnaker-login')?.addEventListener('submit', handleBrowserLogin);
  document.getElementById('form-save-token')?.addEventListener('submit', handleSaveToken);
  document.getElementById('btn-sync-now')?.addEventListener('click', handleSyncKemnaker);

  // WhatsApp settings
  document.getElementById('form-wa-config')?.addEventListener('submit', handleSaveWaConfig);
  document.getElementById('btn-test-wa')?.addEventListener('click', handleTestWa);
  document.getElementById('wa-template-input')?.addEventListener('input', updateWaPreview);

  // Scheduler settings
  document.getElementById('form-scheduler')?.addEventListener('submit', handleSaveScheduler);
  document.getElementById('btn-trigger-manual-cycle')?.addEventListener('click', handleSendAllReminders);

  // Log management
  document.getElementById('btn-refresh-logs')?.addEventListener('click', loadLogs);
  document.getElementById('btn-clear-logs')?.addEventListener('click', handleClearLogs);

  // Modal edit intern
  document.getElementById('form-edit-intern')?.addEventListener('submit', handleSaveEditIntern);
  document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);
}

// Load Initial Data
async function loadAllData() {
  await Promise.all([
    loadStatus(),
    loadInterns(),
    loadConfig(),
    loadLogs()
  ]);
}

// 1. Fetch & Render Status & Stats
async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const json = await res.json();
    if (json.success) {
      state.status = json.data;
      renderStatusOverview(json.data);
    }
  } catch (err) {
    console.error('Failed to load status:', err);
  }
}

function renderStatusOverview(data) {
  const stats = data.stats || {};
  document.getElementById('stat-total-interns').textContent = stats.total || 0;
  document.getElementById('stat-hadir-interns').textContent = stats.hadir || 0;
  document.getElementById('stat-belum-absen').textContent = stats.belumAbsen || 0;
  document.getElementById('badge-unclocked-count').textContent = stats.belumAbsen || 0;

  // Header pill & Kemnaker status
  const pill = document.getElementById('engine-status-pill');
  if (data.kemnaker && data.kemnaker.authenticated) {
    pill.className = 'status-pill';
    pill.innerHTML = '<span class="pulse-dot"></span> Sesi Kemnaker Aktif';
    document.getElementById('kemnaker-session-badge').innerHTML = '<span class="badge badge-success">✓ Terautentikasi</span>';
  } else {
    pill.className = 'status-pill offline';
    pill.innerHTML = '<span class="pulse-dot"></span> Siap / Demo Mode';
    document.getElementById('kemnaker-session-badge').innerHTML = '<span class="badge badge-warning">Belum Terhubung</span>';
  }

  // Scheduler timing
  if (data.scheduler) {
    document.getElementById('stat-scheduler-time').textContent = data.scheduler.enabled
      ? `${data.scheduler.time} WIB`
      : 'Nonaktif';
    document.getElementById('stat-scheduler-desc').textContent = data.scheduler.enabled
      ? `Setiap ${data.scheduler.activeDays.join(', ')}`
      : 'Otomatisasi dimatikan';
  }

  // Last sync info
  if (data.kemnaker && data.kemnaker.lastSync) {
    const dateObj = new Date(data.kemnaker.lastSync);
    document.getElementById('kemnaker-last-sync-text').textContent = dateObj.toLocaleTimeString('id-ID') + ' WIB';
  }
}

// 2. Fetch & Render Interns
async function loadInterns() {
  try {
    const res = await fetch('/api/interns');
    const json = await res.json();
    if (json.success) {
      state.interns = json.data || [];
      renderInternsTable();
    }
  } catch (err) {
    showToast('Gagal memuat data anak magang: ' + err.message, 'error');
  }
}

function renderInternsTable() {
  const tbody = document.getElementById('interns-table-body');
  if (!tbody) return;

  const filtered = state.interns.filter((item) => {
    // Search query
    const matchSearch =
      !state.searchQuery ||
      item.nama.toLowerCase().includes(state.searchQuery) ||
      (item.kampus && item.kampus.toLowerCase().includes(state.searchQuery)) ||
      (item.posisi && item.posisi.toLowerCase().includes(state.searchQuery)) ||
      (item.phone && item.phone.includes(state.searchQuery));

    // Status filter
    const matchFilter =
      state.activeFilter === 'all' ||
      item.statusAbsen === state.activeFilter;

    return matchSearch && matchFilter;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
          Tidak ada data peserta magang yang sesuai kriteria pencarian.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered
    .map((item) => {
      let statusBadge = '';
      if (item.statusAbsen === 'hadir') {
        statusBadge = '<span class="badge badge-success">✓ Sudah Absen</span>';
      } else if (item.statusAbsen === 'izin') {
        statusBadge = `<span class="badge badge-info" title="${item.keterangan || 'Izin/Sakit'}">📋 Izin / Sakit</span>`;
      } else if (item.statusAbsen === 'belum_absen') {
        statusBadge = '<span class="badge badge-warning">⚠️ Belum Absen</span>';
      } else {
        statusBadge = `<span class="badge badge-info">${item.statusAbsen.toUpperCase()}</span>`;
      }

      const initials = item.nama
        .split(' ')
        .slice(0, 2)
        .map((n) => n[0])
        .join('');

      const avatarHtml = item.photoUrl
        ? `<img src="${item.photoUrl}" alt="${item.nama}" class="avatar" style="object-fit:cover;" onerror="this.outerHTML='<div class=\\'avatar\\'>${initials}</div>'">`
        : `<div class="avatar">${initials}</div>`;

      return `
      <tr>
        <td>
          <div class="intern-profile">
            ${avatarHtml}
            <div class="intern-info">
              <div class="name">${item.nama}</div>
              <div class="sub">${item.posisi || '-'} • ${item.kampus || '-'}</div>
            </div>
          </div>
        </td>
        <td>
          <div><strong>${item.phone || '<em style="color:#f87171">Belum ada WA</em>'}</strong></div>
          <div style="font-size:0.75rem; color:#60a5fa">${item.email || '<em style="color:var(--text-muted)">Email belum diset</em>'}</div>
          <div style="font-size:0.75rem; color:var(--text-muted)">Mentor: ${item.pembimbing || '-'}</div>
        </td>
        <td>${statusBadge}</td>
        <td>
          <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; font-weight: 500;">
            ${item.jamAbsen || '-'}
          </span>
          ${item.keterangan && item.statusAbsen === 'izin' ? `<div style="font-size:0.7rem; color:var(--text-muted); max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${item.keterangan}">${item.keterangan}</div>` : ''}
        </td>
        <td>
          <span style="font-size: 0.8rem; color: ${item.reminderCount > 0 ? '#34d399' : 'var(--text-muted)'};">
            ${item.reminderCount > 0 ? `Terkirim (${item.reminderCount}x)` : 'Belum'}
          </span>
        </td>
        <td>
          <div class="action-buttons">
            ${
              item.statusAbsen === 'belum_absen'
                ? `
                <a href="${item.directWaLink}" target="_blank" class="btn btn-whatsapp btn-sm" title="Buka WhatsApp Langsung">
                  💬 Chat WA
                </a>
                <button class="btn btn-primary btn-sm" onclick="handleSendSingleReminder('${item.id}')" title="Kirim Reminder Otomatis">
                  ⚡ Kirim
                </button>
              `
                : `
                <a href="${item.directWaLink}" target="_blank" class="btn btn-secondary btn-sm" title="Kirim Pesan WA">
                  💬 Chat
                </a>
              `
            }
            <button class="btn btn-secondary btn-sm" onclick="openDailyLogsModal('${item.id}')" title="Lihat Logbook Harian Peserta" style="border-color: rgba(96, 165, 250, 0.4); color: #93c5fd;">
              📖 Logbook
            </button>
            <button class="btn btn-secondary btn-sm btn-icon" onclick="openEditModal('${item.id}')" title="Edit Data & Kontak">
              ✏️
            </button>
          </div>
        </td>
      </tr>
    `;
    })
    .join('');
}

// 3. Load & Populate Configuration
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const json = await res.json();
    if (json.success && json.data) {
      state.config = json.data;
      populateConfigForms(json.data);
    }
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

function populateConfigForms(config) {
  // Kemnaker Form
  if (config.kemnaker) {
    const emailInput = document.getElementById('kemnaker-email');
    if (emailInput) emailInput.value = config.kemnaker.email || '';

    const headlessCheck = document.getElementById('kemnaker-headless');
    if (headlessCheck) headlessCheck.checked = !!config.kemnaker.headless;

    const tokenInput = document.getElementById('kemnaker-bearer-token');
    if (tokenInput && config.kemnaker.bearerToken) tokenInput.value = config.kemnaker.bearerToken;
  }

  // WhatsApp Form
  if (config.whatsapp) {
    const providerSelect = document.getElementById('wa-provider');
    if (providerSelect) providerSelect.value = config.whatsapp.provider || 'simulation';

    const fonnteInput = document.getElementById('wa-fonnte-token');
    if (fonnteInput) fonnteInput.value = config.whatsapp.fonnteToken || '';

    const wablasInput = document.getElementById('wa-wablas-token');
    if (wablasInput) wablasInput.value = config.whatsapp.wablasToken || '';

    const deadlineInput = document.getElementById('wa-deadline-time');
    if (deadlineInput) deadlineInput.value = config.whatsapp.deadlineTime || '10:00';

    const templateInput = document.getElementById('wa-template-input');
    if (templateInput) templateInput.value = config.whatsapp.template || '';

    const adminPhoneInput = document.getElementById('wa-admin-phone');
    if (adminPhoneInput) adminPhoneInput.value = config.whatsapp.adminTestPhone || '';

    updateWaPreview();
  }

  // Scheduler Form
  if (config.scheduler) {
    const timeInput = document.getElementById('scheduler-time');
    if (timeInput) timeInput.value = config.scheduler.time || '09:00';

    const enabledCheck = document.getElementById('scheduler-enabled');
    if (enabledCheck) enabledCheck.checked = !!config.scheduler.enabled;

    const days = config.scheduler.activeDays || [];
    document.querySelectorAll('input[name="active-days"]').forEach((cb) => {
      cb.checked = days.includes(cb.value);
    });
  }
}

// 4. Update WhatsApp Bubble Live Preview
function updateWaPreview() {
  const template = document.getElementById('wa-template-input')?.value || '';
  const deadline = document.getElementById('wa-deadline-time')?.value || '10:00';

  const sampleIntern = {
    nama: 'Dimas Arya Pratama',
    posisi: 'Fullstack Developer Intern',
    kampus: 'Universitas Indonesia',
    pembimbing: 'Rian Kusuma'
  };

  const now = new Date();
  const dateFormatted = now.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  let formatted = template
    .replace(/{nama}/g, sampleIntern.nama)
    .replace(/{tanggal}/g, dateFormatted)
    .replace(/{jam}/g, '09:00')
    .replace(/{posisi}/g, sampleIntern.posisi)
    .replace(/{kampus}/g, sampleIntern.kampus)
    .replace(/{deadline}/g, deadline)
    .replace(/{link_absen}/g, 'https://monev.maganghub.kemnaker.go.id/dashboard/peserta');

  const previewEl = document.getElementById('wa-preview-text');
  if (previewEl) {
    previewEl.textContent = formatted;
  }
}

// 5. Actions Handlers
async function handleSyncKemnaker() {
  showToast('Memulai sinkronisasi data presensi dari Kemnaker...', 'info');
  try {
    const res = await fetch('/api/kemnaker/sync', { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      showToast('Presensi Kemnaker berhasil disinkronkan!', 'success');
      await loadAllData();
    } else {
      showToast('Sinkronisasi gagal: ' + (json.error || 'Periksa koneksi'), 'error');
    }
  } catch (err) {
    showToast('Error sinkronisasi: ' + err.message, 'error');
  }
}

async function handleBrowserLogin(e) {
  e.preventDefault();
  const email = document.getElementById('kemnaker-email').value;
  const password = document.getElementById('kemnaker-password').value;
  const headless = document.getElementById('kemnaker-headless').checked;

  if (!email || !password) {
    showToast('Harap masukkan email dan password Kemnaker.', 'error');
    return;
  }

  showToast('Menjalankan proses login otomatis via browser...', 'info');
  try {
    const res = await fetch('/api/kemnaker/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, headless })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Berhasil login ke Kemnaker Monev MagangHub!', 'success');
      await loadAllData();
    } else {
      showToast('Login gagal: ' + (json.error || 'Periksa kredensial'), 'error');
    }
  } catch (err) {
    showToast('Error login browser: ' + err.message, 'error');
  }
}

async function handleSaveToken(e) {
  e.preventDefault();
  const token = document.getElementById('kemnaker-bearer-token').value;
  if (!token) return;

  try {
    const res = await fetch('/api/kemnaker/set-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Bearer Token berhasil disimpan!', 'success');
      await loadAllData();
    } else {
      showToast(json.error || 'Gagal menyimpan token', 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

async function handleSaveWaConfig(e) {
  e.preventDefault();
  if (!state.config) return;

  state.config.whatsapp = {
    ...state.config.whatsapp,
    provider: document.getElementById('wa-provider').value,
    fonnteToken: document.getElementById('wa-fonnte-token').value,
    wablasToken: document.getElementById('wa-wablas-token').value,
    deadlineTime: document.getElementById('wa-deadline-time').value,
    template: document.getElementById('wa-template-input').value,
    adminTestPhone: document.getElementById('wa-admin-phone').value
  };

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.config)
    });
    const json = await res.json();
    if (json.success) {
      showToast('Pengaturan WhatsApp berhasil disimpan!', 'success');
      loadStatus();
      loadLogs();
    }
  } catch (err) {
    showToast('Gagal menyimpan: ' + err.message, 'error');
  }
}

async function handleSaveScheduler(e) {
  e.preventDefault();
  if (!state.config) return;

  const activeDays = [];
  document.querySelectorAll('input[name="active-days"]:checked').forEach((cb) => {
    activeDays.push(cb.value);
  });

  state.config.scheduler = {
    ...state.config.scheduler,
    time: document.getElementById('scheduler-time').value,
    enabled: document.getElementById('scheduler-enabled').checked,
    activeDays
  };

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.config)
    });
    const json = await res.json();
    if (json.success) {
      showToast('Jadwal reminder otomatis berhasil diperbarui!', 'success');
      loadStatus();
      loadLogs();
    }
  } catch (err) {
    showToast('Gagal update scheduler: ' + err.message, 'error');
  }
}

async function handleSendAllReminders() {
  const unclocked = state.interns.filter((i) => i.statusAbsen === 'belum_absen');
  if (unclocked.length === 0) {
    showToast('Semua anak magang sudah absen! Tidak ada reminder yang perlu dikirim.', 'info');
    return;
  }

  const confirmMsg = `Kirim WhatsApp reminder ke ${unclocked.length} anak magang yang belum absen sekarang?`;
  if (!confirm(confirmMsg)) return;

  showToast(`Mengirim reminder WhatsApp ke ${unclocked.length} peserta...`, 'info');
  try {
    const res = await fetch('/api/reminder/trigger-all', { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      showToast(`Sukses! ${json.sentCount} reminder WhatsApp terkirim.`, 'success');
      await loadAllData();
    } else {
      showToast('Gagal kirim reminder: ' + (json.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

window.handleSendSingleReminder = async function (id) {
  const intern = state.interns.find((i) => i.id === id);
  if (!intern) return;

  showToast(`Mengirim reminder WhatsApp ke ${intern.nama}...`, 'info');
  try {
    const res = await fetch('/api/reminder/send-single', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ internId: id })
    });
    const json = await res.json();
    if (json.success) {
      showToast(`Reminder WhatsApp berhasil dikirim ke ${intern.nama}!`, 'success');
      await loadAllData();
    } else {
      showToast('Gagal kirim: ' + (json.result?.error || json.error), 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
};

async function handleTestWa() {
  const phone = document.getElementById('wa-admin-phone').value;
  if (!phone) {
    showToast('Harap masukkan nomor WhatsApp admin penguji.', 'error');
    return;
  }

  showToast('Mengirim pesan uji coba ke ' + phone + '...', 'info');
  try {
    const res = await fetch('/api/reminder/test-wa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Pesan uji coba WhatsApp berhasil terkirim!', 'success');
      loadLogs();
    } else {
      showToast('Uji coba gagal: ' + (json.result?.error || 'Periksa token'), 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// 6. Modal Edit Intern
window.openEditModal = function (id) {
  const intern = state.interns.find((i) => i.id === id);
  if (!intern) return;
  state.selectedIntern = intern;

  document.getElementById('edit-intern-id').value = intern.id;
  document.getElementById('edit-intern-name').value = intern.nama;
  document.getElementById('edit-intern-phone').value = intern.phone || '';
  document.getElementById('edit-intern-email').value = intern.email || '';
  document.getElementById('edit-intern-mentor').value = intern.pembimbing || '';
  document.getElementById('edit-intern-status').value = intern.statusAbsen || 'belum_absen';

  document.getElementById('modal-edit-intern').classList.add('active');
};

function closeModal() {
  document.getElementById('modal-edit-intern').classList.remove('active');
  state.selectedIntern = null;
}

// 6b. Modal View Daily Logs (Logbook Harian dari Monev API)
window.openDailyLogsModal = async function (id) {
  const intern = state.interns.find((i) => i.id === id);
  const modal = document.getElementById('modal-daily-logs');
  const title = document.getElementById('logbook-modal-title');
  const content = document.getElementById('logbook-modal-content');

  if (!modal || !content) return;

  const internName = intern ? intern.nama : 'Peserta';
  title.innerHTML = `📖 Logbook Harian: <span style="color: #60a5fa;">${internName}</span>`;
  content.innerHTML = `
    <div style="text-align: center; padding: 40px; color: var(--text-muted);">
      <div style="font-size: 1.5rem; margin-bottom: 8px;">⏳</div>
      Sedang mengambil logbook dari Monev Kemnaker...
    </div>
  `;
  modal.classList.add('active');

  try {
    const res = await fetch(`/api/interns/${id}/daily-logs`);
    const json = await res.json();

    if (!json.success || !json.data || json.data.length === 0) {
      content.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          <div style="font-size: 1.5rem; margin-bottom: 8px;">📝</div>
          Belum ada riwayat logbook harian yang tercatat untuk peserta ini.
        </div>
      `;
      return;
    }

    content.innerHTML = json.data
      .map((log) => {
        const isApproved = log.state === 'APPROVED';
        const badgeState = isApproved
          ? '<span class="badge badge-success" style="font-size:0.7rem;">✓ Disetujui Mentor</span>'
          : `<span class="badge badge-warning" style="font-size:0.7rem;">⏳ ${log.state || 'Menunggu'}</span>`;

        return `
        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 16px; margin-bottom: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">
            <div style="font-weight: 600; color: #93c5fd; font-size: 0.95rem;">
              📅 Tanggal: ${log.date}
            </div>
            <div>${badgeState}</div>
          </div>
          
          <div style="margin-bottom: 10px;">
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 4px;">
              💼 Aktivitas / Kegiatan:
            </div>
            <div style="font-size: 0.85rem; line-height: 1.5; color: var(--text-primary); white-space: pre-wrap;">
              ${log.activity_log || '-'}
            </div>
          </div>

          ${
            log.lesson_learned
              ? `
            <div style="margin-bottom: 10px; background: rgba(59, 130, 246, 0.05); padding: 8px 12px; border-radius: 6px; border-left: 3px solid #3b82f6;">
              <div style="font-size: 0.75rem; text-transform: uppercase; color: #93c5fd; font-weight: 600; margin-bottom: 2px;">
                💡 Pembelajaran / Lesson Learned:
              </div>
              <div style="font-size: 0.8rem; line-height: 1.4; color: var(--text-secondary);">
                ${log.lesson_learned}
              </div>
            </div>
          `
              : ''
          }

          ${
            log.obstacles
              ? `
            <div style="background: rgba(239, 68, 68, 0.05); padding: 8px 12px; border-radius: 6px; border-left: 3px solid #ef4444;">
              <div style="font-size: 0.75rem; text-transform: uppercase; color: #fca5a5; font-weight: 600; margin-bottom: 2px;">
                ⚠️ Kendala / Hambatan:
              </div>
              <div style="font-size: 0.8rem; line-height: 1.4; color: var(--text-secondary);">
                ${log.obstacles}
              </div>
            </div>
          `
              : ''
          }
        </div>
      `;
      })
      .join('');
  } catch (err) {
    content.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #f87171;">
        Gagal mengambil data logbook: ${err.message}
      </div>
    `;
  }
};

window.closeLogbookModal = function () {
  const modal = document.getElementById('modal-daily-logs');
  if (modal) modal.classList.remove('active');
};


async function handleSaveEditIntern(e) {
  e.preventDefault();
  const id = document.getElementById('edit-intern-id').value;
  const phone = document.getElementById('edit-intern-phone').value;
  const email = document.getElementById('edit-intern-email').value;
  const nama = document.getElementById('edit-intern-name').value;
  const pembimbing = document.getElementById('edit-intern-mentor').value;
  const statusAbsen = document.getElementById('edit-intern-status').value;

  try {
    const res = await fetch(`/api/interns/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, email, nama, pembimbing, statusAbsen })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Data peserta berhasil disimpan!', 'success');
      closeModal();
      await loadInterns();
      await loadStatus();
    } else {
      showToast('Gagal update: ' + json.error, 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// 7. Activity Logs
async function loadLogs() {
  try {
    const res = await fetch('/api/logs');
    const json = await res.json();
    if (json.success) {
      renderLogs(json.data || []);
    }
  } catch (err) {
    console.error('Failed to load logs:', err);
  }
}

function renderLogs(logs) {
  const terminal = document.getElementById('log-terminal-output');
  if (!terminal) return;

  if (logs.length === 0) {
    terminal.innerHTML = '<div style="color:var(--text-muted); padding:10px;">Belum ada log aktivitas.</div>';
    return;
  }

  terminal.innerHTML = logs
    .slice(0, 50)
    .map((log) => {
      const timeStr = new Date(log.timestamp).toLocaleTimeString('id-ID');
      return `
      <div class="log-entry">
        <span class="log-time">[${timeStr}]</span>
        <span class="log-badge ${log.status}">${log.status}</span>
        <span class="log-text">
          <strong>${log.message}</strong>
          ${log.details ? `<div style="font-size:0.72rem; color:var(--text-muted); margin-top:2px;">${log.details}</div>` : ''}
        </span>
      </div>
    `;
    })
    .join('');
}

async function handleClearLogs() {
  if (!confirm('Bersihkan semua riwayat log?')) return;
  try {
    await fetch('/api/logs', { method: 'DELETE' });
    loadLogs();
    showToast('Log aktivitas dibersihkan.', 'info');
  } catch (err) {
    showToast('Gagal membersihkan log: ' + err.message, 'error');
  }
}

// 8. Toast Helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';

  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
