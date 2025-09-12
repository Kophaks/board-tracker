/**
 * app.js — merged, cleaned, and feature-complete version
 * Replace firebaseConfig placeholders with your real keys.
 *
 * Features:
 * - Google Sign-in (popup + redirect fallback)
 * - Firestore realtime listener on artifacts/{appId}/boards
 * - creationDate stored as YYYY-MM-DD; shown as "YYYY / MM / DD"
 * - entryDate using serverTimestamp()
 * - createdBy / updatedBy / updatedAt audit fields
 * - history subcollection writes at boards/{id}/history
 * - Regex search mode, advanced filters (technician, date range)
 * - Tri-state select all for visible rows; selection persists for operations
 * - Export CSV (selected OR visible OR all loaded)
 * - Bulk edit comments (append or overwrite) with history logging
 * - Single-row edit comments modal
 * - Clickable truncated comments cell with view modal
 * - Mobile-friendly responsive table
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  getDocs,
  query,
  orderBy,
  where
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* ----------------- FIREBASE CONFIG (REPLACE) ----------------- */
const firebaseConfig = {
  apiKey: "AIzaSyBAdB_xUyeThPH43D2qwzi0L5gmc8pdh5c",
  authDomain: "board-tracker-646a3.firebaseapp.com",
  projectId: "board-tracker-646a3",
  storageBucket: "board-tracker-646a3.firebasestorage.app",
  messagingSenderId: "74798840513",
  appId: "1:74798840513:web:c8b316f181b7e7e87ff240",
  measurementId: "G-BKJVPNXMME"
};
/* ----------------------------------------------------------- */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// IMPORTANT: set this to match your Firestore collection path / rules
const appId = "default-board-tracker";

/* ----------------- UI refs ----------------- */
const ui = {
  loginBtn: document.getElementById('loginButton'),
  logoutBtn: document.getElementById('logoutButton'),
  userInfo: document.getElementById('user-info'),
  unauthorized: document.getElementById('unauthorized'),

  addSection: document.getElementById('add-board-section'),
  displaySection: document.getElementById('display-section'),

  technician: document.getElementById('technician'),
  boardName: document.getElementById('boardName'),
  quantity: document.getElementById('quantity'),
  dateInput: document.getElementById('dateInput'),
  comments: document.getElementById('comments'),
  addBoardButton: document.getElementById('addBoardButton'),

  searchInput: document.getElementById('searchInput'),
  regexMode: document.getElementById('regexMode'),
  toggleFilters: document.getElementById('toggleFilters'),
  advancedFilters: document.getElementById('advancedFilters'),
  technicianFilter: document.getElementById('technicianFilter'),
  fromDate: document.getElementById('fromDate'),
  toDate: document.getElementById('toDate'),

  selectAll: document.getElementById('selectAll'),
  tableBody: document.getElementById('boardsTableBody'),
  loading: document.getElementById('loading'),
  noResults: document.getElementById('no-results'),
  headers: document.querySelectorAll('[data-sort-by]'),

  exportToggleButton: document.getElementById('exportToggleButton'),

  // edit modal
  editModal: document.getElementById('editModal'),
  modalSerialNumber: document.getElementById('modalSerialNumber'),
  modalComments: document.getElementById('modalComments'),
  saveCommentsButton: document.getElementById('saveCommentsButton'),
  cancelCommentsButton: document.getElementById('cancelCommentsButton'),
  closeModalButton: document.getElementById('closeModalButton'),

  // bulk edit
  bulkModal: document.getElementById('bulkEditModal'),
  bulkComments: document.getElementById('bulkComments'),
  applyBulkButton: document.getElementById('applyBulkButton'),
  cancelBulkButton: document.getElementById('cancelBulkButton'),
  closeBulkModal: document.getElementById('closeBulkModal'),

  // history
  historyModal: document.getElementById('historyModal'),
  historyList: document.getElementById('historyList'),
  closeHistoryButton: document.getElementById('closeHistoryButton'),

  // view comments
  viewCommentsModal: document.getElementById('viewCommentsModal'),
  viewCommentsText: document.getElementById('viewCommentsText'),
  closeViewComments: document.getElementById('closeViewComments')
};

