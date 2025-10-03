// frontend/js/books.js
// Handles dashboard listing, add book form, borrow/return action, and cover upload.

const API = "";

function authHeader() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: "Bearer " + token } : {};
}

// Helpers
async function apiFetch(path, opts = {}) {
  opts.headers = Object.assign({}, opts.headers || {}, { "Content-Type": "application/json" }, authHeader());
  if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) opts.body = JSON.stringify(opts.body);
  const res = await fetch(API + path, opts);
  if (res.headers.get("content-type")?.includes("application/json")) return res.json();
  return res.text();
}

// load books and render cards
async function loadBooks() {
  const cards = document.getElementById("cards");
  if (!cards) return;
  const books = await apiFetch("/books", { method: "GET" });
  cards.innerHTML = "";
  const tpl = document.getElementById("cardTpl");
  books.forEach(book => {
    const el = tpl.content.cloneNode(true);
    const root = el.querySelector(".card");
    root.id = "book-" + book._id;
    el.querySelector(".cover").src = book.cover || "/uploads/default-book.jpg";
    el.querySelector(".title").textContent = book.title;
    el.querySelector(".author").textContent = book.author;
    el.querySelector(".genre-year").textContent = `${book.genre || "Unknown"} • ${book.year || ""}`;
    const badge = el.querySelector(".status-badge");
    const dueText = el.querySelector(".due-text");
    if (book.status === "Available") {
      badge.textContent = "Available";
      badge.classList.add("available");
      el.querySelector(".borrow-btn").style.display = "inline-block";
      el.querySelector(".return-btn").style.display = "none";
    } else {
      badge.textContent = "Borrowed";
      badge.classList.add("borrowed");
      el.querySelector(".borrow-btn").style.display = "none";
      el.querySelector(".return-btn").style.display = "inline-block";
      dueText.textContent = book.dueDate ? `Due: ${new Date(book.dueDate).toLocaleDateString()}` : "";
    }
    // actions
    el.querySelector(".borrow-btn").onclick = () => borrowBook(book._id);
    el.querySelector(".return-btn").onclick = () => returnBook(book._id);
    el.querySelector(".delete-btn").onclick = async () => {
      if (!confirm("Delete this book?")) return;
      await apiFetch("/books", { method: "DELETE", body: book._id });
      loadBooks();
    };
    el.querySelector(".edit-btn").onclick = () => {
      // open simple inline prompt to edit (for brevity)
      const title = prompt("Title", book.title) || book.title;
      const author = prompt("Author", book.author) || book.author;
      apiFetch("/books", { method: "PUT", body: { id: book._id, title, author } }).then(loadBooks);
    };
    cards.appendChild(el);
  });
}

// search
const searchInput = document.getElementById("searchInput");
if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll(".card").forEach(card => {
      const title = card.querySelector(".title").textContent.toLowerCase();
      const author = card.querySelector(".author").textContent.toLowerCase();
      card.style.display = title.includes(q) || author.includes(q) ? "" : "none";
    });
  });
}

// Add book page logic (if on AddBook page)
const bookForm = document.getElementById("bookForm");
if (bookForm) {
  const coverInput = document.getElementById("coverInput");
  bookForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(bookForm);
    const data = Object.fromEntries(fd.entries());
    // handle cover: convert to base64 if provided
    if (coverInput.files && coverInput.files[0]) {
      const file = coverInput.files[0];
      const base64 = await fileToBase64(file);
      const uploadRes = await apiFetch("/uploadCover", { method: "POST", body: { filename: file.name, base64 } });
      if (uploadRes.ok) data.cover = uploadRes.path;
    }
    await apiFetch("/books", { method: "POST", body: data });
    window.location.href = "/";
  });
}
function fileToBase64(file) {
  return new Promise((res) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.readAsDataURL(file);
  });
}

// Borrow flow: simple select member via prompt (for demo)
async function borrowBook(bookId) {
  const members = await apiFetch("/members", { method: "GET" });
  if (!members.length) return alert("No members found. Add members first.");
  const list = members.map((m, i) => `${i + 1}. ${m.name} (${m.email})`).join("\n");
  const choice = prompt(`Choose member by number:\n${list}`);
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= members.length) return alert("Invalid choice");
  const days = prompt("Days to borrow (default 7):", "7");
  const res = await apiFetch("/borrow", { method: "POST", body: { bookId, memberId: members[idx]._id, days } });
  if (res.ok) {
    alert("Borrowed! Due: " + new Date(res.dueDate).toLocaleDateString());
    loadBooks();
  } else {
    alert(res.msg || "Failed to borrow");
  }
}

async function returnBook(bookId) {
  const bookEl = document.getElementById("book-" + bookId);
  // ask for member id (or list)
  const members = await apiFetch("/members", { method: "GET" });
  const list = members.map((m, i) => `${i + 1}. ${m.name} (${m.email})`).join("\n");
  const choice = prompt(`Choose member by number who returns:\n${list}`);
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= members.length) return alert("Invalid choice");
  const res = await apiFetch("/return", { method: "POST", body: { bookId, memberId: members[idx]._id } });
  if (res.ok) {
    alert("Returned! Fine: ₹" + res.fine);
    loadBooks();
  } else {
    alert(res.msg || "Failed to return");
  }
}

// initial load
document.addEventListener("DOMContentLoaded", () => {
  loadBooks();
});