// ============================================================
//  CONFIG — ここを自分の値に書き換えてください
// ============================================================
const CONFIG = {
  CLIENT_ID: '310911047336-ulds9lmrrl9f1u8udg7g32892f10q61q.apps.googleusercontent.com',          // Google Cloud ConsoleのOAuth 2.0クライアントID
  API_KEY:   'AIzaSyBqEcxCYAMEJiP9F2Yx0kXOM5mNTxq1jnM',             // Google Cloud ConsoleのAPIキー
  FOLDER_ID: '1Uvq0uyl39XwLz2H43uR2Iq4B9290e6-r', // Google DriveのフォルダID
  DATA_FILE:   'ideaNote_data.json',
  BACKUP_FILE: 'ideaNote_backup_{DATE}.json',
  BACKUP_INTERVAL_MS: 7 * 24 * 60 * 60 * 1000,  // 7日
  SCOPES: 'https://www.googleapis.com/auth/drive.file',
};

// ============================================================
//  State
// ============================================================
let ideas        = [];
let editingId    = null;
let currentFilter = 'all';
let tokenClient  = null;
let gapiInited   = false;
let gsiInited    = false;
let driveFileId  = null;  // Google Drive上のデータファイルID
let isSignedIn   = false;

// ============================================================
//  Init
// ============================================================
window.addEventListener('load', () => {
  loadLocal();
  renderTable();
  renderStats();
  initGoogleAPIs();
  scheduleWeeklyBackup();
});

// ============================================================
//  Google API init
// ============================================================
function initGoogleAPIs() {
  gapi.load('client', async () => {
    await gapi.client.init({
      apiKey: CONFIG.API_KEY,
      discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
    });
    gapiInited = true;
    maybeEnableAuth();
  });

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: onTokenReceived,
  });
  gsiInited = true;
  maybeEnableAuth();
}

function maybeEnableAuth() {
  if (gapiInited && gsiInited) {
    document.getElementById('auth-btn').disabled = false;
    // 保存済みトークンがあれば自動復元
    const saved = localStorage.getItem('gToken');
    if (saved) {
      try {
        const { token, expiry } = JSON.parse(saved);
        if (Date.now() < expiry) {
          gapi.client.setToken(token);
          isSignedIn = true;
          updateAuthUI();
          setSyncStatus('syncing', '同期中...');
          loadFromDrive().then(() => {
            setSyncStatus('connected', 'Google Drive接続済み');
          });
        } else {
          localStorage.removeItem('gToken'); // 期限切れ削除
        }
      } catch(e) {
        localStorage.removeItem('gToken');
      }
    }
  }
}

function handleAuth() {
  if (isSignedIn) {
    signOut();
  } else {
    tokenClient.requestAccessToken({ prompt: 'consent' });
  }
}

async function onTokenReceived(response) {
  if (response.error) {
    showToast('認証エラー: ' + response.error, 'error');
    return;
  }
  isSignedIn = true;
  // トークンをlocalStorageに保存
  localStorage.setItem('gToken', JSON.stringify({
    token: gapi.client.getToken(),
    expiry: Date.now() + 3500 * 1000
  }));
  updateAuthUI();
  setSyncStatus('syncing', '同期中...');
  await loadFromDrive();
  setSyncStatus('connected', 'Google Drive接続済み');
  showToast('✅ Google Driveに接続しました', 'success');
}

function signOut() {
  google.accounts.oauth2.revoke(gapi.client.getToken().access_token, () => {
    gapi.client.setToken(null);
    localStorage.removeItem('gToken');
    isSignedIn = false;
    driveFileId = null;
    updateAuthUI();
    setSyncStatus('', '未接続');
    showToast('サインアウトしました', 'info');
  });
}