/* ----------------- State ----------------- */
let currentUser = null;
let allBoards = [];
let unsubscribe = null;
let currentSort = { column: 'creationDate', direction: 'desc' };
let selectedIds = new Set();

/* ----------------- Utils ----------------- */
function formatCreationDateToISO(dateObj) {
  // returns YYYY-MM-DD
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function isoToDisplay(isoString) {
  if (!isoString) return '-';
  const parts = String(isoString).split('-');
  if (parts.length === 3) return `${parts[0]} / ${parts[1]} / ${parts[2]}`;
  // fallback:
  try {
    const dt = new Date(isoString);
    return `${dt.getFullYear()} / ${String(dt.getMonth()+1).padStart(2,'0')} / ${String(dt.getDate()).padStart(2,'0')}`;
  } catch {
    return isoString;
  }
}
function escapeCSVCell(val) {
  if (val == null) return '""';
  const s = String(val).replace(/"/g, '""');
  return `"${s}"`;
}
function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ----------------- Auth ----------------- */
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    ui.userInfo.textContent = `Connected | ${user.email}`;
    ui.loginBtn && ui.loginBtn.classList.add('hidden');
    ui.logoutBtn && ui.logoutBtn.classList.remove('hidden');
    ui.addSection && ui.addSection.classList.remove('hidden');
    ui.displaySection && ui.displaySection.classList.remove('hidden');
    startRealtimeListener();
  } else {
    ui.userInfo.textContent = 'Not signed in';
    ui.loginBtn && ui.loginBtn.classList.remove('hidden');
    ui.logoutBtn && ui.logoutBtn.classList.add('hidden');
    ui.addSection && ui.addSection.classList.add('hidden');
    ui.displaySection && ui.displaySection.classList.add('hidden');
    if (unsubscribe) unsubscribe();
    allBoards = [];
    selectedIds.clear();
    render();
  }
});

ui.loginBtn && ui.loginBtn.addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    // fallback to redirect if popup blocked in some environments
    try {
      await signInWithRedirect(auth, provider);
    } catch (e) {
      console.error('Sign-in error:', e);
      alert('Sign-in failed: ' + (e.message || e));
    }
  }
});
ui.logoutBtn && ui.logoutBtn.addEventListener('click', () => signOut(auth));

/* ----------------- Firestore realtime ----------------- */
function startRealtimeListener() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  const col = collection(db, 'artifacts', appId, 'boards');
  const q = query(col, orderBy('creationDate', 'desc'));
  unsubscribe = onSnapshot(q, snapshot => {
    ui.loading && ui.loading.classList.add('hidden');
    allBoards = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    populateTechnicianFilter();
    render();
  }, error => {
    console.error('Realtime error:', error);
    if (error && error.code === 'permission-denied') {
      ui.unauthorized && ui.unauthorized.classList.remove('hidden');
      ui.addSection && ui.addSection.classList.add('hidden');
      ui.displaySection && ui.displaySection.classList.add('hidden');
    } else {
      alert('Failed to load data: ' + (error.message || error));
    }
  });
}

