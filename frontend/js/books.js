// frontend/js/books.js
// Enhanced with modal edit, better API handling, and flexible configuration

const API = window.location.origin; // Automatically uses current domain instead of localhost

function authHeader() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: "Bearer " + token } : {};
}

// Helpers
async function apiFetch(path, opts = {}) {
  opts.headers = Object.assign({}, opts.headers || {}, { "Content-Type": "application/json" }, authHeader());
  if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) {
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(API + path, opts);
  if (res.headers.get("content-type")?.includes("application/json")) return res.json();
  return res.text();
}

// Load books and render cards
async function loadBooks() {
  const cards = document.getElementById("cards");
  if (!cards) return;
  
  try {
    const books = await apiFetch("/books", { method: "GET" });
    cards.innerHTML = "";
    
    if (!books.length) {
      cards.innerHTML = '<div class="empty-state"><h2>No books available</h2><p>Start by adding your first book!</p></div>';
      return;
    }
    
    const tpl = document.getElementById("cardTpl");
    books.forEach(book => {
      const el = tpl.content.cloneNode(true);
      const root = el.querySelector(".card");
      root.id = "book-" + book._id;
      el.querySelector(".cover").src = book.cover || "/uploads/default-book.jpg";
      el.querySelector(".cover").alt = book.title;
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
      
      // Actions
      el.querySelector(".borrow-btn").onclick = () => borrowBook(book._id);
      el.querySelector(".return-btn").onclick = () => returnBook(book._id);
      el.querySelector(".delete-btn").onclick = () => deleteBook(book._id);
      el.querySelector(".edit-btn").onclick = () => openEditModal(book);
      
      cards.appendChild(el);
    });
  } catch (error) {
    console.error("Error loading books:", error);
    cards.innerHTML = '<div class="empty-state"><h2>Error loading books</h2><p>Please try again later.</p></div>';
  }
}

// Search functionality
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

// Add book page logic
const bookForm = document.getElementById("bookForm");
if (bookForm) {
  const coverInput = document.getElementById("coverInput");
  const previewContainer = document.createElement("div");
  previewContainer.className = "file-preview";
  previewContainer.id = "coverPreview";
  coverInput.parentNode.appendChild(previewContainer);
  
  coverInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        previewContainer.innerHTML = `<img src="${event.target.result}" alt="Cover preview">`;
        previewContainer.classList.add("active");
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  });
  
  bookForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = bookForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Adding...";
    
    try {
      const fd = new FormData(bookForm);
      const data = Object.fromEntries(fd.entries());
      
      // Handle cover upload
      if (coverInput.files && coverInput.files[0]) {
        const file = coverInput.files[0];
        const base64 = await fileToBase64(file);
        const uploadRes = await apiFetch("/uploadCover", { method: "POST", body: { filename: file.name, base64 } });
        if (uploadRes.ok) data.cover = uploadRes.path;
      }
      
      await apiFetch("/books", { method: "POST", body: data });
      alert("Book added successfully!");
      window.location.href = "/";
    } catch (error) {
      console.error("Error adding book:", error);
      alert("Failed to add book. Please try again.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Save";
    }
  });
}

function fileToBase64(file) {
  return new Promise((res) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.readAsDataURL(file);
  });
}

// Edit book with modal
function openEditModal(book) {
  // Create modal if it doesn't exist
  let modal = document.getElementById("editModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "editModal";
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Edit Book</h3>
          <button class="modal-close" onclick="closeEditModal()">&times;</button>
        </div>
        <form id="editBookForm">
          <input type="hidden" id="edit-id" name="id">
          
          <div class="form-group">
            <label for="edit-title">Title *</label>
            <input type="text" id="edit-title" name="title" required>
          </div>
          
          <div class="form-group">
            <label for="edit-author">Author *</label>
            <input type="text" id="edit-author" name="author" required>
          </div>
          
          <div class="input-row">
            <div class="form-group">
              <label for="edit-genre">Genre</label>
              <input type="text" id="edit-genre" name="genre">
            </div>
            
            <div class="form-group">
              <label for="edit-year">Year</label>
              <input type="number" id="edit-year" name="year" min="1000" max="2100">
            </div>
          </div>
          
          <div class="form-group">
            <label for="edit-isbn">ISBN</label>
            <input type="text" id="edit-isbn" name="isbn">
          </div>
          
          <div class="form-group">
            <label for="edit-cover">Cover Image</label>
            <input type="file" id="edit-cover" accept="image/*">
            <div id="edit-preview" class="file-preview"></div>
          </div>
          
          <div class="modal-actions">
            <button type="button" class="btn-alt" onclick="closeEditModal()">Cancel</button>
            <button type="submit" class="btn">Update Book</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
    
    // Handle form submission
    document.getElementById("editBookForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      await updateBook();
    });
    
    // Handle cover preview
    document.getElementById("edit-cover").addEventListener("change", (e) => {
      const preview = document.getElementById("edit-preview");
      if (e.target.files && e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = (event) => {
          preview.innerHTML = `<img src="${event.target.result}" alt="Cover preview">`;
          preview.classList.add("active");
        };
        reader.readAsDataURL(e.target.files[0]);
      }
    });
  }
  
  // Populate form
  document.getElementById("edit-id").value = book._id;
  document.getElementById("edit-title").value = book.title;
  document.getElementById("edit-author").value = book.author;
  document.getElementById("edit-genre").value = book.genre || "";
  document.getElementById("edit-year").value = book.year || "";
  document.getElementById("edit-isbn").value = book.isbn || "";
  
  const preview = document.getElementById("edit-preview");
  if (book.cover) {
    preview.innerHTML = `<img src="${book.cover}" alt="Current cover">`;
    preview.classList.add("active");
  } else {
    preview.innerHTML = "";
    preview.classList.remove("active");
  }
  
  modal.style.display = "flex";
}