function updateAuthUI() {
  const btn = document.getElementById('auth-btn');
  btn.textContent = isSignedIn ? 'サインアウト' : '';
  if (!isSignedIn) {
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 18 18">
        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
        <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/>
      </svg>
      Googleでログイン`;
  }
}

// ============================================================
//  Drive: Load
// ============================================================
async function loadFromDrive() {
  try {
    const res = await gapi.client.drive.files.list({
      q: `'${CONFIG.FOLDER_ID}' in parents and name='${CONFIG.DATA_FILE}' and trashed=false`,
      fields: 'files(id, name)',
    });
    const files = res.result.files;
    if (files && files.length > 0) {
      driveFileId = files[0].id;
      const content = await downloadFile(driveFileId);
      ideas = JSON.parse(content);
      saveLocal();
      renderTable();
      renderStats();
    } else {
      // 初回: ローカルデータをアップロード
      await saveToDrive();
    }
  } catch (e) {
    console.error(e);
    showToast('Drive読込エラー。ローカルデータを使用します', 'error');
  }
}

async function downloadFile(fileId) {
  const res = await gapi.client.drive.files.get({
    fileId,
    alt: 'media',
  });
  return typeof res.body === 'string' ? res.body : JSON.stringify(res.result);
}

// ============================================================
//  Drive: Save
// ============================================================
async function saveToDrive() {
  if (!isSignedIn) return;
  setSyncStatus('syncing', '保存中...');
  try {
    const content = JSON.stringify(ideas, null, 2);
    const blob = new Blob([content], { type: 'application/json' });

    if (driveFileId) {
      // 更新
      await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + gapi.client.getToken().access_token,
          'Content-Type': 'application/json',
        },
        body: content,
      });
    } else {
      // 新規作成
      const metadata = { name: CONFIG.DATA_FILE, parents: [CONFIG.FOLDER_ID] };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', blob);
      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + gapi.client.getToken().access_token },
        body: form,
      });
      const data = await res.json();
      driveFileId = data.id;
    }
    setSyncStatus('connected', '同期済み ' + nowStr());
  } catch (e) {
    console.error(e);
    setSyncStatus('error', '保存エラー');
    showToast('Drive保存エラー', 'error');
  }
}

// ============================================================
//  Backup
// ============================================================
async function manualBackup() {
  await doBackup();
}

async function doBackup() {
  if (!isSignedIn) {
    showToast('バックアップにはGoogle Driveへのログインが必要です', 'info');
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  const filename = CONFIG.BACKUP_FILE.replace('{DATE}', date);
  const content = JSON.stringify({ backup_date: new Date().toISOString(), ideas }, null, 2);
  try {
    const metadata = { name: filename, parents: [CONFIG.FOLDER_ID] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([content], { type: 'application/json' }));
    await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + gapi.client.getToken().access_token },
      body: form,
    });
    localStorage.setItem('lastBackup', Date.now().toString());
    showToast('✅ バックアップ完了: ' + filename, 'success');
  } catch (e) {
    showToast('バックアップ失敗', 'error');
  }
}

function scheduleWeeklyBackup() {
  const last = parseInt(localStorage.getItem('lastBackup') || '0');
  const diff = Date.now() - last;
  if (diff >= CONFIG.BACKUP_INTERVAL_MS) {
    // 少し遅延して実行（ログイン後に実行されるよう）
    setTimeout(() => {
      if (isSignedIn) doBackup();
    }, 5000);
  }
  // 次回チェックを1時間後に
  setTimeout(scheduleWeeklyBackup, 60 * 60 * 1000);
}

// ============================================================
//  Local Storage
// ============================================================
function saveLocal() {
  localStorage.setItem('ideaNoteData', JSON.stringify(ideas));
}

function loadLocal() {
  const raw = localStorage.getItem('ideaNoteData');
  if (raw) {
    try { ideas = JSON.parse(raw); } catch(e) { ideas = []; }
  }
}

// ============================================================
//  CRUD
// ============================================================
function openModal(id = null) {
  editingId = id;
  document.getElementById('modal-title').textContent = id ? 'アイデアを編集' : 'アイデアを追加';
  if (id) {
    const idea = ideas.find(i => i.id === id);
    document.getElementById('input-title').value    = idea.title    || '';
    document.getElementById('input-problem').value  = idea.problem  || '';
    document.getElementById('input-solution').value = idea.solution || '';
    document.getElementById('input-memo').value     = idea.memo     || '';
    document.getElementById('input-status').value   = idea.status   || '未対応';
  } else {
    ['title','problem','solution','memo'].forEach(f =>
      document.getElementById('input-'+f).value = '');
    document.getElementById('input-status').value = '未対応';
  }
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('input-title').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  editingId = null;
}

function closeModalOutside(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

async function saveIdea() {
  const title    = document.getElementById('input-title').value.trim();
  const problem  = document.getElementById('input-problem').value.trim();
  const solution = document.getElementById('input-solution').value.trim();
  const memo     = document.getElementById('input-memo').value.trim();

  const idea = {
    id:        editingId || Date.now().toString(),
    title,
    problem,
    solution,
    memo,
    status:    document.getElementById('input-status').value,
    date:      editingId ? ideas.find(i=>i.id===editingId).date : new Date().toLocaleDateString('ja-JP'),
    updatedAt: new Date().toISOString(),
  };

  if (editingId) {
    const idx = ideas.findIndex(i => i.id === editingId);
    ideas[idx] = idea;
    showToast('✏️ 更新しました', 'success');
  } else {
    ideas.unshift(idea);
    showToast('💡 アイデアを追加しました', 'success');
  }

  saveLocal();
  renderTable();
  renderStats();
  closeModal();
  await saveToDrive();
}

async function deleteIdea(id) {
  if (!confirm('このアイデアを削除しますか？')) return;
  ideas = ideas.filter(i => i.id !== id);
  saveLocal();
  renderTable();
  renderStats();
  showToast('🗑️ 削除しました');
  await saveToDrive();
}

// ============================================================
//  Render
// ============================================================
let currentSearchQuery = '';

function renderTable() {
  const tbody = document.getElementById('idea-tbody');
  const empty = document.getElementById('empty-state');
  const table = document.getElementById('idea-table');

  // カード用コンテナを動的生成（なければ作る）
  let cardsEl = document.getElementById('idea-tbody-cards');
  if (!cardsEl) {
    cardsEl = document.createElement('div');
    cardsEl.id = 'idea-tbody-cards';
    table.parentNode.insertBefore(cardsEl, table.nextSibling);
  }

  let filtered = ideas.filter(idea => {
    const matchFilter = currentFilter === 'all' || idea.status === currentFilter;
    const q = currentSearchQuery.toLowerCase();
    const matchSearch = !q || [idea.problem, idea.solution, idea.effect, idea.memo]
      .some(f => f && f.toLowerCase().includes(q));
    return matchFilter && matchSearch;
  });

  if (filtered.length === 0) {
    table.style.display = 'none';
    cardsEl.style.display = 'none';
    empty.style.display = 'block';
  } else {
    table.style.display = '';
    cardsEl.style.display = '';
    empty.style.display = 'none';
  }

 // テーブル行
  tbody.innerHTML = filtered.map((idea, idx) => `
    <tr>
      <td class="num">${idx + 1}</td>
      <td class="cell-problem">${esc(idea.title)}</td>
      <td>${esc(idea.problem)}</td>
      <td>${esc(idea.solution)}</td>
      <td class="cell-memo">${esc(idea.memo)}</td>
      <td><span class="status-badge status-${idea.status}">${idea.status}</span></td>
      <td class="cell-date">${idea.date || ''}</td>
      <td>
        <div class="action-cell">
          <button class="btn-icon" onclick="openModal('${idea.id}')" title="編集">✏️</button>
          <button class="btn-icon" onclick="deleteIdea('${idea.id}')" title="削除">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');

  // スマホ用カード（アイデア名のみ表示）
  cardsEl.innerHTML = filtered.map(idea => `
    <div class="idea-card" onclick="openModal('${idea.id}')">
      <div class="card-header">
        <div class="card-problem">${esc(idea.title) || '（アイデア名未入力）'}</div>
        <span class="status-badge status-${idea.status}">${idea.status}</span>
      </div>
      <div class="card-footer">
        <span style="font-size:12px;color:var(--text-muted)">${idea.date || ''}</span>
        <div class="action-cell">
          <button class="btn-icon" onclick="event.stopPropagation();openModal('${idea.id}')">✏️</button>
          <button class="btn-icon" onclick="event.stopPropagation();deleteIdea('${idea.id}')">🗑️</button>
        </div>
      </div>
    </div>
  `).join('');
function renderStats() {
  const total    = ideas.length;
  const pending  = ideas.filter(i => i.status === '未対応').length;
  const inprog   = ideas.filter(i => i.status === '対応中').length;
  const done     = ideas.filter(i => i.status === '完了').length;
  document.getElementById('stats-bar').innerHTML = `
    <span class="stat-item">合計 <span class="stat-badge">${total}</span></span>
    <span class="stat-item">未対応 <span class="stat-badge" style="background:#dc2626">${pending}</span></span>
    <span class="stat-item">対応中 <span class="stat-badge" style="background:#d97706">${inprog}</span></span>
    <span class="stat-item">完了 <span class="stat-badge" style="background:#059669">${done}</span></span>
  `;
}

// ============================================================
//  Filter & Search
// ============================================================
function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTable();
}

function filterCards() {
  currentSearchQuery = document.getElementById('search-input').value;
  renderTable();
}

// ============================================================
//  Helpers
// ============================================================
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function nowStr() {
  return new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

function setSyncStatus(type, text) {
  const dot = document.getElementById('sync-dot');
  const txt = document.getElementById('sync-text');
  dot.className = 'sync-dot' + (type ? ' ' + type : '');
  txt.textContent = text;
}

let toastTimer;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
