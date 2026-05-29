/* ============================================================
   EKOLSTAT — Tableau de bord Sous-Division - Version 2.0
   Responsabilités : Gestion des Écoles, suivi de la sous-division
   ============================================================ */

(function() {
  const auth = firebase.auth();
  const db = firebase.database();

  let currentUser = null;
  let currentProfile = null;
  let currentSdId = null;
  let currentIppId = null;

  // État global
  let ecoles = {};
  let classes = {};
  let effectifs = {};

  // Graphique
  let evolutionChart = null;

  // Application Firebase secondaire (pour créer des comptes sans déconnecter la SD)
  let secondaryApp = null;
  function getSecondaryAuth() {
    if (!secondaryApp) {
      try {
        secondaryApp = firebase.initializeApp(firebase.app().options, "ekolstat-create-ecole");
      } catch (e) {
        secondaryApp = firebase.app("ekolstat-create-ecole");
      }
    }
    return secondaryApp.auth();
  }

  const fmt = (n) => n ? n.toLocaleString("fr-FR") : "0";
  const pct = (num, den) => den ? ((num / den) * 100).toFixed(1).replace(".", ",") + "%" : "0%";

  // Génération de mot de passe sécurisé
  function generatePassword(len = 10) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let out = "";
    const arr = new Uint32Array(len);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(arr);
    } else {
      for (let i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 1e9);
    }
    for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
    return out;
  }

  // ==================== SERIAL NUMBER ====================
  function generateSerialNumber() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const rand4 = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return 'SERIE:MINENNC' + yyyy + mm + rand4;
  }

  // ==================== AUTHENTIFICATION ====================
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = "../index.html";
      return;
    }

    const snap = await db.ref("utilisateurs/" + user.uid).get();
    if (!snap.exists()) {
      await auth.signOut();
      window.location.href = "../index.html";
      return;
    }

    currentProfile = snap.val();
    if (currentProfile.role !== "sous-division" && currentProfile.role !== "sd") {
      toast("Accès non autorisé", "error");
      await auth.signOut();
      setTimeout(() => window.location.href = "../index.html", 1200);
      return;
    }

    currentUser = user;
    currentSdId = currentProfile.entiteId || currentProfile.sdId || user.uid;
    currentIppId = currentProfile.ippId || "";

    document.getElementById("user-name").textContent = currentProfile.nomEntite || "Sous-Division";
    document.getElementById("user-role").textContent = "Sous-Division";

    init();
  });

  // ==================== INITIALISATION ====================
  function init() {
    bindEvents();
    loadData();
  }

  function loadData() {
    // Écoles rattachées à cette SD
    db.ref("ecoles").orderByChild("sdId").equalTo(currentSdId).on("value", (snap) => {
      ecoles = snap.val() || {};
      renderAll();
    });

    // Classes (filtre par sdId)
    db.ref("classes").orderByChild("sdId").equalTo(currentSdId).on("value", (snap) => {
      classes = snap.val() || {};
      renderAll();
    });

    // Effectifs (global, on filtre côté client)
    db.ref("effectifs").on("value", (snap) => {
      effectifs = snap.val() || {};
      renderAll();
    });
  }

  function bindEvents() {
    // Déconnexion
    const logoutLink = document.getElementById("logout-link");
    if (logoutLink) logoutLink.addEventListener("click", () => auth.signOut());

    // Rafraîchir
    const refreshBtn = document.getElementById("refresh-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        renderAll();
        toast("Données rafraîchies", "success");
      });
    }

    // Recherche
    const globalSearch = document.getElementById("global-search");
    if (globalSearch) {
      globalSearch.addEventListener("input", function(e) {
        const q = e.target.value.toLowerCase().trim();
        const rows = document.querySelectorAll("#ecole-summary-container tbody tr, #ecole-management-container tbody tr");
        rows.forEach(function(r) {
          if (!q) { r.style.display = ""; return; }
          r.style.display = r.textContent.toLowerCase().includes(q) ? "" : "none";
        });
      });
    }

    // Navigation
    document.querySelectorAll(".nav-link[data-view]").forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const view = link.getAttribute("data-view");

        document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
        link.classList.add("active");

        document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
        const viewEl = document.getElementById("view-" + view);
        if (viewEl) viewEl.classList.add("active");

        const titles = {
          "overview": "Vue d'ensemble",
          "ecoles": "Écoles",
          "reports": "Rapports"
        };
        const pageTitle = document.getElementById("page-title");
        if (pageTitle) pageTitle.textContent = titles[view] || view;

        if (view === "overview") renderEvolutionChart();

        // Fermer le drawer mobile après navigation
        const sb = document.getElementById("sidebar");
        const ov = document.getElementById("sidebar-overlay");
        if (sb) sb.classList.remove("open");
        if (ov) ov.classList.remove("show");
      });
    });

    // Modal École
    const btnNewEcole = document.getElementById("btn-new-ecole");
    const formEcole = document.getElementById("form-ecole");
    const genPassEcole = document.getElementById("gen-pass-ecole");
    if (btnNewEcole) btnNewEcole.addEventListener("click", () => openEcoleModal());
    if (formEcole) formEcole.addEventListener("submit", saveEcole);
    if (genPassEcole) {
      genPassEcole.addEventListener("click", function() {
        const passInput = document.getElementById("ecole-password");
        if (passInput) passInput.value = generatePassword(10);
      });
    }

    // Export PDF
    const btnExportPdf = document.getElementById("btn-export-pdf");
    if (btnExportPdf) btnExportPdf.addEventListener("click", exportToPdf);

    // Fermeture des modals
    document.querySelectorAll("[data-close-modal]").forEach(btn => {
      btn.addEventListener("click", () => {
        const modal = btn.closest(".modal");
        if (modal) modal.classList.remove("show");
      });
    });

    // ==================== HAMBURGER (responsive, tous écrans) ====================
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    const burger = document.getElementById("hamburger-btn");

    if (burger && sidebar) {
      burger.addEventListener("click", () => {
        if (window.innerWidth <= 1024) {
          sidebar.classList.add("open");
          if (overlay) overlay.classList.add("show");
        } else {
          sidebar.classList.toggle("collapsed");
        }
      });
    }
    if (overlay && sidebar) {
      overlay.addEventListener("click", () => {
        sidebar.classList.remove("open");
        overlay.classList.remove("show");
      });
    }
    window.addEventListener("resize", () => {
      if (window.innerWidth > 1024) {
        sidebar.classList.remove("open");
        if (overlay) overlay.classList.remove("show");
      }
    });
  }

  // ==================== AGRÉGATION ====================
  function getStats() {
    const stats = {
      totalEcoles: 0,
      ecolesPubliques: 0,
      ecolesPrivees: 0,
      totalClasses: 0,
      totalEleves: 0,
      totalFilles: 0,
      totalGarcons: 0,
      ecoleStats: {}
    };

    // Écoles actives
    for (const ecoleId in ecoles) {
      if (!ecoles.hasOwnProperty(ecoleId)) continue;
      const ecole = ecoles[ecoleId];
      if (ecole.statut === "supprime") continue;
      stats.totalEcoles++;
      if (ecole.categorie === "publique") stats.ecolesPubliques++;
      else if (ecole.categorie === "privee") stats.ecolesPrivees++;
      stats.ecoleStats[ecoleId] = {
        nom: ecole.nom,
        responsable: ecole.responsable || "",
        cycle: ecole.cycle || "",
        statut: ecole.statut || "actif",
        email: ecole.email || "",
        classes: 0, eleves: 0, filles: 0, garcons: 0
      };
    }

    // Classes + effectifs
    for (const id in classes) {
      if (!classes.hasOwnProperty(id)) continue;
      const classe = classes[id];
      if (classe.statut === "supprime") continue;

      const eff = effectifs[id] || { nb_filles:0, nb_garcons:0 };
      const f = eff.nb_filles || 0;
      const g = eff.nb_garcons || 0;
      const total = f + g;

      stats.totalClasses++;
      stats.totalEleves += total;
      stats.totalFilles += f;
      stats.totalGarcons += g;

      if (classe.ecoleId && stats.ecoleStats[classe.ecoleId]) {
        stats.ecoleStats[classe.ecoleId].classes++;
        stats.ecoleStats[classe.ecoleId].eleves += total;
        stats.ecoleStats[classe.ecoleId].filles += f;
        stats.ecoleStats[classe.ecoleId].garcons += g;
      }
    }

    return stats;
  }

  // Stats détaillées par cycle (pour rapports + PDF)
  function getStatsDetaillees() {
    const statsMaternelle = { 1:0, 2:0, 3:0, filles:{1:0,2:0,3:0}, garcons:{1:0,2:0,3:0} };
    const statsPrimaire = { 1:0,2:0,3:0,4:0,5:0,6:0, filles:{1:0,2:0,3:0,4:0,5:0,6:0}, garcons:{1:0,2:0,3:0,4:0,5:0,6:0} };
    const statsCTEB = { 7:0, 8:0, filles:{7:0,8:0}, garcons:{7:0,8:0} };
    const statsCycleLong = {};
    const statsCycleCourt = {};

    for (const id in classes) {
      if (!classes.hasOwnProperty(id)) continue;
      const classe = classes[id];
      if (classe.statut === "supprime") continue;

      const eff = effectifs[id] || { nb_filles:0, nb_garcons:0 };
      const f = eff.nb_filles || 0;
      const g = eff.nb_garcons || 0;

      const niveau = classe.niveau;
      const cycle = classe.cycle;
      const option = classe.optionCode;

      if (cycle === "maternelle") {
        statsMaternelle[niveau] = (statsMaternelle[niveau] || 0) + f + g;
        statsMaternelle.filles[niveau] = (statsMaternelle.filles[niveau] || 0) + f;
        statsMaternelle.garcons[niveau] = (statsMaternelle.garcons[niveau] || 0) + g;
      } else if (cycle === "primaire") {
        statsPrimaire[niveau] = (statsPrimaire[niveau] || 0) + f + g;
        statsPrimaire.filles[niveau] = (statsPrimaire.filles[niveau] || 0) + f;
        statsPrimaire.garcons[niveau] = (statsPrimaire.garcons[niveau] || 0) + g;
      } else if (cycle === "secondaire") {
        const sousCycle = classe.sousCycle;
        if (sousCycle === "cteb") {
          statsCTEB[niveau] = (statsCTEB[niveau] || 0) + f + g;
          statsCTEB.filles[niveau] = (statsCTEB.filles[niveau] || 0) + f;
          statsCTEB.garcons[niveau] = (statsCTEB.garcons[niveau] || 0) + g;
        } else if (sousCycle === "long") {
          if (!statsCycleLong[niveau]) statsCycleLong[niveau] = {};
          if (!statsCycleLong[niveau][option]) {
            statsCycleLong[niveau][option] = { total:0, filles:0, garcons:0, optionLibelle: classe.optionLibelle };
          }
          statsCycleLong[niveau][option].total += f + g;
          statsCycleLong[niveau][option].filles += f;
          statsCycleLong[niveau][option].garcons += g;
        } else if (sousCycle === "court") {
          if (!statsCycleCourt[niveau]) statsCycleCourt[niveau] = {};
          if (!statsCycleCourt[niveau][option]) {
            statsCycleCourt[niveau][option] = { total:0, filles:0, garcons:0, optionLibelle: classe.optionLibelle };
          }
          statsCycleCourt[niveau][option].total += f + g;
          statsCycleCourt[niveau][option].filles += f;
          statsCycleCourt[niveau][option].garcons += g;
        }
      }
    }

    return { statsMaternelle, statsPrimaire, statsCTEB, statsCycleLong, statsCycleCourt };
  }

  // ==================== RENDU ====================
  function renderAll() {
    const stats = getStats();
    renderKPIs(stats);
    renderEcoleSummaryTable(stats);
    renderEcoleManagementTable(stats);
    renderReports(stats);
    if (window.Chart) renderEvolutionChart();
  }

  function renderKPIs(stats) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = fmt(val); };
    set("total-ecoles", stats.totalEcoles);
    set("total-classes", stats.totalClasses);
    set("total-eleves", stats.totalEleves);
    set("total-filles", stats.totalFilles);
    set("total-garcons", stats.totalGarcons);
    set("ecoles-publiques", stats.ecolesPubliques);
    set("ecoles-privees", stats.ecolesPrivees);
  }

  function renderEcoleSummaryTable(stats) {
    const container = document.getElementById("ecole-summary-container");
    if (!container) return;

    if (Object.keys(stats.ecoleStats).length === 0) {
      container.innerHTML = '<div class="empty">Aucune école. Créez-en une dans la section "Écoles".</div>';
      return;
    }

    let html = '<table class="data-table">';
    html += '<thead><tr>';
    html += '<th>École</th>';
    html += '<th>Responsable</th>';
    html += '<th>Cycle</th>';
    html += '<th>Classes</th>';
    html += '<th>Filles</th>';
    html += '<th>Garçons</th>';
    html += '<th><strong>Total élèves</strong></th>';
    html += '</tr></thead><tbody>';

    for (const ecoleId in stats.ecoleStats) {
      if (!stats.ecoleStats.hasOwnProperty(ecoleId)) continue;
      const s = stats.ecoleStats[ecoleId];
      let cycleLabel = "Tous";
      if (s.cycle === "maternelle") cycleLabel = "Maternelle";
      else if (s.cycle === "primaire") cycleLabel = "Primaire";
      else if (s.cycle === "secondaire") cycleLabel = "Secondaire";

      html += '<tr>';
      html += '<td><strong>' + escape(s.nom) + '</strong></td>';
      html += '<td>' + escape(s.responsable || "-") + '</td>';
      html += '<td>' + cycleLabel + '</td>';
      html += '<td>' + fmt(s.classes) + '</td>';
      html += '<td>' + fmt(s.filles) + ' (' + pct(s.filles, s.eleves) + ')</td>';
      html += '<td>' + fmt(s.garcons) + ' (' + pct(s.garcons, s.eleves) + ')</td>';
      html += '<td><strong>' + fmt(s.eleves) + '</strong></td>';
      html += '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function renderEcoleManagementTable(stats) {
    const container = document.getElementById("ecole-management-container");
    if (!container) return;

    if (Object.keys(ecoles).length === 0) {
      container.innerHTML = '<div class="empty">Aucune école. Cliquez sur "Nouvelle École" pour commencer.</div>';
      return;
    }

    let html = '<table class="data-table">';
    html += '<thead><tr>';
    html += '<th>Nom</th>';
    html += '<th>Responsable</th>';
    html += '<th>Cycle</th>';
    html += '<th>Email</th>';
    html += '<th>Classes</th>';
    html += '<th>Statut</th>';
    html += '<th>Actions</th>';
    html += '</tr></thead><tbody>';

    for (const ecoleId in ecoles) {
      if (!ecoles.hasOwnProperty(ecoleId)) continue;
      const ecole = ecoles[ecoleId];
      if (ecole.statut === "supprime") continue;

      const s = stats.ecoleStats[ecoleId] || { classes: 0 };
      const statusBadge = ecole.statut === "inactif" ? "badge-muted" : "badge-success";
      const statusText = ecole.statut === "inactif" ? "Inactif" : "Actif";

      let cycleLabel = "Tous";
      if (ecole.cycle === "maternelle") cycleLabel = "Maternelle";
      else if (ecole.cycle === "primaire") cycleLabel = "Primaire";
      else if (ecole.cycle === "secondaire") cycleLabel = "Secondaire";

      html += '<tr>';
      html += '<td><strong>' + escape(ecole.nom) + '</strong></td>';
      html += '<td>' + escape(ecole.responsable || "-") + '</td>';
      html += '<td>' + cycleLabel + '</td>';
      html += '<td>' + escape(ecole.email || "-") + '</td>';
      html += '<td>' + fmt(s.classes) + '</td>';
      html += '<td><span class="badge ' + statusBadge + '">' + statusText + '</span></td>';
      html += '<td>';
      html += '  <div class="row-actions">';
      html += '    <button class="icon-btn" onclick="editEcole(\'' + ecoleId + '\')" title="Modifier"><i class="fas fa-edit"></i></button>';
      html += '    <button class="icon-btn" onclick="resetEcolePassword(\'' + escape(ecole.email || '') + '\', \'' + escape(ecole.nom) + '\')" title="Réinitialiser MDP"><i class="fas fa-key"></i></button>';
      html += '    <button class="icon-btn ' + (ecole.statut === "inactif" ? "" : "warning") + '" onclick="toggleEcole(\'' + ecoleId + '\', \'' + (ecole.statut || "actif") + '\')" title="' + (ecole.statut === "inactif" ? "Réactiver" : "Désactiver") + '">';
      html += '      <i class="fas ' + (ecole.statut === "inactif" ? "fa-circle-play" : "fa-circle-pause") + '"></i>';
      html += '    </button>';
      html += '    <button class="icon-btn danger" onclick="deleteEcole(\'' + ecoleId + '\', \'' + escape(ecole.nom) + '\')" title="Supprimer"><i class="fas fa-trash"></i></button>';
      html += '  </div>';
      html += '</td>';
      html += '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ==================== RAPPORTS (UI) ====================
  function renderReports(stats) {
    const container = document.getElementById("reports-container");
    if (!container) return;

    const d = getStatsDetaillees();

    const thStyle = 'border:1px solid #e5e7eb;padding:6px 8px;background:#f3f4f6;text-align:left;';
    const tdStyle = 'border:1px solid #e5e7eb;padding:6px 8px;text-align:left;';
    const sectionStyle = 'font-size:14px;font-weight:bold;background:#eff6ff;padding:6px 10px;border-left:4px solid #2563eb;margin:20px 0 10px;';

    let html = '';

    html += '<div style="margin-bottom:25px;"><h3 style="' + sectionStyle + '">Cycle Maternelle</h3>';
    html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildMaternelleRows(d.statsMaternelle), thStyle, tdStyle);
    html += '</div>';

    html += '<div style="margin-bottom:25px;"><h3 style="' + sectionStyle + '">Cycle Primaire</h3>';
    html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildPrimaireRows(d.statsPrimaire), thStyle, tdStyle);
    html += '</div>';

    html += '<div style="margin-bottom:25px;"><h3 style="' + sectionStyle + '">CTEB (7ème & 8ème)</h3>';
    html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildCtebRows(d.statsCTEB), thStyle, tdStyle);
    html += '</div>';

    html += '<div style="margin-bottom:25px;"><h3 style="' + sectionStyle + '">Cycle Long (1ère → 4ème Humanité)</h3>';
    html += buildReportTable(['Niveau','Option','Code','Filles','Garçons','<strong>Total</strong>'], buildCycleLongRows(d.statsCycleLong), thStyle, tdStyle);
    html += '</div>';

    html += '<div style="margin-bottom:25px;"><h3 style="' + sectionStyle + '">Cycle Court (1ère → 3ème Humanité)</h3>';
    html += buildReportTable(['Niveau','Option','Code','Filles','Garçons','<strong>Total</strong>'], buildCycleCourtRows(d.statsCycleCourt), thStyle, tdStyle);
    html += '</div>';

    // Synthèse par École
    html += '<div style="margin-bottom:25px;"><h3 style="' + sectionStyle + '">Synthèse par École</h3>';
    html += buildReportTable(
      ['École','Cycle','Classes','Filles','Garçons','<strong>Total</strong>'],
      buildEcoleSummaryRows(stats),
      thStyle, tdStyle
    );
    html += '</div>';

    container.innerHTML = html;
  }

  // ---- Helpers de construction de lignes (UI + PDF) ----
  function buildMaternelleRows(s) {
    const rows = [];
    const niveaux = ["1ère Maternelle", "2ème Maternelle", "3ème Maternelle"];
    for (let i = 1; i <= 3; i++) {
      const total = s[i] || 0;
      const filles = s.filles[i] || 0;
      const garcons = s.garcons[i] || 0;
      rows.push([
        niveaux[i-1],
        fmt(filles) + ' (' + pct(filles, total) + ')',
        fmt(garcons) + ' (' + pct(garcons, total) + ')',
        '<strong>' + fmt(total) + '</strong>'
      ]);
    }
    return rows;
  }
  function buildPrimaireRows(s) {
    const rows = [];
    const niveaux = ["1ère Primaire", "2ème Primaire", "3ème Primaire", "4ème Primaire", "5ème Primaire", "6ème Primaire"];
    for (let i = 1; i <= 6; i++) {
      const total = s[i] || 0;
      const filles = s.filles[i] || 0;
      const garcons = s.garcons[i] || 0;
      rows.push([
        niveaux[i-1],
        fmt(filles) + ' (' + pct(filles, total) + ')',
        fmt(garcons) + ' (' + pct(garcons, total) + ')',
        '<strong>' + fmt(total) + '</strong>'
      ]);
    }
    return rows;
  }
  function buildCtebRows(s) {
    const rows = [];
    const niveaux = [7, 8];
    for (let n = 0; n < niveaux.length; n++) {
      const niv = niveaux[n];
      const total = s[niv] || 0;
      const filles = s.filles[niv] || 0;
      const garcons = s.garcons[niv] || 0;
      rows.push([
        niv + 'ème',
        fmt(filles) + ' (' + pct(filles, total) + ')',
        fmt(garcons) + ' (' + pct(garcons, total) + ')',
        '<strong>' + fmt(total) + '</strong>'
      ]);
    }
    return rows;
  }
  function buildCycleLongRows(s) {
    const rows = [];
    for (let niveau = 1; niveau <= 4; niveau++) {
      if (s[niveau] && Object.keys(s[niveau]).length > 0) {
        for (const code in s[niveau]) {
          if (!s[niveau].hasOwnProperty(code)) continue;
          const data = s[niveau][code];
          const total = data.total || 0;
          const filles = data.filles || 0;
          const garcons = data.garcons || 0;
          rows.push([
            niveau + "ère Humanité",
            escape(data.optionLibelle || code),
            code,
            fmt(filles) + ' (' + pct(filles, total) + ')',
            fmt(garcons) + ' (' + pct(garcons, total) + ')',
            '<strong>' + fmt(total) + '</strong>'
          ]);
        }
      }
    }
    if (rows.length === 0) rows.push(['—','—','—','0','0','<strong>0</strong>']);
    return rows;
  }
  function buildCycleCourtRows(s) {
    const rows = [];
    for (let niveau = 1; niveau <= 3; niveau++) {
      if (s[niveau] && Object.keys(s[niveau]).length > 0) {
        for (const code in s[niveau]) {
          if (!s[niveau].hasOwnProperty(code)) continue;
          const data = s[niveau][code];
          const total = data.total || 0;
          const filles = data.filles || 0;
          const garcons = data.garcons || 0;
          rows.push([
            niveau + "ère Humanité",
            escape(data.optionLibelle || code),
            code,
            fmt(filles) + ' (' + pct(filles, total) + ')',
            fmt(garcons) + ' (' + pct(garcons, total) + ')',
            '<strong>' + fmt(total) + '</strong>'
          ]);
        }
      }
    }
    if (rows.length === 0) rows.push(['—','—','—','0','0','<strong>0</strong>']);
    return rows;
  }
  function buildEcoleSummaryRows(stats) {
    const rows = [];
    for (const ecoleId in stats.ecoleStats) {
      if (!stats.ecoleStats.hasOwnProperty(ecoleId)) continue;
      const s = stats.ecoleStats[ecoleId];
      let cycleLabel = "Tous";
      if (s.cycle === "maternelle") cycleLabel = "Maternelle";
      else if (s.cycle === "primaire") cycleLabel = "Primaire";
      else if (s.cycle === "secondaire") cycleLabel = "Secondaire";
      rows.push([
        escape(s.nom),
        cycleLabel,
        fmt(s.classes),
        fmt(s.filles) + ' (' + pct(s.filles, s.eleves) + ')',
        fmt(s.garcons) + ' (' + pct(s.garcons, s.eleves) + ')',
        '<strong>' + fmt(s.eleves) + '</strong>'
      ]);
    }
    if (rows.length === 0) rows.push(['—','—','0','0','0','<strong>0</strong>']);
    return rows;
  }

  function buildReportTable(headers, rows, thStyle, tdStyle) {
    let html = '<table style="width:100%;border-collapse:collapse;margin-bottom:15px;font-size:12px;">';
    html += '<thead><tr>';
    for (let h = 0; h < headers.length; h++) html += '<th style="' + thStyle + '">' + headers[h] + '</th>';
    html += '</tr></thead><tbody>';
    for (let r = 0; r < rows.length; r++) {
      html += '<tr>';
      for (let c = 0; c < rows[r].length; c++) html += '<td style="' + tdStyle + '">' + rows[r][c] + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  // ==================== EXPORT PDF (vrai PDF via html2pdf) ====================
  function buildPdfFilename() {
    const nomEntite = (currentProfile && currentProfile.nomEntite) ? currentProfile.nomEntite : "SOUS_DIVISION";
    const slug = String(nomEntite)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase();
    const d = new Date();
    const pad = (n) => n < 10 ? "0" + n : "" + n;
    const date = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    return "RAPPORT_STATISTIQUE_" + slug + "_" + date;
  }

  function exportToPdf() {
    if (!window.html2pdf) {
      toast("Bibliothèque PDF indisponible (html2pdf manquant)", "error");
      return;
    }

    toast("Préparation du rapport PDF...", "info");

    const nomEntite = (currentProfile && currentProfile.nomEntite) || "Sous-Division";
    const responsable = (currentProfile && currentProfile.responsable) || "Non spécifié";
    const now = new Date();
    const dateRapport = now.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
    const yyyy = now.getFullYear();
    const serial = generateSerialNumber();

    const stats = getStats();
    const d = getStatsDetaillees();

    const wrapper = document.createElement("div");
    wrapper.style.cssText = "font-family:'Inter',Arial,sans-serif;padding:20px;color:#111827;background:white;width:1123px;";

    const thStyle = 'border:1px solid #e5e7eb;padding:6px 8px;background:#f3f4f6;text-align:left;';
    const tdStyle = 'border:1px solid #e5e7eb;padding:6px 8px;text-align:left;';
    const sectionStyle = 'font-size:14px;font-weight:bold;background:#eff6ff;padding:6px 10px;border-left:4px solid #2563eb;margin:20px 0 10px;';

    let html = "";

    // En-tête officiel
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid #2563eb;">';
    html += '  <img src="../img/logo min backless.png" alt="RDC Ministère" style="height:120px;object-fit:contain;" />';
    html += '  <div style="text-align:center;flex:1;padding:0 20px;">';
    html += '    <div style="font-size:11px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">REPUBLIQUE DEMOCRATIQUE DU CONGO</div>';
    html += '    <div style="font-size:10px;color:#374151;margin-top:2px;">MINISTERE DE L\'EDUCATION NATIONALE ET NOUVELLE CITOYENNETE</div>';
    html += '    <div style="font-size:14px;font-weight:bold;color:#1e3a8a;margin-top:6px;">' + escape(nomEntite).toUpperCase() + '</div>';
    html += '    <div style="font-size:12px;font-weight:600;color:#2563eb;margin-top:4px;">RAPPORT STATISTIQUE DES BULLETINS SCOLAIRES ' + yyyy + '-' + (yyyy + 1) + '</div>';
    html += '  </div>';
    html += '  <div style="width:80px;"></div>';
    html += '</div>';

    // Synthèse globale
    html += '<div style="' + sectionStyle + '">1. SYNTHÈSE GLOBALE</div>';
    html += '<table style="width:100%;border-collapse:collapse;margin-bottom:15px;font-size:12px;">';
    html += '<thead><tr>';
    html += '<th style="' + thStyle + '">Indicateur</th><th style="' + thStyle + '">Valeur</th>';
    html += '</tr></thead><tbody>';
    html += '<tr><td style="' + tdStyle + '">Écoles</td><td style="' + tdStyle + '">' + fmt(stats.totalEcoles) + '</td></tr>';
    html += '<tr><td style="' + tdStyle + '">Classes</td><td style="' + tdStyle + '">' + fmt(stats.totalClasses) + '</td></tr>';
    html += '<tr><td style="' + tdStyle + '">Total élèves</td><td style="' + tdStyle + '"><strong>' + fmt(stats.totalEleves) + '</strong></td></tr>';
    html += '<tr><td style="' + tdStyle + '">Filles</td><td style="' + tdStyle + '">' + fmt(stats.totalFilles) + ' (' + pct(stats.totalFilles, stats.totalEleves) + ')</td></tr>';
    html += '<tr><td style="' + tdStyle + '">Garçons</td><td style="' + tdStyle + '">' + fmt(stats.totalGarcons) + ' (' + pct(stats.totalGarcons, stats.totalEleves) + ')</td></tr>';
    html += '</tbody></table>';

    html += '<div style="' + sectionStyle + '">2. CYCLE MATERNELLE</div>';
    html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildMaternelleRows(d.statsMaternelle), thStyle, tdStyle);

    html += '<div style="' + sectionStyle + '">3. CYCLE PRIMAIRE</div>';
    html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildPrimaireRows(d.statsPrimaire), thStyle, tdStyle);

    html += '<div style="' + sectionStyle + '">4. CTEB (7ème & 8ème)</div>';
    html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildCtebRows(d.statsCTEB), thStyle, tdStyle);

    html += '<div style="' + sectionStyle + '">5. CYCLE LONG</div>';
    html += buildReportTable(['Niveau','Option','Code','Filles','Garçons','<strong>Total</strong>'], buildCycleLongRows(d.statsCycleLong), thStyle, tdStyle);

    html += '<div style="' + sectionStyle + '">6. CYCLE COURT</div>';
    html += buildReportTable(['Niveau','Option','Code','Filles','Garçons','<strong>Total</strong>'], buildCycleCourtRows(d.statsCycleCourt), thStyle, tdStyle);

    html += '<div style="' + sectionStyle + '">7. SYNTHÈSE PAR ÉCOLE</div>';
    html += buildReportTable(
      ['École','Cycle','Classes','Filles','Garçons','<strong>Total</strong>'],
      buildEcoleSummaryRows(stats),
      thStyle, tdStyle
    );

    // Pied de page officiel
    html += '<div style="margin-top:30px;padding-top:15px;border-top:2px solid #2563eb;display:flex;justify-content:space-between;align-items:flex-end;">';
    html += '  <div style="width:280px;text-align:center;">';
    html += '    <div style="font-size:11px;">Fait à Kinshasa, le ' + dateRapport + '</div>';
    html += '    <div style="margin-top:50px;border-top:1px solid #000;width:100%;"></div>';
    html += '    <div style="margin-top:6px;font-size:11px;">Le Chef de Sous-Division</div>';
    html += '    <div style="font-size:12px;font-weight:bold;">' + escape(responsable) + '</div>';
    html += '  </div>';
    html += '  <div style="text-align:center;font-size:9px;color:#6b7280;">';
    html += '    <div>' + serial + '</div>';
    html += '  </div>';
    html += '  <div style="width:140px;height:90px;border:1px dashed #9ca3af;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:10px;">Sceau / Cachet</div>';
    html += '</div>';

    wrapper.innerHTML = html;

    const filename = buildPdfFilename() + ".pdf";

    const opt = {
      margin:       [10, 10, 10, 10],
      filename:     filename,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true, logging: false },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'landscape' },
      pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
    };

    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;z-index:-9999;";
    wrapper.style.position = "relative";
    wrapper.style.left = "0";
    wrapper.style.top = "0";
    host.appendChild(wrapper);
    document.body.appendChild(host);

    setTimeout(() => {
      window.html2pdf().set(opt).from(wrapper).save().then(() => {
        if (host.parentNode) document.body.removeChild(host);
        toast("Rapport PDF généré : " + filename, "success");
      }).catch((err) => {
        if (host.parentNode) document.body.removeChild(host);
        console.error(err);
        toast("Erreur lors de la génération du PDF", "error");
      });
    }, 100);
  }

  // ==================== CHART ====================
  function renderEvolutionChart() {
    const ctx = document.getElementById("chart-evolution");
    if (!ctx || !window.Chart) return;

    if (evolutionChart) evolutionChart.destroy();

    const labels = [];
    const data = [];
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labels.push(d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }));
      data.push(0);
    }

    for (const id in classes) {
      if (!classes.hasOwnProperty(id)) continue;
      const classe = classes[id];
      if (classe.statut === "supprime") continue;
      const eff = effectifs[id];
      if (!eff) continue;
      const last = eff.lastUpdate || 0;
      if (!last) continue;
      const total = (eff.nb_filles || 0) + (eff.nb_garcons || 0);
      const dEff = new Date(last);
      for (let i = 0; i < 12; i++) {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
        if (dEff.getFullYear() === monthDate.getFullYear() && dEff.getMonth() === monthDate.getMonth()) {
          data[i] += total;
          break;
        }
      }
    }

    evolutionChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [{
          label: "Effectifs",
          data: data,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: "#2563eb"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: { y: { beginAtZero: true, title: { display: true, text: "Nombre d'élèves" } } }
      }
    });
  }

  // ==================== ÉCOLE CRUD ====================
  function openEcoleModal(id = null) {
    const modal = document.getElementById("modal-ecole");
    if (!modal) return;

    const ecoleIdInput = document.getElementById("ecole-id");
    const nomInput = document.getElementById("ecole-nom");
    const respInput = document.getElementById("ecole-responsable");
    const cycleSelect = document.getElementById("ecole-cycle");
    const categorieSelect = document.getElementById("ecole-categorie");
    const emailInput = document.getElementById("ecole-email");
    const passwordInput = document.getElementById("ecole-password");
    const passwordField = document.getElementById("field-password");
    const modalTitle = document.getElementById("modal-ecole-title");

    if (id && ecoles[id]) {
      const ecole = ecoles[id];
      if (ecoleIdInput) ecoleIdInput.value = id;
      if (nomInput) nomInput.value = ecole.nom || "";
      if (respInput) respInput.value = ecole.responsable || "";
      if (cycleSelect) cycleSelect.value = ecole.cycle || "";
      if (categorieSelect) categorieSelect.value = ecole.categorie || "";
      if (emailInput) {
        emailInput.value = ecole.email || "";
        emailInput.disabled = true;
      }
      if (passwordField) passwordField.style.display = "none";
      if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-edit"></i> Modifier l\'École';
    } else {
      if (ecoleIdInput) ecoleIdInput.value = "";
      if (nomInput) nomInput.value = "";
      if (respInput) respInput.value = "";
      if (cycleSelect) cycleSelect.value = "";
      if (categorieSelect) categorieSelect.value = "";
      if (emailInput) {
        emailInput.value = "";
        emailInput.disabled = false;
      }
      if (passwordInput) passwordInput.value = generatePassword(10);
      if (passwordField) passwordField.style.display = "";
      if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-plus-circle"></i> Nouvelle École';
    }

    modal.classList.add("show");
    if (nomInput) nomInput.focus();
  }

  async function saveEcole(e) {
    e.preventDefault();

    const id = document.getElementById("ecole-id").value;
    const nom = document.getElementById("ecole-nom").value.trim();
    const responsable = document.getElementById("ecole-responsable").value.trim();
    const cycle = document.getElementById("ecole-cycle").value;
    const categorie = document.getElementById("ecole-categorie").value;
    const email = document.getElementById("ecole-email").value.trim();
    const password = document.getElementById("ecole-password").value;

    if (!nom || !email || !categorie) {
      toast("Le nom, l'email et la catégorie sont obligatoires", "error");
      return;
    }

    try {
      if (id) {
        await db.ref("ecoles/" + id).update({
          nom: nom,
          responsable: responsable,
          cycle: cycle,
          categorie: categorie,
          updatedAt: firebase.database.ServerValue.TIMESTAMP
        });
        await db.ref("utilisateurs/" + id).update({
          nomEntite: nom,
          responsable: responsable,
          cycle: cycle,
          categorie: categorie
        });
        toast("École mise à jour", "success");
      } else {
        const secAuth = getSecondaryAuth();
        const cred = await secAuth.createUserWithEmailAndPassword(email, password);
        const newUid = cred.user.uid;

        const ecoleData = {
          nom: nom,
          responsable: responsable,
          cycle: cycle,
          categorie: categorie,
          email: email,
          sdId: currentSdId,
          ippId: currentIppId,
          statut: "actif",
          createdAt: firebase.database.ServerValue.TIMESTAMP
        };

        await db.ref("ecoles/" + newUid).set(ecoleData);
        await db.ref("utilisateurs/" + newUid).set({
          role: "ecole",
          nomEntite: nom,
          responsable: responsable,
          cycle: cycle,
          categorie: categorie,
          entiteId: newUid,
          ecoleId: newUid,
          sdId: currentSdId,
          ippId: currentIppId,
          email: email,
          createdAt: firebase.database.ServerValue.TIMESTAMP
        });

        await secAuth.signOut();

        toast('École "' + nom + '" créée. Mot de passe : ' + password, "success");
      }

      document.getElementById("modal-ecole").classList.remove("show");

    } catch (error) {
      console.error(error);
      toast("Erreur : " + error.message, "error");
    }
  }

  async function resetEcolePassword(email, nom) {
    if (!email) { toast("Cette École n'a pas d'email", "error"); return; }
    const ok = await confirmDialog("Réinitialiser le mot de passe", "Envoyer un email à " + email + " ?");
    if (!ok) return;
    try {
      await auth.sendPasswordResetEmail(email);
      toast("Email envoyé à " + email, "success");
    } catch (err) { toast(err.message, "error"); }
  }

  async function toggleEcole(id, currentStatut) {
    const ecole = ecoles[id];
    if (!ecole) return;

    const willInactivate = currentStatut !== "inactif";
    const ok = await confirmDialog(
      willInactivate ? "Désactiver cette École ?" : "Réactiver cette École ?",
      willInactivate
        ? 'L\'École "' + ecole.nom + '" sera marquée inactive.'
        : 'L\'École "' + ecole.nom + '" redeviendra active.'
    );
    if (!ok) return;

    try {
      await db.ref("ecoles/" + id + "/statut").set(willInactivate ? "inactif" : "actif");
      toast(willInactivate ? "École désactivée" : "École réactivée", "success");
    } catch (err) {
      toast("Erreur : " + err.message, "error");
    }
  }

  async function deleteEcole(id, nom) {
    const ok = await confirmDialog(
      "⚠️ Supprimer définitivement ?",
      'L\'École "' + nom + '" sera marquée supprimée. Action IRRÉVERSIBLE.'
    );
    if (!ok) return;

    try {
      await db.ref("ecoles/" + id + "/statut").set("supprime");
      toast('École "' + nom + '" supprimée', "success");
    } catch (err) {
      toast("Erreur : " + err.message, "error");
    }
  }

  // Exposer pour onclick
  window.editEcole = openEcoleModal;
  window.toggleEcole = toggleEcole;
  window.deleteEcole = deleteEcole;
  window.resetEcolePassword = resetEcolePassword;

  // ==================== HELPERS ====================
  function escape(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function confirmDialog(title, message) {
    return new Promise((resolve) => {
      const modal = document.getElementById("modal-confirm");
      if (!modal) { resolve(false); return; }

      const confirmTitle = document.getElementById("confirm-title");
      const confirmMessage = document.getElementById("confirm-message");
      const okBtn = document.getElementById("confirm-ok");

      if (confirmTitle) confirmTitle.innerHTML = '<i class="fas fa-circle-question"></i> ' + escape(title);
      if (confirmMessage) confirmMessage.textContent = message;

      const onOk = function() { cleanup(); resolve(true); };
      const onCancel = function() { cleanup(); resolve(false); };

      function cleanup() {
        modal.classList.remove("show");
        if (okBtn) okBtn.removeEventListener("click", onOk);
        const closeButtons = modal.querySelectorAll("[data-close-modal]");
        closeButtons.forEach(btn => btn.removeEventListener("click", onCancel));
      }

      if (okBtn) okBtn.addEventListener("click", onOk);
      const closeButtons = modal.querySelectorAll("[data-close-modal]");
      closeButtons.forEach(btn => btn.addEventListener("click", onCancel));
      modal.classList.add("show");
    });
  }

  function toast(msg, type) {
    const toastEl = document.getElementById("toast");
    const toastMsg = document.getElementById("toast-msg");
    if (!toastEl) return;
    if (toastMsg) toastMsg.textContent = msg;
    toastEl.className = "toast " + (type || "info");
    toastEl.classList.remove("hidden");
    setTimeout(() => toastEl.classList.add("hidden"), 3000);
  }
})();