/* ----------------- Add boards ----------------- */
ui.addBoardButton && ui.addBoardButton.addEventListener('click', async () => {
  if (!currentUser) return alert('Sign in required');
  const tech = (ui.technician.value || '').trim();
  const name = (ui.boardName.value || '').trim();
  const qty = Math.max(1, parseInt(ui.quantity.value, 10) || 1);
  const commentText = (ui.comments.value || '').trim() || 'N/A';

  if (!tech || !name) return alert('Please fill Technician and Board Name');

  const selectedDate = ui.dateInput && ui.dateInput.value ? new Date(ui.dateInput.value) : new Date();
  const creationDateIso = formatCreationDateToISO(selectedDate);

  const boardNumberPart = (name.match(/^\d{3}/) || ['000'])[0];

  // compute lastAutonumber (check existing docs for same boardName + creationDate)
  const colRef = collection(db, 'artifacts', appId, 'boards');
  let lastAutonumber = 0;
  try {
    const q = query(colRef, where('boardName', '==', name), where('creationDate', '==', creationDateIso));
    const docs = await getDocs(q);
    docs.forEach(d => {
      const sn = d.data().serialNumber || '';
      const parts = sn.split('-');
      const num = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(num) && num > lastAutonumber) lastAutonumber = num;
    });
  } catch (e) {
    console.warn('Could not determine last autonumber:', e);
  }

  for (let i = 0; i < qty; i++) {
    lastAutonumber++;
    const autonumberPart = String(lastAutonumber).padStart(3, '0');
    const datePart = creationDateIso.slice(2).replace(/-/g,''); // YYMMDD
    const serialNumber = `SN-${datePart}-${boardNumberPart}-${autonumberPart}`;

    const payload = {
      serialNumber,
      boardName: name,
      technician: tech,
      comments: commentText,
      creationDate: creationDateIso,
      entryDate: serverTimestamp(),
      createdBy: currentUser.email,
      updatedBy: currentUser.email,
      updatedAt: serverTimestamp()
    };
    try {
      await addDoc(colRef, payload);
    } catch (e) {
      console.error('addDoc error:', e);
      alert('Failed to add board: ' + (e.message || e));
    }
  }

  // reset form
  ui.technician.value = '';
  ui.boardName.value = '';
  ui.quantity.value = '1';
  ui.dateInput.value = '';
  ui.comments.value = '';
});

/* ----------------- Filters / render ----------------- */
function populateTechnicianFilter() {
  if (!ui.technicianFilter) return;
  const techs = Array.from(new Set(allBoards.map(b => (b.technician || '').trim()).filter(Boolean))).sort();
  const cur = ui.technicianFilter.value;
  ui.technicianFilter.innerHTML = `<option value="">All Technicians</option>` + techs.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  if (cur) ui.technicianFilter.value = cur;
}

function render() {
  const searchTerm = (ui.searchInput && ui.searchInput.value || '').trim();
  const useRegex = ui.regexMode && ui.regexMode.checked;
  const techFilter = ui.technicianFilter && ui.technicianFilter.value || '';
  const from = ui.fromDate && ui.fromDate.value || '';
  const to = ui.toDate && ui.toDate.value || '';

  let filtered = allBoards.filter(b => {
    if (techFilter && (b.technician || '') !== techFilter) return false;
    if (from && (!b.creationDate || b.creationDate < from)) return false;
    if (to && (!b.creationDate || b.creationDate > to)) return false;
    if (!searchTerm) return true;

    const hay = [b.serialNumber, b.boardName, b.technician, b.creationDate, b.comments].map(v => String(v || '')).join(' ');
    if (useRegex) {
      try { return new RegExp(searchTerm, 'i').test(hay); }
      catch (e) { return hay.toLowerCase().includes(searchTerm.toLowerCase()); }
    } else {
      return hay.toLowerCase().includes(searchTerm.toLowerCase());
    }
  });

  filtered.sort((a,b) => {
    const av = String(a[currentSort.column] || '').toLowerCase();
    const bv = String(b[currentSort.column] || '').toLowerCase();
    if (av === bv) return 0;
    const res = av > bv ? 1 : -1;
    return currentSort.direction === 'asc' ? res : -res;
  });

  populateTable(filtered);
  updateSelectAllHeaderState(filtered);
}

