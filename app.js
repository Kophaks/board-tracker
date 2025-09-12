/**
 * app.js
 * Full client logic for Board Production Tracker
 *
 * Requirements:
 *  - index.html must include:
 *    - elements and IDs used below (see the last index.html you received)
 *    - <script type="module" src="app.js"></script>
 *
 * Replace firebaseConfig with your actual project values.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
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
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* ===========================
   Configuration (REPLACE)
   =========================== */
const firebaseConfig = {
  apiKey: "AIzaSyBAdB_xUyeThPH43D2qwzi0L5gmc8pdh5c",

  authDomain: "board-tracker-646a3.firebaseapp.com",

  projectId: "board-tracker-646a3",

  storageBucket: "board-tracker-646a3.firebasestorage.app",

  messagingSenderId: "74798840513",

  appId: "1:74798840513:web:c8b316f181b7e7e87ff240",

  measurementId: "G-BKJVPNXMME"

};
/* ===========================
   End config
   =========================== */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const appId = "default-board-tracker";
const boardsCollection = collection(db, "artifacts", appId, "boards");

/* ---------------------------
   UI references
   --------------------------- */
const ui = {
  loginBtn: document.getElementById("loginButton"),
  logoutBtn: document.getElementById("logoutButton"),
  userInfo: document.getElementById("user-info"),
  unauthorized: document.getElementById("unauthorized"),

  addSection: document.getElementById("add-board-section"),
  displaySection: document.getElementById("display-section"),

  // form elements
  technician: document.getElementById("technician"),
  boardName: document.getElementById("boardName"),
  quantity: document.getElementById("quantity"),
  dateInput: document.getElementById("dateInput"),
  comments: document.getElementById("comments"),
  addBtn: document.getElementById("addBoardButton"),

  // table + filters
  searchInput: document.getElementById("searchInput"),
  regexMode: document.getElementById("regexMode"),
  toggleFilters: document.getElementById("toggleFilters"),
  advancedFilters: document.getElementById("advancedFilters"),
  technicianFilter: document.getElementById("technicianFilter"),
  fromDate: document.getElementById("fromDate"),
  toDate: document.getElementById("toDate"),
  selectAllHeader: document.getElementById("selectAll"),
  tableBody: document.getElementById("boardsTableBody"),
  loading: document.getElementById("loading"),
  noResults: document.getElementById("no-results"),
  headers: document.querySelectorAll("[data-sort-by]"),

  // tools
  exportToggleButton: document.getElementById("exportToggleButton"),

  // edit modal
  editModal: document.getElementById("editModal"),
  modalSerial: document.getElementById("modalSerialNumber"),
  modalComments: document.getElementById("modalComments"),
  saveCommentsButton: document.getElementById("saveCommentsButton"),
  cancelCommentsButton: document.getElementById("cancelCommentsButton"),
  closeModalButton: document.getElementById("closeModalButton"),

  // bulk modal
  bulkEditModal: document.getElementById("bulkEditModal"),
  bulkComments: document.getElementById("bulkComments"),
  applyBulkButton: document.getElementById("applyBulkButton"),
  cancelBulkButton: document.getElementById("cancelBulkButton"),
  closeBulkModal: document.getElementById("closeBulkModal"),

  // history modal
  historyModal: document.getElementById("historyModal"),
  historyList: document.getElementById("historyList"),
  closeHistoryButton: document.getElementById("closeHistoryButton"),
};

/* ---------------------------
   State
   --------------------------- */
let currentUser = null;
let allBoards = []; // live copy from Firestore
let currentSort = { column: "creationDate", direction: "desc" }; // default sort
let selectedIds = new Set(); // selected rows for export / bulk edit

/* ===========================
   Helpers
   =========================== */

