import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore, collection, addDoc, updateDoc, doc,
  onSnapshot, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// 🔑 Replace with your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBAdB_xUyeThPH43D2qwzi0L5gmc8pdh5c",
  authDomain: "board-tracker-646a3.firebaseapp.com",
  projectId: "board-tracker-646a3",
  storageBucket: "board-tracker-646a3.firebasestorage.app",
  messagingSenderId: "74798840513",
  appId: "1:74798840513:web:c8b316f181b7e7e87ff240",
  measurementId: "G-BKJVPNXMME"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const appId = "default-board-tracker";
const boardsCollection = collection(db, "artifacts", appId, "boards");

/* ---------------------------
   UI
   --------------------------- */
const ui = {
  loginBtn: document.getElementById("loginButton"),
  logoutBtn: document.getElementById("logoutButton"),
  userInfo: document.getElementById("user-info"),
  unauthorized: document.getElementById("unauthorized"),
  addSection: document.getElementById("add-board-section"),
  displaySection: document.getElementById("display-section"),
  technician: document.getElementById("technician"),
  boardName: document.getElementById("boardName"),
  quantity: document.getElementById("quantity"),
  dateInput: document.getElementById("dateInput"),
  comments: document.getElementById("comments"),
  addBtn: document.getElementById("addBoardButton"),
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
  commentsModal: document.getElementById("commentsModal"),
  commentsContent: document.getElementById("commentsContent"),
  closeCommentsModal: document.getElementById("closeCommentsModal"),
  toolsButton: document.getElementById("toolsButton"),
  toolsDropdown: document.getElementById("toolsDropdown"),
  toolExport: document.getElementById("tool-export"),
  toolBulkEdit: document.getElementById("tool-bulk-edit"),
  bulkEditModal: document.getElementById("bulkEditModal"),
  bulkComments: document.getElementById("bulkComments"),
  applyBulkButton: document.getElementById("applyBulkButton"),
  closeBulkModal: document.getElementById("closeBulkModal"),
};

/* ---------------------------
   State
   --------------------------- */
let currentUser = null;
let allBoards = [];
let currentSort = { column: "creationDate", direction: "desc" };
let selectedIds = new Set();

/* ---------------------------
   Helpers
   --------------------------- */
function formatToSlashYMD(isoDate) {
  if (!isoDate) return "-";
  const parts = String(isoDate).split("-");
  if (parts.length >= 3) return `${parts[0]} / ${parts[1]} / ${parts[2]}`;
  return isoDate;
}
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}
function escapeCSV(s) {
  if (s == null) return '""';
  const str = String(s).replace(/"/g, '""');
  return `"${str}"`;
}
function showElement(el){ el && el.classList.remove("hidden"); }
function hideElement(el){ el && el.classList.add("hidden"); }

/* ---------------------------
   Auth
   --------------------------- */
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
    hideElement(ui.unauthorized);
    allBoards = [];
    selectedIds.clear();
    render();
  }
});

ui.loginBtn.addEventListener("click", async () => {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code === "auth/operation-not-supported-in-this-environment") {
      const provider = new GoogleAuthProvider();
      await signInWithRedirect(auth, provider);
    } else alert("Login failed: " + err.message);
  }
});

getRedirectResult(auth).catch(err => console.warn("Redirect error:", err));
ui.logoutBtn.addEventListener("click", () => signOut(auth));

/* ---------------------------
   Firestore listener
   --------------------------- */
let unsubscribeBoards = null;
function startListening() {
  if (unsubscribeBoards) unsubscribeBoards();
  const q = query(boardsCollection, orderBy("creationDate", "desc"));
  unsubscribeBoards = onSnapshot(q, (snapshot) => {
    ui.loading.classList.add("hidden");
    allBoards = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    showElement(ui.addSection);
    showElement(ui.displaySection);
    render();
  }, (err) => {
    if (err.code === "permission-denied") {
      ui.unauthorized.classList.remove("hidden");
      hideElement(ui.addSection);
      hideElement(ui.displaySection);
    } else alert("Failed to load boards: " + err.message);
  });
}

/* ---------------------------
   Add new boards
   --------------------------- */
ui.addBtn.addEventListener("click", async () => {
  if (!currentUser) return alert("Please sign in first.");
  const tech = ui.technician.value.trim();
  const name = ui.boardName.value.trim();
  let qty = parseInt(ui.quantity.value, 10);
  const comm = ui.comments.value.trim() || "N/A";
  if (!tech || !name || isNaN(qty) || qty < 1) return alert("Fill in fields");

  const selected = ui.dateInput.value ? new Date(ui.dateInput.value) : new Date();
  const y = selected.getFullYear();
  const m = String(selected.getMonth() + 1).padStart(2, "0");
  const d = String(selected.getDate()).padStart(2, "0");
  const creationDateString = `${y}-${m}-${d}`;
  const boardNumberPart = (name.match(/^\\d{3}/) || ["000"])[0];

  for (let i=0; i<qty; i++){
    const autonumberPart = String(i+1).padStart(3,"0");
    const serialNumber = `SN-${String(y).slice(-2)}${m}${d}-${boardNumberPart}-${autonumberPart}`;
    const payload = {
      serialNumber,
      boardName: name,
      technician: tech,
      comments: comm,
      creationDate: creationDateString,
      entryDate: serverTimestamp(),
      createdBy: currentUser.email,
      updatedBy: currentUser.email,
      updatedAt: serverTimestamp()
    };
    await addDoc(boardsCollection, payload);
  }

  ui.technician.value = ui.boardName.value = ui.comments.value = "";
  ui.quantity.value = "1"; ui.dateInput.value="";
});

