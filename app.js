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

// 🔹 Replace with your Firebase config
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const appId = "default-board-tracker";
const boardsCollection = collection(db, "artifacts", appId, "boards");

const ui = {
  loginBtn: document.getElementById("loginButton"),
  logoutBtn: document.getElementById("logoutButton"),
  userInfo: document.getElementById("user-info"),
  unauthorized: document.getElementById("unauthorized"),
  addSection: document.getElementById("add-board-section"),
  tableSection: document.getElementById("display-section"),
  addBtn: document.getElementById("addBoardButton"),
  tableBody: document.getElementById("boardsTableBody"),
  loading: document.getElementById("loading"),
  noResults: document.getElementById("no-results"),
  searchInput: document.getElementById("searchInput"),
  toggleFilters: document.getElementById("toggleFilters"),
  advancedFilters: document.getElementById("advancedFilters"),
  technicianFilter: document.getElementById("technicianFilter"),
  fromDate: document.getElementById("fromDate"),
  toDate: document.getElementById("toDate"),
  technician: document.getElementById("technician"),
  boardName: document.getElementById("boardName"),
  quantity: document.getElementById("quantity"),
  dateInput: document.getElementById("dateInput"),
  comments: document.getElementById("comments"),
  modal: document.getElementById("editModal"),
  modalSerial: document.getElementById("modalSerialNumber"),
  modalComments: document.getElementById("modalComments"),
  saveButton: document.getElementById("saveCommentsButton"),
  cancelButton: document.getElementById("cancelCommentsButton"),
  closeButton: document.getElementById("closeModalButton"),
  historyModal: document.getElementById("historyModal"),
  closeHistoryButton: document.getElementById("closeHistoryButton"),
  historyList: document.getElementById("historyList"),
  exportToggle: document.getElementById("exportToggleButton"),
  headers: document.querySelectorAll("[data-sort-by]"),
};

let allBoards = [];
let currentSort = { column: "creationDate", direction: "desc" };
let exportMode = false;
let currentUser = null;

// 🔹 AUTH STATE
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    ui.userInfo.textContent = `Connected | ${user.email}`;
    ui.loginBtn.classList.add("hidden");
    ui.logoutBtn.classList.remove("hidden");
    listenBoards();
  } else {
    currentUser = null;
    ui.userInfo.textContent = "Not signed in";
    ui.loginBtn.classList.remove("hidden");
    ui.logoutBtn.classList.add("hidden");
    ui.addSection.classList.add("hidden");
    ui.tableSection.classList.add("hidden");
  }
});

// 🔹 LOGIN / LOGOUT
ui.loginBtn.addEventListener("click", async () => {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code === "auth/operation-not-supported-in-this-environment") {
      const provider = new GoogleAuthProvider();
      await signInWithRedirect(auth, provider);
    }
  }
});
getRedirectResult(auth).catch((err) =>
  console.error("Redirect failed", err)
);
ui.logoutBtn.addEventListener("click", () => signOut(auth));

// 🔹 ADD BOARD
ui.addBtn.addEventListener("click", async () => {
  if (!currentUser) return;

  const tech = ui.technician.value.trim();
  const name = ui.boardName.value.trim();
  let qty = parseInt(ui.quantity.value, 10);
  const comm = ui.comments.value.trim() || "N/A";

  if (!tech || !name || isNaN(qty) || qty < 1) {
    alert("Please fill in Technician, Board Name, and valid Quantity");
    return;
  }

  const selectedDate = ui.dateInput.value
    ? new Date(ui.dateInput.value)
    : new Date();
  const year = String(selectedDate.getFullYear()).slice(-2);
  const month = String(selectedDate.getMonth() + 1).padStart(2, "0");
  const day = String(selectedDate.getDate()).padStart(2, "0");
  const datePart = `${year}${month}${day}`;
  const creationDateString = `${selectedDate.getFullYear()}-${month}-${day}`;
  const boardNumberPart = (name.match(/^\d{3}/) || ["000"])[0];

  for (let i = 0; i < qty; i++) {
    const autonumberPart = String(i + 1).padStart(3, "0");
    const serialNumber = `SN-${datePart}-${boardNumberPart}-${autonumberPart}`;

    const docData = {
      serialNumber,
      boardName: name,
      technician: tech,
      comments: comm,
      creationDate: creationDateString,
      entryDate: serverTimestamp(),
      createdBy: currentUser.email,
      updatedBy: currentUser.email,
    };

    try {
      await addDoc(boardsCollection, docData);
    } catch (e) {
      alert("Error adding board: " + e.message);
    }
  }

  ui.technician.value = "";
  ui.boardName.value = "";
  ui.comments.value = "";
  ui.quantity.value = "1";
  ui.dateInput.value = "";
});