function formatToSlashYMD(isoDate) {
  // isoDate expected 'YYYY-MM-DD' or Date object
  if (!isoDate) return "-";
  if (isoDate instanceof Date) {
    const y = isoDate.getFullYear();
    const m = String(isoDate.getMonth() + 1).padStart(2, "0");
    const d = String(isoDate.getDate()).padStart(2, "0");
    return `${y} / ${m} / ${d}`;
  }
  // if string 'YYYY-MM-DD' convert
  const parts = String(isoDate).split("-");
  if (parts.length >= 3) {
    return `${parts[0]} / ${parts[1]} / ${parts[2]}`;
  }
  return isoDate;
}

function escapeCSV(s) {
  if (s == null) return '""';
  const str = String(s).replace(/"/g, '""');
  return `"${str}"`;
}

function showElement(el) { el && el.classList.remove("hidden"); }
function hideElement(el) { el && el.classList.add("hidden"); }

/* ===========================
   AUTH
   =========================== */

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    ui.userInfo.textContent = `Connected | ${user.email}`;
    ui.loginBtn.classList.add("hidden");
    ui.logoutBtn.classList.remove("hidden");
    ui.unauthorized.classList.add("hidden");
    startListening();
  } else {
    ui.userInfo.textContent = "Not signed in";
    ui.loginBtn.classList.remove("hidden");
    ui.logoutBtn.classList.add("hidden");
    hideElement(ui.addSection);
    hideElement(ui.displaySection);
    hideElement(ui.advancedFilters);
    hideElement(ui.unauthorized);
    allBoards = [];
    selectedIds.clear();
    render(); // clears table
  }
});

ui.loginBtn.addEventListener("click", async () => {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.warn("Popup failed:", err);
    if (err.code === "auth/operation-not-supported-in-this-environment") {
      const provider = new GoogleAuthProvider();
      await signInWithRedirect(auth, provider);
    } else {
      alert("Login failed: " + err.message);
    }
  }
});
getRedirectResult(auth).catch(err => console.warn("Redirect result error:", err));
ui.logoutBtn.addEventListener("click", () => signOut(auth));

/* ===========================
   FIRESTORE LISTENER
   =========================== */

let unsubscribeBoards = null;

function startListening() {
  // detach previous
  if (unsubscribeBoards) unsubscribeBoards();

  // Query ordering by creationDate (string 'YYYY-MM-DD') desc
  const q = query(boardsCollection, orderBy("creationDate", "desc"));

  unsubscribeBoards = onSnapshot(q, (snapshot) => {
    ui.loading.classList.add("hidden");
    allBoards = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    // show main UI
    showElement(ui.addSection);
    showElement(ui.displaySection);
    populateTechnicianFilter();
    render();
  }, (err) => {
    console.warn("Snapshot error:", err);
    if (err.code === "permission-denied") {
      ui.unauthorized.classList.remove("hidden");
      hideElement(ui.addSection);
      hideElement(ui.displaySection);
      hideElement(ui.advancedFilters);
    } else {
      alert("Failed to load boards: " + err.message);
    }
  });
}

/* ===========================
   ADD NEW BOARDS
   =========================== */