window.closeEditModal = function() {
  const modal = document.getElementById("editModal");
  if (modal) modal.style.display = "none";
  document.getElementById("editBookForm").reset();
  document.getElementById("edit-preview").innerHTML = "";
};

async function updateBook() {
  const form = document.getElementById("editBookForm");
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = "Updating...";
  
  try {
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    
    // Handle cover upload if new image selected
    const coverInput = document.getElementById("edit-cover");
    if (coverInput.files && coverInput.files[0]) {
      const file = coverInput.files[0];
      const base64 = await fileToBase64(file);
      const uploadRes = await apiFetch("/uploadCover", { method: "POST", body: { filename: file.name, base64 } });
      if (uploadRes.ok) data.cover = uploadRes.path;
    }
    
    await apiFetch("/books", { method: "PUT", body: data });
    closeEditModal();
    loadBooks();
    showNotification("Book updated successfully!", "success");
  } catch (error) {
    console.error("Error updating book:", error);
    showNotification("Failed to update book. Please try again.", "error");
    submitBtn.disabled = false;
    submitBtn.textContent = "Update Book";
  }
}

async function deleteBook(bookId) {
  if (!confirm("Are you sure you want to delete this book? This action cannot be undone.")) return;
  
  try {
    await apiFetch("/books", { method: "DELETE", body: bookId });
    loadBooks();
    showNotification("Book deleted successfully!", "success");
  } catch (error) {
    console.error("Error deleting book:", error);
    showNotification("Failed to delete book. Please try again.", "error");
  }
}

// Borrow flow
async function borrowBook(bookId) {
  try {
    const members = await apiFetch("/members", { method: "GET" });
    if (!members.length) {
      showNotification("No members found. Add members first.", "warning");
      return;
    }
    
    const list = members.map((m, i) => `${i + 1}. ${m.name} (${m.email})`).join("\n");
    const choice = prompt(`Choose member by number:\n${list}`);
    const idx = parseInt(choice) - 1;
    
    if (isNaN(idx) || idx < 0 || idx >= members.length) {
      showNotification("Invalid choice", "error");
      return;
    }
    
    const days = prompt("Days to borrow (default 7):", "7");
    const res = await apiFetch("/borrow", { method: "POST", body: { bookId, memberId: members[idx]._id, days } });
    
    if (res.ok) {
      showNotification(`Borrowed successfully! Due: ${new Date(res.dueDate).toLocaleDateString()}`, "success");
      loadBooks();
    } else {
      showNotification(res.msg || "Failed to borrow", "error");
    }
  } catch (error) {
    console.error("Error borrowing book:", error);
    showNotification("Failed to borrow book. Please try again.", "error");
  }
}

async function returnBook(bookId) {
  try {
    const members = await apiFetch("/members", { method: "GET" });
    const list = members.map((m, i) => `${i + 1}. ${m.name} (${m.email})`).join("\n");
    const choice = prompt(`Choose member returning the book:\n${list}`);
    const idx = parseInt(choice) - 1;
    
    if (isNaN(idx) || idx < 0 || idx >= members.length) {
      showNotification("Invalid choice", "error");
      return;
    }
    
    const res = await apiFetch("/return", { method: "POST", body: { bookId, memberId: members[idx]._id } });
    
    if (res.ok) {
      const fineMsg = res.fine > 0 ? `Fine: ₹${res.fine}` : "No fine";
      showNotification(`Book returned successfully! ${fineMsg}`, "success");
      loadBooks();
    } else {
      showNotification(res.msg || "Failed to return", "error");
    }
  } catch (error) {
    console.error("Error returning book:", error);
    showNotification("Failed to return book. Please try again.", "error");
  }
}

// Notification system
function showNotification(message, type = "info") {
  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => notification.classList.add("show"), 10);
  setTimeout(() => {
    notification.classList.remove("show");
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Initial load
document.addEventListener("DOMContentLoaded", () => {
  loadBooks();
});