// 🔹 LISTEN BOARDS
function listenBoards() {
  onSnapshot(
    query(boardsCollection, orderBy("creationDate", "desc")),
    (snapshot) => {
      ui.loading.classList.add("hidden");
      allBoards = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      ui.addSection.classList.remove("hidden");
      ui.tableSection.classList.remove("hidden");
      populateTechnicianFilter();
      render();
    },
    (err) => {
      if (err.code === "permission-denied") {
        ui.unauthorized.classList.remove("hidden");
        ui.addSection.classList.add("hidden");
        ui.tableSection.classList.add("hidden");
      }
    }
  );
}

// 🔹 RENDER
function render() {
  const searchTerm = ui.searchInput.value.toLowerCase();
  const techFilter = ui.technicianFilter.value;
  const fromDate = ui.fromDate.value;
  const toDate = ui.toDate.value;

  let filtered = allBoards.filter((board) => {
    let match =
      Object.values(board).some((v) =>
        String(v).toLowerCase().includes(searchTerm)
      ) || false;

    if (techFilter && board.technician !== techFilter) return false;
    if (fromDate && board.creationDate < fromDate) return false;
    if (toDate && board.creationDate > toDate) return false;

    return match;
  });

  filtered.sort((a, b) => {
    let aVal = a[currentSort.column] || "";
    let bVal = b[currentSort.column] || "";
    return currentSort.direction === "asc"
      ? aVal > bVal
        ? 1
        : -1
      : aVal < bVal
      ? 1
      : -1;
  });

  updateSortIcons();
  populateTable(filtered);
}

function populateTable(boards) {
  ui.tableBody.innerHTML = "";
  if (boards.length === 0) {
    ui.noResults.classList.remove("hidden");
    return;
  }
  ui.noResults.classList.add("hidden");

  const frag = document.createDocumentFragment();
  boards.forEach((board) => {
    const tr = document.createElement("tr");
    tr.className =
      "hover:bg-slate-50 sm:table-row block border-b sm:border-0";

    const commentsText = board.comments || "N/A";
    tr.innerHTML = `
      <td class="px-6 py-4 text-sm font-medium text-slate-900 block sm:table-cell">
        <span class="sm:hidden font-semibold">Serial: </span>${board.serialNumber}
      </td>
      <td class="px-6 py-4 text-sm text-slate-500 block sm:table-cell">
        <span class="sm:hidden font-semibold">Board: </span>${board.boardName}
      </td>
      <td class="px-6 py-4 text-sm text-slate-500 block sm:table-cell">
        <span class="sm:hidden font-semibold">Date: </span>${board.creationDate}
      </td>
      <td class="px-6 py-4 text-sm text-slate-500 block sm:table-cell">
        <span class="sm:hidden font-semibold">Tech: </span>${board.technician}
      </td>
      <td class="px-6 py-4 text-sm text-slate-500 block sm:table-cell">
        <span class="sm:hidden font-semibold">Comments: </span>${commentsText}
        <div class="mt-2 sm:mt-0 flex justify-end">
          ${
            exportMode
              ? `<input type="checkbox" class="export-check" data-id="${board.id}"/>`
              : `
                <button class="edit-button text-blue-500 hover:text-blue-700 ml-2" data-id="${board.id}">✏️</button>
                <button class="history-button text-slate-500 hover:text-slate-700 ml-2" data-id="${board.id}">📜</button>
              `
          }
        </div>
      </td>
    `;
    frag.appendChild(tr);
  });
  ui.tableBody.appendChild(frag);

  ui.tableBody.querySelectorAll(".edit-button").forEach((btn) =>
    btn.addEventListener("click", () => openEditModal(btn.dataset.id))
  );
  ui.tableBody.querySelectorAll(".history-button").forEach((btn) =>
    btn.addEventListener("click", () => openHistoryModal(btn.dataset.id))
  );
}

