// frontend/js/auth.js
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(loginForm).entries());
    const res = await fetch("/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const json = await res.json();
    if (json.ok) {
      localStorage.setItem("token", json.token);
      localStorage.setItem("user", JSON.stringify(json.user));
      alert("Logged in");
      window.location.href = "/";
    } else {
      alert(json.msg || "Login failed");
    }
  });
}

if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(signupForm).entries());
    const res = await fetch("/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const json = await res.json();
    if (json.ok) {
      alert("Signup successful. You can login now.");
      signupForm.reset();
    } else {
      alert(json.msg || "Signup failed");
    }
  });
}