ui.addBtn.addEventListener("click", async () => {
  if (!currentUser) return alert("Please sign in first.");
  const tech = (ui.technician.value || "").trim();
  const name = (ui.boardName.value || "").trim();
  let qty = parseInt(ui.quantity.value, 10);
  const comm = (ui.comments.value || "").trim() || "N/A";

  if (!tech || !name || isNaN(qty) || qty < 1) {
    return alert("Please fill in Technician, Board Name, and valid Quantity");
  }

  // use chosen production date or today; store as ISO yyyy-mm-dd
  const selected = ui.dateInput.value ? new Date(ui.dateInput.value) : new Date();
  const y = selected.getFullYear();
  const m = String(selected.getMonth() + 1).padStart(2, "0");
  const d = String(selected.getDate()).padStart(2, "0");
  const creationDateString = `${y}-${m}-${d}`;

  // determine board number part like before
  const boardNumberPart = (name.match(/^\d{3}/) || ["000"])[0];

  // when creating multiple, autonumber part needs to reflect existing same-day boards to avoid collisions.
  // For simplicity we'll append increasing numbers starting at 1 for the quantity (won't check DB for existing).
  // If you want guaranteed unique incremental numbers across DB, we'd need to query existing docs and compute last number.
  for (let i = 0; i < qty; i++) {
    const autonumberPart = String(i + 1).padStart(3, "0");
    const serialNumber = `SN-${String(y).slice(-2)}${m}${d}-${boardNumberPart}-${autonumberPart}`;

    const payload = {
      serialNumber,
      boardName: name,
      technician: tech,
      comments: comm,
      creationDate: creationDateString, // shown in UI
      entryDate: serverTimestamp(),
      createdBy: currentUser.email,
      updatedBy: currentUser.email,
      updatedAt: serverTimestamp()
    };

    try {
      await addDoc(boardsCollection, payload);
    } catch (e) {
      console.error("Add doc error:", e);
      alert("Error adding board: " + (e.message || e));
      return;
    }
  }

  // reset form
  ui.technician.value = "";
  ui.boardName.value = "";
  ui.comments.value = "";
  ui.quantity.value = "1";
  ui.dateInput.value = "";
});

/* ===========================
   RENDER / FILTER / SEARCH
   =========================== */