// 🔹 SORTING
ui.headers.forEach((h) =>
  h.addEventListener("click", () => {
    if (currentSort.column === h.dataset.sortBy) {
      currentSort.direction =
        currentSort.direction === "asc" ? "desc" : "asc";
    } else {
      currentSort.column = h.dataset.sortBy;
      currentSort.direction = "asc";
    }
    render();
  })
);

function updateSortIcons() {
  ui.headers.forEach((h) => {
    const icon = h.querySelector(".sort-icon");
    if (h.dataset.sortBy === currentSort.column) {
      icon.textContent = currentSort.direction === "asc" ? "↑" : "↓";
    } else {
      icon.textContent = "↕";
    }
  });
}

// 🔹 SEARCH & FILTER
ui.searchInput.addEventListener("input", render);
ui.toggleFilters.addEventListener("click", () => {
  ui.advancedFilters.classList.toggle("hidden");
});
ui.technicianFilter.addEventListener("change", render);
ui.fromDate.addEventListener("change", render);
ui.toDate.addEventListener("change", render);

function populateTechnicianFilter() {
  const techs = [...new Set(allBoards.map((b) => b.technician))];
  ui.technicianFilter.innerHTML = `<option value="">All Technicians</option>`;
  techs.forEach((t) => {
    ui.technicianFilter.innerHTML += `<option value="${t}">${t}</option>`;
  });
}

// 🔹 EDIT MODAL
function openEditModal(id) {
  const board = allBoards.find((b) => b.id === id);
  if (!board) return;
  ui.modalSerial.value = board.serialNumber;
  ui.modalComments.value = board.comments;
  ui.saveButton.dataset.docId = id;
  ui.modal.classList.remove("hidden");
}
function closeEditModal() {
  ui.modal.classList.add("hidden");
}
ui.cancelButton.addEventListener("click", closeEditModal);
ui.closeButton.addEventListener("click", closeEditModal);
ui.saveButton.addEventListener("click", async () => {
  const docId = ui.saveButton.dataset.docId;
  const newComments = ui.modalComments.value;
  if (!docId || !currentUser) return;
  try {
    await updateDoc(doc(db, "artifacts", appId, "boards", docId), {
      comments: newComments,
      updatedBy: currentUser.email,
    });
    await addDoc(collection(db, "artifacts", appId, "boards", docId, "history"), {
      changedBy: currentUser.email,
      field: "comments",
      newValue: newComments,
      changedAt: serverTimestamp(),
    });
    closeEditModal();
  } catch (e) {
    alert("Error updating comments: " + e.message);
  }
});

// 🔹 HISTORY MODAL
async function openHistoryModal(id) {
  ui.historyList.innerHTML = "";
  ui.historyModal.classList.remove("hidden");
  try {
    const q = query(
      collection(db, "artifacts", appId, "boards", id, "history"),
      orderBy("changedAt", "desc")
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      ui.historyList.innerHTML = "<li>No history found</li>";
    } else {
      snap.forEach((doc) => {
        const h = doc.data();
        ui.historyList.innerHTML += `<li>${h.changedBy} updated <b>${h.field}</b> → "${h.newValue}"</li>`;
      });
    }
  } catch (e) {
    ui.historyList.innerHTML = `<li class="text-red-500">Failed to load history: ${e.message}</li>`;
  }
}
ui.closeHistoryButton.addEventListener("click", () =>
  ui.historyModal.classList.add("hidden")
);

// 🔹 EXPORT MODE
ui.exportToggle.addEventListener("click", () => {
  exportMode = !exportMode;
  render();
  if (exportMode) {
    ui.exportToggle.textContent = "✅ Select Entries";
  } else {
    ui.exportToggle.textContent = "☰ Tools";
  }
});
