/* ============================================================
   EKOLSTAT — Gestion sidebar (collapse desktop + drawer mobile)
   Module commun à toutes les pages dashboard
   ============================================================ */
(function initSidebar() {
  // Garde anti double initialisation
  if (window.__EKOLSTAT_SIDEBAR_INIT__) return;
  window.__EKOLSTAT_SIDEBAR_INIT__ = true;

  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return; // Page sans sidebar (ex: login)

  const toggleBtn = document.getElementById("sidebar-toggle");
  const openBtn = document.getElementById("open-sidebar");

  // Overlay pour mobile
  let overlay = document.querySelector(".sidebar-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "sidebar-overlay";
    document.body.appendChild(overlay);
  }

  const isMobile = () => window.innerWidth <= 768;

  // Toggle desktop (collapse) / mobile (drawer)
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      if (isMobile()) {
        sidebar.classList.toggle("open");
        overlay.classList.toggle("show");
      } else {
        sidebar.classList.toggle("collapsed");
        try {
          localStorage.setItem("ekolstat_sidebar_collapsed",
            sidebar.classList.contains("collapsed") ? "1" : "0");
        } catch(e) {}
      }
    });
  }

  // Ouverture sur mobile depuis le topbar
  if (openBtn) {
    openBtn.addEventListener("click", () => {
      sidebar.classList.add("open");
      overlay.classList.add("show");
    });
  }

  // Fermeture via overlay
  overlay.addEventListener("click", () => {
    sidebar.classList.remove("open");
    overlay.classList.remove("show");
  });

  // Restaurer l'état collapse desktop
  try {
    if (localStorage.getItem("ekolstat_sidebar_collapsed") === "1" && !isMobile()) {
      sidebar.classList.add("collapsed");
    }
  } catch(e) {}

  // Fermer le drawer quand on clique sur un lien (mobile)
  sidebar.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", () => {
      if (isMobile()) {
        sidebar.classList.remove("open");
        overlay.classList.remove("show");
      }
    });
  });

  // Resize handling
  window.addEventListener("resize", () => {
    if (!isMobile()) {
      overlay.classList.remove("show");
      sidebar.classList.remove("open");
    }
  });

  // Tooltips pour le mode collapsed
  sidebar.querySelectorAll(".nav-link").forEach(link => {
    const span = link.querySelector("span");
    if (span) link.setAttribute("data-tooltip", span.textContent.trim());
  });
})();