function populateTechnicianFilter() {
  const techs = Array.from(new Set(allBoards.map(b => (b.technician || "").trim()).filter(Boolean))).sort();
  // keep current selection
  const cur = ui.technicianFilter.value;
  ui.technicianFilter.innerHTML = `<option value="">All Technicians</option>` + techs.map(t => `<option value="${escapeHtmlAttr(t)}">${escapeHtml(t)}</option>`).join("");
  if (cur) ui.technicianFilter.value = cur;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeHtmlAttr(s) {
  return String(s || "").replace(/"/g, '&quot;');
}

function render() {
  const queryText = (ui.searchInput.value || "").trim();
  const useRegex = ui.regexMode && ui.regexMode.checked;
  let regex = null;
  if (useRegex && queryText) {
    try {
      regex = new RegExp(queryText, "i");
    } catch (e) {
      // invalid regex -> show alert and fall back to plain search
      console.warn("Invalid regex:", e);
      alert("Invalid regular expression. Please correct it or uncheck Regex mode.");
      return;
    }
  }
  const techFilter = ui.technicianFilter.value || "";
  const from = ui.fromDate.value || "";
  const to = ui.toDate.value || "";

  // filter
  let filtered = allBoards.filter(b => {
    // tech filter
    if (techFilter && (b.technician || "") !== techFilter) return false;
    // date range filter: compare ISO strings (YYYY-MM-DD)
    if (from && (!b.creationDate || b.creationDate < from)) return false;
    if (to && (!b.creationDate || b.creationDate > to)) return false;

    if (!queryText) return true;

    if (regex) {
      // apply regex across a joined string
      const hay = [
        b.serialNumber, b.boardName, b.technician, b.creationDate, b.comments
      ].map(v => String(v || "")).join(" ");
      return regex.test(hay);
    } else {
      const q = queryText.toLowerCase();
      return [
        b.serialNumber, b.boardName, b.technician, b.creationDate, b.comments
      ].some(v => String(v || "").toLowerCase().includes(q));
    }
  });

  // sort
  filtered.sort((a,b) => {
    const av = String(a[currentSort.column] || "").toLowerCase();
    const bv = String(b[currentSort.column] || "").toLowerCase();
    if (av === bv) return 0;
    return currentSort.direction === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  // render
  populateTable(filtered);

  // update selectAll header state
  updateSelectAllHeaderState(filtered);
}

/* ---------------------------
   Table population
   --------------------------- */
function populateTable(boardsToShow) {
  ui.tableBody.innerHTML = "";
  if (!boardsToShow || boardsToShow.length === 0) {
    showElement(ui.noResults);
    return;
  }
  hideElement(ui.noResults);

  const frag = document.createDocumentFragment();
  for (const b of boardsToShow) {
    const tr = document.createElement("tr");
    // responsive: use block rows on small screens (CSS in index.html)
    tr.className = "hover:bg-slate-50";

    const checked = selectedIds.has(b.id) ? "checked" : "";

    // left checkbox column, then rest
    tr.innerHTML = `
      <td class="px-4 py-4 align-middle">
        <input type="checkbox" class="row-select" data-id="${b.id}" ${checked}/>
      </td>
      <td class="px-6 py-4 text-sm font-medium text-slate-900">${escapeHtml(b.serialNumber)}</td>
      <td class="px-6 py-4 text-sm text-slate-500">${escapeHtml(b.boardName)}</td>
      <td class="px-6 py-4 text-sm text-slate-500">${formatToSlashYMD(b.creationDate)}</td>
      <td class="px-6 py-4 text-sm text-slate-500">${escapeHtml(b.technician)}</td>
      <td class="px-6 py-4 text-sm text-slate-500">
        <div class="flex items-center justify-between">
          <span class="truncate pr-2" title="${escapeHtml(b.comments)}">${escapeHtml(b.comments)}</span>
          <div class="flex items-center gap-2">
            <button class="edit-btn text-blue-500 hover:text-blue-700" data-id="${b.id}" title="Edit">✏️</button>
            <button class="history-btn text-slate-500 hover:text-slate-700" data-id="${b.id}" title="History">📜</button>
          </div>
        </div>
      </td>
    `;
    frag.appendChild(tr);
  }
  ui.tableBody.appendChild(frag);

  // attach row checkbox handlers
  ui.tableBody.querySelectorAll(".row-select").forEach(cb => {
    cb.addEventListener("change", (e) => {
      const id = e.target.getAttribute("data-id");
      if (e.target.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      updateSelectAllHeaderState(); // update header state
    });
  });

  // attach edit / history
  ui.tableBody.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => openEditModal(btn.dataset.id));
  });
  ui.tableBody.querySelectorAll(".history-btn").forEach(btn => {
    btn.addEventListener("click", () => openHistoryModal(btn.dataset.id));
  });
}

/* ===========================
   Select-all header logic & Tools menu actions
   =========================== */

// header checkbox basic behavior: toggles selecting visible rows
ui.selectAllHeader.addEventListener("click", (e) => {
  // default action: if header currently unchecked -> select visible rows
  const header = ui.selectAllHeader;
  // But we'll provide Tools menu for other modes; here basic toggle:
  const visibleCheckboxes = Array.from(document.querySelectorAll(".row-select"));
  const anyUnchecked = visibleCheckboxes.some(cb => !cb.checked);
  if (anyUnchecked) {
    // select all visible
    visibleCheckboxes.forEach(cb => {
      cb.checked = true;
      selectedIds.add(cb.getAttribute("data-id"));
    });
  } else {
    // clear visible selection
    visibleCheckboxes.forEach(cb => {
      cb.checked = false;
      selectedIds.delete(cb.getAttribute("data-id"));
    });
  }
  updateSelectAllHeaderState();
});

function updateSelectAllHeaderState(filteredList) {
  // Determine header checkbox state:
  // If no rows are shown, uncheck.
  const visibleCheckboxes = Array.from(document.querySelectorAll(".row-select"));
  if (visibleCheckboxes.length === 0) {
    ui.selectAllHeader.checked = false;
    ui.selectAllHeader.indeterminate = false;
    return;
  }
  const checkedCount = visibleCheckboxes.filter(cb => cb.checked).length;
  if (checkedCount === 0) {
    ui.selectAllHeader.checked = false;
    ui.selectAllHeader.indeterminate = false;
  } else if (checkedCount === visibleCheckboxes.length) {
    ui.selectAllHeader.checked = true;
    ui.selectAllHeader.indeterminate = false;
  } else {
    ui.selectAllHeader.checked = false;
    ui.selectAllHeader.indeterminate = true;
  }
}

/* Tools menu: we'll build a small popup anchored to exportToggleButton
   It provides: Select Visible, Select All, Clear Selection, Export CSV, Bulk Edit
*/
let toolsPopup = null;
ui.exportToggleButton.addEventListener("click", (e) => {
  if (toolsPopup) {
    toolsPopup.remove();
    toolsPopup = null;
    return;
  }
  toolsPopup = document.createElement("div");
  toolsPopup.className = "absolute right-6 top-16 bg-white p-3 rounded shadow-lg w-60 text-sm z-50";
  toolsPopup.innerHTML = `
    <button id="tool-select-visible" class="w-full text-left px-2 py-2 hover:bg-slate-100">Select visible</button>
    <button id="tool-select-all" class="w-full text-left px-2 py-2 hover:bg-slate-100">Select all (entire DB)</button>
    <button id="tool-clear-selected" class="w-full text-left px-2 py-2 hover:bg-slate-100">Clear selection</button>
    <hr class="my-2"/>
    <button id="tool-export-csv" class="w-full text-left px-2 py-2 hover:bg-slate-100">Export CSV (selected/filtered)</button>
    <button id="tool-bulk-edit" class="w-full text-left px-2 py-2 hover:bg-slate-100">Bulk edit comments</button>
  `;
  document.body.appendChild(toolsPopup);

  // handlers
  document.getElementById("tool-select-visible").addEventListener("click", () => {
    selectVisible();
    closeTools();
  });
  document.getElementById("tool-select-all").addEventListener("click", async () => {
    await selectAllInDB();
    closeTools();
  });
  document.getElementById("tool-clear-selected").addEventListener("click", () => {
    clearSelection();
    closeTools();
  });
  document.getElementById("tool-export-csv").addEventListener("click", () => {
    exportCSV();
    closeTools();
  });
  document.getElementById("tool-bulk-edit").addEventListener("click", () => {
    openBulkModal();
    closeTools();
  });

  // close on outside click
  setTimeout(() => {
    const onDocClick = (ev) => {
      if (!toolsPopup.contains(ev.target) && ev.target !== ui.exportToggleButton) {
        closeTools();
        document.removeEventListener("click", onDocClick);
      }
    };
    document.addEventListener("click", onDocClick);
  }, 0);
});

function closeTools() {
  if (toolsPopup) { toolsPopup.remove(); toolsPopup = null; }
}

function selectVisible() {
  selectedIds.clear();
  document.querySelectorAll(".row-select").forEach(cb => {
    cb.checked = true;
    selectedIds.add(cb.getAttribute("data-id"));
  });
  updateSelectAllHeaderState();
}

async function selectAllInDB() {
  // select ids for allBoards currently loaded (which may be limited by security rules)
  selectedIds.clear();
  allBoards.forEach(b => selectedIds.add(b.id));
  // reflect visually on visible rows
  document.querySelectorAll(".row-select").forEach(cb => {
    cb.checked = selectedIds.has(cb.getAttribute("data-id"));
  });
  updateSelectAllHeaderState();
}

function clearSelection() {
  selectedIds.clear();
  document.querySelectorAll(".row-select").forEach(cb => cb.checked = false);
  updateSelectAllHeaderState();
}

/* ===========================
   CSV Export (offline)
   =========================== */

function exportCSV() {
  // if selections exist -> export selected; otherwise export filtered currently shown rows
  const exportRows = [];
  // build array of rows currently visible in table (matches filtered dataset)
  const visibleIds = Array.from(document.querySelectorAll(".row-select")).map(cb => cb.getAttribute("data-id"));
  let rowsToExport = [];
  if (selectedIds.size > 0) {
    rowsToExport = allBoards.filter(b => selectedIds.has(b.id));
  } else if (visibleIds.length > 0) {
    rowsToExport = allBoards.filter(b => visibleIds.includes(b.id));
  } else {
    // fallback: everything loaded
    rowsToExport = allBoards.slice();
  }

  if (rowsToExport.length === 0) {
    alert("No rows available for export.");
    return;
  }

  // columns: serialNumber, boardName, creationDate, technician, comments, createdBy, updatedBy, entryDate
  const headers = ["serialNumber","boardName","creationDate","technician","comments","createdBy","updatedBy","entryDate"];
  const lines = [headers.map(escapeCSV).join(",")];

  for (const r of rowsToExport) {
    const entryDateIso = r.entryDate && r.entryDate.toDate ? r.entryDate.toDate().toISOString() : (r.entryDate || "");
    const row = [
      r.serialNumber || "",
      r.boardName || "",
      r.creationDate || "",
      r.technician || "",
      r.comments || "",
      r.createdBy || "",
      r.updatedBy || "",
      entryDateIso
    ];
    lines.push(row.map(escapeCSV).join(","));
  }

  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `boards_export_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ===========================
   Edit Single Comment flow
   =========================== */

function openEditModal(id) {
  const board = allBoards.find(b => b.id === id);
  if (!board) return alert("Record not found");
  ui.modalSerial.value = board.serialNumber || "";
  ui.modalComments.value = board.comments || "";
  ui.saveCommentsButton.dataset.docId = id;
  showElement(ui.editModal);
}
ui.closeModalButton.addEventListener("click", () => hideElement(ui.editModal));
ui.cancelCommentsButton.addEventListener("click", () => hideElement(ui.editModal));

ui.saveCommentsButton.addEventListener("click", async () => {
  const docId = ui.saveCommentsButton.dataset.docId;
  if (!docId) return;
  if (!currentUser) return alert("Sign in required to edit");

  const newComments = ui.modalComments.value || "";
  const boardRef = doc(db, "artifacts", appId, "boards", docId);
  try {
    // fetch old comments for history (if needed)
    const old = allBoards.find(b => b.id === docId)?.comments || "";
    await updateDoc(boardRef, {
      comments: newComments,
      updatedBy: currentUser.email,
      updatedAt: serverTimestamp()
    });
    // add history entry
    const histCol = collection(db, "artifacts", appId, "boards", docId, "history");
    await addDoc(histCol, {
      action: "update",
      field: "comments",
      oldValue: old,
      newValue: newComments,
      by: currentUser.email,
      at: serverTimestamp()
    });
    hideElement(ui.editModal);
  } catch (e) {
    console.error("Update comments error:", e);
    if (e.code === "permission-denied") alert("Permission denied: cannot update comments / history. Check rules.");
    else alert("Error updating comments: " + (e.message || e));
  }
});

/* ===========================
   Bulk Edit (apply to selected rows)
   =========================== */

function openBulkModal() {
  showElement(ui.bulkEditModal);
}
ui.closeBulkModal.addEventListener("click", () => hideElement(ui.bulkEditModal));
ui.cancelBulkButton.addEventListener("click", () => hideElement(ui.bulkEditModal));

ui.applyBulkButton.addEventListener("click", async () => {
  if (!currentUser) return alert("Sign in required");
  const text = (ui.bulkComments.value || "").trim();
  if (!text) return alert("Enter comment text to apply");

  // determine mode
  const mode = (document.querySelector('input[name="bulkMode"]:checked') || { value: "append" }).value;

  // which ids to operate on?
  const ids = Array.from(selectedIds);
  if (ids.length === 0) return alert("No rows selected. Use 'Select visible' or 'Select all' from Tools.");

  // apply sequentially (could be batched, but we also write history)
  for (const id of ids) {
    try {
      const existing = allBoards.find(b => b.id === id) || {};
      const oldComments = existing.comments || "";
      let newComments = "";
      if (mode === "append") {
        // append as new line
        newComments = oldComments ? `${oldComments}\n${text}` : text;
      } else {
        // overwrite
        newComments = text;
      }
      const boardRef = doc(db, "artifacts", appId, "boards", id);
      await updateDoc(boardRef, {
        comments: newComments,
        updatedBy: currentUser.email,
        updatedAt: serverTimestamp()
      });
      // history entry
      const histCol = collection(db, "artifacts", appId, "boards", id, "history");
      await addDoc(histCol, {
        action: "bulk-update",
        field: "comments",
        oldValue: oldComments,
        newValue: newComments,
        by: currentUser.email,
        at: serverTimestamp()
      });
    } catch (e) {
      console.error("Bulk update error for id", id, e);
      // continue to next but show an error summary at the end
      // for now, display immediate alert
      alert("Error updating some entries: " + (e.message || e));
    }
  }

  hideElement(ui.bulkEditModal);
  // clear selection to prevent accidental re-apply
  clearSelection();
});

/* ===========================
   HISTORY modal: view history subcollection
   =========================== */

async function openHistoryModal(id) {
  ui.historyList.innerHTML = "<li>Loading history…</li>";
  showElement(ui.historyModal);
  try {
    const histCol = collection(db, "artifacts", appId, "boards", id, "history");
    const q = query(histCol, orderBy("at", "desc"));
    const snap = await getDocs(q);
    if (snap.empty) {
      ui.historyList.innerHTML = "<li>No history entries</li>";
      return;
    }
    const parts = [];
    snap.forEach(d => {
      const h = d.data();
      const when = h.at && h.at.toDate ? h.at.toDate().toLocaleString() : "-";
      parts.push(`<li><strong>${escapeHtml(h.by || "-")}</strong> ${escapeHtml(h.action || "updated")} <em>${escapeHtml(h.field || "")}</em> at ${escapeHtml(when)}<div class="text-xs mt-1">Old: ${escapeHtml(h.oldValue || "")} | New: ${escapeHtml(h.newValue || "")}</div></li>`);
    });
    ui.historyList.innerHTML = parts.join("");
  } catch (e) {
    console.error("History load error:", e);
    if (e.code === "permission-denied") ui.historyList.innerHTML = `<li class="text-red-600">Missing permissions to read history.</li>`;
    else ui.historyList.innerHTML = `<li class="text-red-600">Failed to load history: ${escapeHtml(e.message || e)}</li>`;
  }
}
ui.closeHistoryButton.addEventListener("click", () => hideElement(ui.historyModal));

/* ===========================
   Sorting / header clicks
   =========================== */
ui.headers.forEach(h => {
  h.addEventListener("click", () => {
    const column = h.dataset.sortBy;
    if (!column) return;
    if (currentSort.column === column) {
      currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
    } else {
      currentSort.column = column;
      currentSort.direction = "asc";
    }
    render();
  });
});

/* ===========================
   Filters & search wiring
   =========================== */
ui.searchInput.addEventListener("input", () => render());
ui.regexMode && ui.regexMode.addEventListener("change", () => render());
ui.toggleFilters && ui.toggleFilters.addEventListener("click", () => ui.advancedFilters.classList.toggle("hidden"));
ui.technicianFilter && ui.technicianFilter.addEventListener("change", render);
ui.fromDate && ui.fromDate.addEventListener("change", render);
ui.toDate && ui.toDate.addEventListener("change", render);

/* ===========================
   Utility: escape attribute & html for safety
   =========================== */
function escapeHtmlAttrUnsafe(s) {
  if (s == null) return "";
  return String(s).replace(/"/g, '&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ===========================
   Initialize UI state (attempt) & final notes
   =========================== */

// Hide things until auth validated
hideElement(ui.addSection);
hideElement(ui.displaySection);
hideElement(ui.advancedFilters);
hideElement(ui.unauthorized);

// Small UX: if Tools exists, ensure clicking outside will close popup (handled in create)

// Finally, a helpful console note
console.log("app.js loaded — Firebase initialized (projectId:", firebaseConfig.projectId, ")");

/* End of file */
