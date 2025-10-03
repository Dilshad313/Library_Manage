// frontend/js/reports.js
async function loadReports() {
  const topBooks = await fetch("/reports/most-borrowed").then(r => r.json());
  const topBooksTbody = document.querySelector("#topBooks tbody");
  topBooksTbody.innerHTML = topBooks.map(b => `
    <tr>
      <td>${b.title}</td>
      <td>${b.author}</td>
      <td>${b.borrowCount || 0}</td>
    </tr>
  `).join("");

  const activeMembers = await fetch("/reports/active-members").then(r => r.json());
  const activeMembersTbody = document.querySelector("#activeMembers tbody");
  activeMembersTbody.innerHTML = activeMembers.map(a => `
    <tr>
      <td>${a.member?.name || a.memberId}</td>
      <td>${a.member?.email || ''}</td>
      <td>${a.borrowCount}</td>
    </tr>
  `).join("");
}

document.addEventListener("DOMContentLoaded", loadReports);