/* ----------------- Table populate ----------------- */
function populateTable(boards) {
  ui.tableBody.innerHTML = '';
  if (!boards || boards.length === 0) {
    ui.noResults && ui.noResults.classList.remove('hidden');
    return;
  }
  ui.noResults && ui.noResults.classList.add('hidden');

  const frag = document.createDocumentFragment();
  boards.forEach(b => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50';
    const checked = selectedIds.has(b.id) ? 'checked' : '';
    tr.innerHTML = `
      <td class="px-6 py-4 align-middle">
        <input type="checkbox" class="row-checkbox" data-id="${b.id}" ${checked}/>
      </td>
      <td class="px-6 py-4 text-sm font-medium text-slate-900">${escapeHtml(b.serialNumber)}</td>
      <td class="px-6 py-4 text-sm text-slate-500">${escapeHtml(b.boardName)}</td>
      <td class="px-6 py-4 text-sm text-slate-500">${isoToDisplay(b.creationDate)}</td>
      <td class="px-6 py-4 text-sm text-slate-500">${escapeHtml(b.technician)}</td>
      <td class="px-6 py-4 text-sm text-slate-500">
        <div class="comments-cell max-w-[220px] truncate px-2 py-1 rounded hover:bg-slate-100 cursor-pointer" data-id="${b.id}" title="Click to view full comments">
          ${escapeHtml(b.comments)}
        </div>
        <div class="mt-2 flex gap-2">
          <button class="edit-button text-blue-500 hover:text-blue-700" data-id="${b.id}" title="Edit">✏️</button>
          <button class="history-button text-slate-500 hover:text-slate-700" data-id="${b.id}" title="History">🕒</button>
        </div>
      </td>
    `;
    frag.appendChild(tr);
  });

  ui.tableBody.appendChild(frag);

  // handlers for checkboxes
  ui.tableBody.querySelectorAll('.row-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.getAttribute('data-id');
      if (e.target.checked) selectedIds.add(id); else selectedIds.delete(id);
      updateSelectAllHeaderState();
    });
  });

  // click to view comments
  ui.tableBody.querySelectorAll('.comments-cell').forEach(div => {
    div.addEventListener('click', () => {
      const id = div.getAttribute('data-id');
      const board = allBoards.find(x => x.id === id);
      ui.viewCommentsText.textContent = board ? (board.comments || '') : '(No comments)';
      ui.viewCommentsModal.classList.remove('hidden');
    });
  });

  // edit / history buttons
  ui.tableBody.querySelectorAll('.edit-button').forEach(btn => btn.addEventListener('click', () => openEditModal(btn.dataset.id)));
  ui.tableBody.querySelectorAll('.history-button').forEach(btn => btn.addEventListener('click', () => openHistoryModal(btn.dataset.id)));
}

/* ----------------- Select all header tri-state ----------------- */
ui.selectAll && ui.selectAll.addEventListener('change', () => {
  const visibleBoxes = Array.from(document.querySelectorAll('.row-checkbox'));
  visibleBoxes.forEach(cb => {
    cb.checked = ui.selectAll.checked;
    const id = cb.getAttribute('data-id');
    if (ui.selectAll.checked) selectedIds.add(id); else selectedIds.delete(id);
  });
  updateSelectAllHeaderState();
});

function updateSelectAllHeaderState() {
  const visibleBoxes = Array.from(document.querySelectorAll('.row-checkbox'));
  if (visibleBoxes.length === 0) {
    if (ui.selectAll) { ui.selectAll.checked = false; ui.selectAll.indeterminate = false; }
    return;
  }
  const checkedCount = visibleBoxes.filter(b => b.checked).length;
  if (checkedCount === 0) { ui.selectAll.checked = false; ui.selectAll.indeterminate = false; }
  else if (checkedCount === visibleBoxes.length) { ui.selectAll.checked = true; ui.selectAll.indeterminate = false; }
  else { ui.selectAll.checked = false; ui.selectAll.indeterminate = true; }
}

/* ----------------- Tools Popup (minimal) ----------------- */
let toolsPopup = null;
ui.exportToggleButton && ui.exportToggleButton.addEventListener('click', () => {
  if (toolsPopup) { toolsPopup.remove(); toolsPopup = null; return; }
  toolsPopup = document.createElement('div');
  toolsPopup.className = 'absolute right-6 top-16 bg-white p-3 rounded shadow-lg w-56 z-50';
  toolsPopup.innerHTML = `
    <button id="tool-export-csv" class="w-full text-left px-2 py-2 hover:bg-slate-100">Export CSV (selected/filtered)</button>
    <button id="tool-bulk-edit" class="w-full text-left px-2 py-2 hover:bg-slate-100">Bulk edit comments</button>
  `;
  document.body.appendChild(toolsPopup);

  document.getElementById('tool-export-csv').addEventListener('click', () => { exportCSV(); closeTools(); });
  document.getElementById('tool-bulk-edit').addEventListener('click', () => { openBulkModal(); closeTools(); });

  setTimeout(() => {
    const onDocClick = (ev) => {
      if (!toolsPopup.contains(ev.target) && ev.target !== ui.exportToggleButton) {
        closeTools(); document.removeEventListener('click', onDocClick);
      }
    };
    document.addEventListener('click', onDocClick);
  }, 0);
});
function closeTools() { if (toolsPopup) { toolsPopup.remove(); toolsPopup = null; } }

