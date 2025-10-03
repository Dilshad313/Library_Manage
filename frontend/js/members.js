// frontend/js/members.js
const memberForm = document.getElementById("memberForm");
const memberList = document.getElementById("memberList");

async function loadMembers() {
  const members = await fetch("/members").then(r => r.json());
  const memberItems = memberList.querySelector("tbody");
  if (memberItems) {
    memberItems.innerHTML = "";
    members.forEach(m => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${m.name}</td>
        <td>${m.email}</td>
        <td>${m.role}</td>
        <td>
          <button class="btn-small">Edit</button>
          <button class="btn-small danger">Delete</button>
        </td>
      `;
      tr.querySelector(".btn-small").addEventListener("click", () => editMember(m._id));
      tr.querySelector(".danger").addEventListener("click", () => deleteMember(m._id));
      memberItems.appendChild(tr);
    });
  }
}

if (memberForm) {
  memberForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(memberForm).entries());
    await fetch("/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    memberForm.reset();
    loadMembers();
  });
}

async function editMember(id) {
  const name = prompt("New name");
  const email = prompt("New email
email");
  if (!name || !email) return;
  await fetch("/members", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name, email, role: "student" }) });
  loadMembers();
}

async function deleteMember(id) {
  if (!confirm("Delete member?")) return;
  await fetch("/members", { method: "DELETE", body: id });
  loadMembers();
}

document.addEventListener("DOMContentLoaded", loadMembers);