document.getElementById("welcomeBtn").addEventListener("click", async (e) => {
  e.preventDefault();
  const err = document.getElementById("err");
  try {
    const r = await fetch("/api/session/start", { method: "POST", credentials: "same-origin" });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Could not start session");
    window.location.href = j.redirect || "/app";
  } catch (ex) { err.textContent = ex.message; }
});