/* ---------------------------
   Render + filters
   --------------------------- */
function render(){
  const qtext = ui.searchInput.value.trim();
  const useRegex = ui.regexMode.checked;
  let regex=null;
  if (useRegex && qtext){
    try { regex=new RegExp(qtext,"i"); }
    catch(e){ alert("Invalid regex"); return; }
  }

  let filtered=allBoards.filter(b=>{
    if(qtext){
      const hay=[b.serialNumber,b.boardName,b.technician,b.creationDate,b.comments].join(" ");
      if(regex){ if(!regex.test(hay)) return false; }
      else if(!hay.toLowerCase().includes(qtext.toLowerCase())) return false;
    }
    if(ui.technicianFilter.value){
      if(!b.technician.toLowerCase().includes(ui.technicianFilter.value.toLowerCase())) return false;
    }
    if(ui.fromDate.value){
      if(b.creationDate < ui.fromDate.value) return false;
    }
    if(ui.toDate.value){
      if(b.creationDate > ui.toDate.value) return false;
    }
    return true;
  });

  filtered.sort((a,b)=>{
    const av=String(a[currentSort.column]||"").toLowerCase();
    const bv=String(b[currentSort.column]||"").toLowerCase();
    return currentSort.direction==="asc" ? (av>bv?1:-1):(av<bv?1:-1);
  });

  populateTable(filtered);
}

/* ---------------------------
   Table
   --------------------------- */
function populateTable(boards){
  ui.tableBody.innerHTML="";
  if(boards.length===0){ showElement(ui.noResults); return; }
  hideElement(ui.noResults);
  const frag=document.createDocumentFragment();
  for(const b of boards){
    const tr=document.createElement("tr");
    const checked=selectedIds.has(b.id)?"checked":"";
    tr.innerHTML=`
      <td class="px-4 py-4 text-center w-10">
        <input type="checkbox" class="row-select" data-id="${b.id}" ${checked}/>
      </td>
      <td class="px-6 py-4">${escapeHtml(b.serialNumber)}</td>
      <td class="px-6 py-4">${escapeHtml(b.boardName)}</td>
      <td class="px-6 py-4">${formatToSlashYMD(b.creationDate)}</td>
      <td class="px-6 py-4">${escapeHtml(b.technician)}</td>
      <td class="px-6 py-4 max-w-xs truncate comment-click" data-id="${b.id}" title="Click to view full">
        ${escapeHtml(b.comments)}
      </td>`;
    frag.appendChild(tr);
  }
  ui.tableBody.appendChild(frag);

  ui.tableBody.querySelectorAll(".row-select").forEach(cb=>cb.addEventListener("change",e=>{
    const id=e.target.dataset.id;
    if(e.target.checked) selectedIds.add(id); else selectedIds.delete(id);
  }));

  ui.tableBody.querySelectorAll(".comment-click").forEach(span=>
    span.addEventListener("click",()=>openCommentsModal(span.dataset.id))
  );
}

/* ---------------------------
   Comments modal
   --------------------------- */
function openCommentsModal(id){
  const b=allBoards.find(x=>x.id===id);
  ui.commentsContent.textContent=b?.comments||"(empty)";
  showElement(ui.commentsModal);
}
ui.closeCommentsModal.addEventListener("click",()=>hideElement(ui.commentsModal));

/* ---------------------------
   Tools dropdown
   --------------------------- */
ui.toolsButton.addEventListener("click",()=>{
  ui.toolsDropdown.classList.toggle("hidden");
});

// Export CSV
ui.toolExport.addEventListener("click",()=>{
  const rows = allBoards.filter(b=>selectedIds.size===0 || selectedIds.has(b.id));
  const header=["Serial","Board Name","Date","Technician","Comments"];
  const csv=[header.join(",")];
  rows.forEach(b=>{
    csv.push([
      escapeCSV(b.serialNumber),
      escapeCSV(b.boardName),
      escapeCSV(formatToSlashYMD(b.creationDate)),
      escapeCSV(b.technician),
      escapeCSV(b.comments)
    ].join(","));
  });
  const blob=new Blob([csv.join("\\n")],{type:"text/csv"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download="boards.csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  ui.toolsDropdown.classList.add("hidden");
});

// Bulk edit
ui.toolBulkEdit.addEventListener("click",()=>{
  ui.bulkComments.value="";
  showElement(ui.bulkEditModal);
  ui.toolsDropdown.classList.add("hidden");
});
ui.closeBulkModal.addEventListener("click",()=>hideElement(ui.bulkEditModal));
ui.applyBulkButton.addEventListener("click",async()=>{
  const text=ui.bulkComments.value.trim();
  if(!text) return;
  for(const id of selectedIds){
    const ref=doc(db,"artifacts",appId,"boards",id);
    await updateDoc(ref,{
      comments:text,
      updatedBy:currentUser.email,
      updatedAt:serverTimestamp()
    });
  }
  hideElement(ui.bulkEditModal);
});

/* ---------------------------
   Advanced filters toggle
   --------------------------- */
ui.toggleFilters.addEventListener("click",()=>{
  ui.advancedFilters.classList.toggle("hidden");
});

/* ---------------------------
   Triggers
   --------------------------- */
ui.searchInput.addEventListener("input",render);
ui.regexMode.addEventListener("change",render);
ui.technicianFilter.addEventListener("input",render);
ui.fromDate.addEventListener("change",render);
ui.toDate.addEventListener("change",render);