/* ----------------- Export CSV (offline) ----------------- */
function exportCSV() {
  const visibleIds = Array.from(document.querySelectorAll('.row-checkbox')).map(cb => cb.getAttribute('data-id'));
  let rowsToExport = [];
  if (selectedIds.size > 0) rowsToExport = allBoards.filter(b => selectedIds.has(b.id));
  else if (visibleIds.length > 0) rowsToExport = allBoards.filter(b => visibleIds.includes(b.id));
  else rowsToExport = allBoards.slice();

  if (rowsToExport.length === 0) { alert('No rows to export'); return; }
  const headers = ['serialNumber','boardName','creationDate','technician','comments','createdBy','updatedBy','entryDate'];
  const lines = [headers.map(escapeCSVCell).join(',')];
  for (const r of rowsToExport) {
    const entryDateIso = r.entryDate && r.entryDate.toDate ? r.entryDate.toDate().toISOString() : (r.entryDate || '');
    const row = [
      r.serialNumber || '', r.boardName || '', r.creationDate || '', r.technician || '',
      r.comments || '', r.createdBy || '', r.updatedBy || '', entryDateIso
    ];
    lines.push(row.map(escapeCSVCell).join(','));
  }
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `boards_export_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/* ----------------- Edit single comments ----------------- */
function openEditModal(docId) {
  const board = allBoards.find(b => b.id === docId);
  if (!board) return alert('Record not found');
  ui.modalSerialNumber.value = board.serialNumber || '';
  ui.modalComments.value = board.comments || '';
  ui.saveCommentsButton.dataset.docId = docId;
  ui.editModal.classList.remove('hidden');
}
ui.closeModalButton && ui.closeModalButton.addEventListener('click', () => ui.editModal.classList.add('hidden'));
ui.cancelCommentsButton && ui.cancelCommentsButton.addEventListener('click', () => ui.editModal.classList.add('hidden'));

ui.saveCommentsButton && ui.saveCommentsButton.addEventListener('click', async () => {
  const docId = ui.saveCommentsButton.dataset.docId;
  if (!docId) return;
  if (!currentUser) return alert('Sign in to edit');
  const newComments = ui.modalComments.value || '';
  const boardRef = doc(db, 'artifacts', appId, 'boards', docId);
  const old = allBoards.find(x => x.id === docId)?.comments || '';
  try {
    await updateDoc(boardRef, { comments: newComments, updatedBy: currentUser.email, updatedAt: serverTimestamp() });
    const histCol = collection(db, 'artifacts', appId, 'boards', docId, 'history');
    await addDoc(histCol, { action:'update', field:'comments', oldValue:old, newValue:newComments, by:currentUser.email, at:serverTimestamp() });
    ui.editModal.classList.add('hidden');
  } catch (e) {
    console.error('Update comments failed', e);
    if (e.code === 'permission-denied') alert('Permission denied: cannot update comments / history. Check rules.');
    else alert('Failed to update: ' + (e.message || e));
  }
});

/* ----------------- Bulk edit comments ----------------- */
function openBulkModal() { ui.bulkModal.classList.remove('hidden'); }
ui.closeBulkModal && ui.closeBulkModal.addEventListener('click', () => ui.bulkModal.classList.add('hidden'));
ui.cancelBulkButton && ui.cancelBulkButton.addEventListener('click', () => ui.bulkModal.classList.add('hidden'));

ui.applyBulkButton && ui.applyBulkButton.addEventListener('click', async () => {
  if (!currentUser) return alert('Sign in required');
  const text = (ui.bulkComments.value || '').trim();
  if (!text) return alert('Enter comment text to apply');
  const mode = (document.querySelector('input[name="bulkMode"]:checked') || { value: 'append' }).value;
  const ids = Array.from(selectedIds);
  if (ids.length === 0) return alert('No rows selected');

  for (const id of ids) {
    const board = allBoards.find(b => b.id === id) || {};
    const old = board.comments || '';
    const newVal = mode === 'append' ? (old ? `${old}\n${text}` : text) : text;
    const boardRef = doc(db, 'artifacts', appId, 'boards', id);
    try {
      await updateDoc(boardRef, { comments: newVal, updatedBy: currentUser.email, updatedAt: serverTimestamp() });
      const histCol = collection(db, 'artifacts', appId, 'boards', id, 'history');
      await addDoc(histCol, { action:'bulk-update', field:'comments', oldValue:old, newValue:newVal, by:currentUser.email, at:serverTimestamp() });
    } catch (e) {
      console.error('Bulk update error for', id, e);
      // continue
    }
  }
  ui.bulkComments.value = ''; ui.bulkModal.classList.add('hidden');
  clearSelection();
});

/* ----------------- History view ----------------- */
async function openHistoryModal(docId) {
  ui.historyList.innerHTML = '<li>Loading history...</li>';
  ui.historyModal.classList.remove('hidden');
  try {
    const histCol = collection(db, 'artifacts', appId, 'boards', docId, 'history');
    const q = query(histCol, orderBy('at', 'desc'));
    const snap = await getDocs(q);
    if (snap.empty) { ui.historyList.innerHTML = '<li>No history entries</li>'; return; }
    const lines = [];
    snap.forEach(d => {
      const h = d.data();
      const when = h.at && h.at.toDate ? h.at.toDate().toLocaleString() : '-';
      lines.push(`<li><strong>${escapeHtml(h.by || '-')}</strong> ${escapeHtml(h.action || 'updated')} <em>${escapeHtml(h.field || '')}</em> at ${escapeHtml(when)}<div class="text-xs mt-1">Old: ${escapeHtml(h.oldValue || '')} | New: ${escapeHtml(h.newValue || '')}</div></li>`);
    });
    ui.historyList.innerHTML = lines.join('');
  } catch (e) {
    console.error('History load failed', e);
    if (e.code === 'permission-denied') ui.historyList.innerHTML = '<li class="text-red-600">Missing permissions to read history.</li>';
    else ui.historyList.innerHTML = `<li class="text-red-600">Failed to load history: ${escapeHtml(e.message || e)}</li>`;
  }
}
ui.closeHistoryButton && ui.closeHistoryButton.addEventListener('click', () => ui.historyModal.classList.add('hidden'));

/* ----------------- Helpers ----------------- */
function clearSelection() {
  selectedIds.clear();
  document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = false);
  updateSelectAllHeaderState();
}

/* ----------------- Sorting hooks ----------------- */
ui.headers.forEach(h => {
  h.addEventListener('click', () => {
    const col = h.dataset.sortBy;
    if (!col) return;
    if (currentSort.column === col) currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    else { currentSort.column = col; currentSort.direction = 'asc'; }
    render();
  });
});

/* ----------------- Search & filters wiring ----------------- */
ui.searchInput && ui.searchInput.addEventListener('input', () => { selectedIds.clear(); render(); });
ui.regexMode && ui.regexMode.addEventListener('change', () => { selectedIds.clear(); render(); });
ui.toggleFilters && ui.toggleFilters.addEventListener('click', () => ui.advancedFilters.classList.toggle('hidden'));
ui.technicianFilter && ui.technicianFilter.addEventListener('change', () => { selectedIds.clear(); render(); });
ui.fromDate && ui.fromDate.addEventListener('change', () => { selectedIds.clear(); render(); });
ui.toDate && ui.toDate.addEventListener('change', () => { selectedIds.clear(); render(); });

console.log('app.js (merged) loaded — make sure firebaseConfig and appId match your project');
