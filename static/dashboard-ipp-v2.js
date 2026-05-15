/* ============================================================
   EKOLSTAT — Tableau de bord IPP - Version 2.0
   Responsabilités : Gestion des Sous-Divisions, suivi provincial
   ============================================================ */

(function() {
  const auth = firebase.auth();
  const db = firebase.database();

  let currentUser = null;
  let currentProfile = null;
  let currentIppId = null;

  // État global
  let sousDivisions = {};
  let ecoles = {};
  let classes = {};
  let effectifs = {};

  // Graphique
  let evolutionChart = null;

  // Application Firebase secondaire (pour créer des comptes sans déconnecter l'IPP)
  let secondaryApp = null;
  function getSecondaryAuth() {
    if (!secondaryApp) {
      try {
        secondaryApp = firebase.initializeApp(firebase.app().options, "ekolstat-create-sd");
      } catch (e) {
        secondaryApp = firebase.app("ekolstat-create-sd");
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
    if (currentProfile.role !== "ipp") {
      toast("Accès non autorisé", "error");
      await auth.signOut();
      setTimeout(() => window.location.href = "../index.html", 1200);
      return;
    }

    currentUser = user;
    currentIppId = currentProfile.entiteId || currentProfile.ippId || user.uid;

    document.getElementById("user-name").textContent = currentProfile.nomEntite || "IPP";
    document.getElementById("user-role").textContent = "Inspection Principale Provinciale";

    init();
  });

  // ==================== INITIALISATION ====================
  function init() {
    bindEvents();
    loadData();
  }

  function loadData() {
    // Sous-divisions rattachées à cette IPP
    db.ref("sousDivisions").orderByChild("ippId").equalTo(currentIppId).on("value", (snap) => {
      sousDivisions = snap.val() || {};
      renderAll();
    });

    // Écoles
    db.ref("ecoles").orderByChild("ippId").equalTo(currentIppId).on("value", (snap) => {
      ecoles = snap.val() || {};
      renderAll();
    });

    // Classes
    db.ref("classes").orderByChild("ippId").equalTo(currentIppId).on("value", (snap) => {
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
        const rows = document.querySelectorAll("#sd-summary-container tr, #sd-management-container tr");
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
          "sous-divisions": "Sous-Divisions",
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

    // Modal SD
    const btnNewSd = document.getElementById("btn-new-sd");
    const formSd = document.getElementById("form-sd");
    if (btnNewSd) btnNewSd.addEventListener("click", () => openSdModal());
    if (formSd) formSd.addEventListener("submit", saveSd);

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
    const sidebarToggle = document.getElementById("sidebar-toggle");

    if (burger && sidebar) {
      burger.addEventListener("click", () => {
        // Mobile/tablette : drawer + overlay
        // Desktop (>1024px) : toggle collapse/expand de la sidebar en place
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
    // Si la fenêtre passe de mobile à desktop, on referme le drawer proprement
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
      totalSD: 0,
      totalEcoles: 0,
      totalClasses: 0,
      totalEleves: 0,
      totalFilles: 0,
      totalGarcons: 0,
      totalFillesHandicap: 0,
      totalGarconsHandicap: 0,
      sdStats: {}
    };

    // Compter les SD actives
    for (const sdId in sousDivisions) {
      if (!sousDivisions.hasOwnProperty(sdId)) continue;
      const sd = sousDivisions[sdId];
      if (sd.statut === "supprime") continue;
      stats.totalSD++;
      stats.sdStats[sdId] = {
        nom: sd.nom,
        responsable: sd.responsable || "",
        statut: sd.statut || "actif",
        ecoles: 0, classes: 0, eleves: 0, filles: 0, garcons: 0, handicap: 0
      };
    }

    // Écoles
    for (const ecoleId in ecoles) {
      if (!ecoles.hasOwnProperty(ecoleId)) continue;
      const ecole = ecoles[ecoleId];
      if (ecole.statut === "supprime") continue;
      stats.totalEcoles++;
      if (ecole.sdId && stats.sdStats[ecole.sdId]) {
        stats.sdStats[ecole.sdId].ecoles++;
      }
    }

    // Classes + effectifs
    for (const id in classes) {
      if (!classes.hasOwnProperty(id)) continue;
      const classe = classes[id];
      if (classe.statut === "supprime") continue;

      const eff = effectifs[id] || { nb_filles:0, nb_garcons:0, nb_filles_handicap:0, nb_garcons_handicap:0 };
      const f = eff.nb_filles || 0;
      const g = eff.nb_garcons || 0;
      const fh = eff.nb_filles_handicap || 0;
      const gh = eff.nb_garcons_handicap || 0;
      const total = f + g;

      stats.totalClasses++;
      stats.totalEleves += total;
      stats.totalFilles += f;
      stats.totalGarcons += g;
      stats.totalFillesHandicap += fh;
      stats.totalGarconsHandicap += gh;

      if (classe.sdId && stats.sdStats[classe.sdId]) {
        stats.sdStats[classe.sdId].classes++;
        stats.sdStats[classe.sdId].eleves += total;
        stats.sdStats[classe.sdId].filles += f;
        stats.sdStats[classe.sdId].garcons += g;
        stats.sdStats[classe.sdId].handicap += fh + gh;
      }
    }

    return stats;
  }

  // Stats détaillées par cycle (pour rapports + PDF)
  function getStatsDetaillees() {
    const statsMaternelle = { 1:0, 2:0, 3:0, filles:{1:0,2:0,3:0}, garcons:{1:0,2:0,3:0}, handicap:{1:0,2:0,3:0} };
    const statsPrimaire = { 1:0,2:0,3:0,4:0,5:0,6:0, filles:{1:0,2:0,3:0,4:0,5:0,6:0}, garcons:{1:0,2:0,3:0,4:0,5:0,6:0}, handicap:{1:0,2:0,3:0,4:0,5:0,6:0} };
    const statsCTEB = { 7:0, 8:0, filles:{7:0,8:0}, garcons:{7:0,8:0}, handicap:{7:0,8:0} };
    const statsCycleLong = {};
    const statsCycleCourt = {};

    for (const id in classes) {
      if (!classes.hasOwnProperty(id)) continue;
      const classe = classes[id];
      if (classe.statut === "supprime") continue;

      const eff = effectifs[id] || { nb_filles:0, nb_garcons:0, nb_filles_handicap:0, nb_garcons_handicap:0 };
      const f = eff.nb_filles || 0;
      const g = eff.nb_garcons || 0;
      const fh = eff.nb_filles_handicap || 0;
      const gh = eff.nb_garcons_handicap || 0;

      const niveau = classe.niveau;
      const cycle = classe.cycle;
      const option = classe.optionCode;

      if (cycle === "maternelle") {
        statsMaternelle[niveau] = (statsMaternelle[niveau] || 0) + f + g;
        statsMaternelle.filles[niveau] = (statsMaternelle.filles[niveau] || 0) + f;
        statsMaternelle.garcons[niveau] = (statsMaternelle.garcons[niveau] || 0) + g;
        statsMaternelle.handicap[niveau] = (statsMaternelle.handicap[niveau] || 0) + fh + gh;
      } else if (cycle === "primaire") {
        statsPrimaire[niveau] = (statsPrimaire[niveau] || 0) + f + g;
        statsPrimaire.filles[niveau] = (statsPrimaire.filles[niveau] || 0) + f;
        statsPrimaire.garcons[niveau] = (statsPrimaire.garcons[niveau] || 0) + g;
        statsPrimaire.handicap[niveau] = (statsPrimaire.handicap[niveau] || 0) + fh + gh;
      } else if (cycle === "secondaire") {
        const sousCycle = classe.sousCycle;
        if (sousCycle === "cteb") {
          statsCTEB[niveau] = (statsCTEB[niveau] || 0) + f + g;
          statsCTEB.filles[niveau] = (statsCTEB.filles[niveau] || 0) + f;
          statsCTEB.garcons[niveau] = (statsCTEB.garcons[niveau] || 0) + g;
          statsCTEB.handicap[niveau] = (statsCTEB.handicap[niveau] || 0) + fh + gh;
        } else if (sousCycle === "long") {
          if (!statsCycleLong[niveau]) statsCycleLong[niveau] = {};
          if (!statsCycleLong[niveau][option]) {
            statsCycleLong[niveau][option] = { total:0, filles:0, garcons:0, handicap:0, optionLibelle: classe.optionLibelle };
          }
          statsCycleLong[niveau][option].total += f + g;
          statsCycleLong[niveau][option].filles += f;
          statsCycleLong[niveau][option].garcons += g;
          statsCycleLong[niveau][option].handicap += fh + gh;
        } else if (sousCycle === "court") {
          if (!statsCycleCourt[niveau]) statsCycleCourt[niveau] = {};
          if (!statsCycleCourt[niveau][option]) {
            statsCycleCourt[niveau][option] = { total:0, filles:0, garcons:0, handicap:0, optionLibelle: classe.optionLibelle };
          }
          statsCycleCourt[niveau][option].total += f + g;
          statsCycleCourt[niveau][option].filles += f;
          statsCycleCourt[niveau][option].garcons += g;
          statsCycleCourt[niveau][option].handicap += fh + gh;
        }
      }
    }

    return { statsMaternelle, statsPrimaire, statsCTEB, statsCycleLong, statsCycleCourt };
  }

  // ==================== RENDU ====================
  function renderAll() {
    const stats = getStats();
    renderKPIs(stats);
    renderSDSummaryTable(stats);
    renderSDManagementTable(stats);
    renderReports(stats);
    if (window.Chart) renderEvolutionChart();
  }

  function renderKPIs(stats) {
    const totalHandicap = stats.totalFillesHandicap + stats.totalGarconsHandicap;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = fmt(val); };
    set("total-sd", stats.totalSD);
    set("total-ecoles", stats.totalEcoles);
    set("total-eleves", stats.totalEleves);
    set("total-filles", stats.totalFilles);
    set("total-garcons", stats.totalGarcons);
    set("total-handicap", totalHandicap);
    set("total-filles-handicap", stats.totalFillesHandicap);
    set("total-garcons-handicap", stats.totalGarconsHandicap);
  }

  function renderSDSummaryTable(stats) {
    const container = document.getElementById("sd-summary-container");
    if (!container) return;

    if (Object.keys(stats.sdStats).length === 0) {
      container.innerHTML = '<div class="empty">Aucune Sous-Division. Créez-en une dans la section "Sous-Divisions".</div>';
      return;
    }

    let html = '<table class="data-table">';
    html += '<thead><tr>';
    html += '<th>Sous-Division</th>';
    html += '<th>Responsable</th>';
    html += '<th>Écoles</th>';
    html += '<th>Classes</th>';
    html += '<th>Total élèves</th>';
    html += '<th>Filles</th>';
    html += '<th>Garçons</th>';
    html += '<th>Handicapés</th>';
    html += '</tr></thead><tbody>';

    for (const sdId in stats.sdStats) {
      if (!stats.sdStats.hasOwnProperty(sdId)) continue;
      const s = stats.sdStats[sdId];
      html += '<tr>';
      html += '<td><strong>' + escape(s.nom) + '</strong></td>';
      html += '<td>' + escape(s.responsable || "-") + '</td>';
      html += '<td>' + fmt(s.ecoles) + '</td>';
      html += '<td>' + fmt(s.classes) + '</td>';
      html += '<td><strong>' + fmt(s.eleves) + '</strong></td>';
      html += '<td>' + fmt(s.filles) + ' (' + pct(s.filles, s.eleves) + ')</td>';
      html += '<td>' + fmt(s.garcons) + ' (' + pct(s.garcons, s.eleves) + ')</td>';
      html += '<td>' + fmt(s.handicap) + '</td>';
      html += '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function renderSDManagementTable(stats) {
    const container = document.getElementById("sd-management-container");
    if (!container) return;

    if (Object.keys(sousDivisions).length === 0) {
      container.innerHTML = '<div class="empty">Aucune Sous-Division. Cliquez sur "Nouvelle Sous-Division" pour commencer.</div>';
      return;
    }

    let html = '<table class="data-table">';
    html += '<thead><tr>';
    html += '<th>Nom</th>';
    html += '<th>Responsable</th>';
    html += '<th>Email</th>';
    html += '<th>Écoles</th>';
    html += '<th>Statut</th>';
    html += '<th>Actions</th>';
    html += '</tr></thead><tbody>';

    for (const sdId in sousDivisions) {
      if (!sousDivisions.hasOwnProperty(sdId)) continue;
      const sd = sousDivisions[sdId];
      if (sd.statut === "supprime") continue;

      const s = stats.sdStats[sdId] || { ecoles: 0 };
      const statusBadge = sd.statut === "inactif" ? "badge-muted" : "badge-success";
      const statusText = sd.statut === "inactif" ? "Inactif" : "Actif";

      html += '<tr>';
      html += '<td><strong>' + escape(sd.nom) + '</strong></td>';
      html += '<td>' + escape(sd.responsable || "-") + '</td>';
      html += '<td>' + escape(sd.email || "-") + '</td>';
      html += '<td>' + fmt(s.ecoles) + '</td>';
      html += '<td><span class="badge ' + statusBadge + '">' + statusText + '</span></td>';
      html += '<td>';
      html += '  <div class="row-actions">';
      html += '    <button class="icon-btn" onclick="editSd(\'' + sdId + '\')" title="Modifier"><i class="fas fa-edit"></i></button>';
      html += '    <button class="icon-btn ' + (sd.statut === "inactif" ? "" : "warning") + '" onclick="toggleSd(\'' + sdId + '\', \'' + (sd.statut || "actif") + '\')" title="' + (sd.statut === "inactif" ? "Réactiver" : "Désactiver") + '">';
      html += '      <i class="fas ' + (sd.statut === "inactif" ? "fa-circle-play" : "fa-circle-pause") + '"></i>';
      html += '    </button>';
      html += '    <button class="icon-btn danger" onclick="deleteSd(\'' + sdId + '\', \'' + escape(sd.nom) + '\')" title="Supprimer"><i class="fas fa-trash"></i></button>';
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
    html += buildReportTable(['Classe','Total','Filles','Garçons','Handicapés'], buildMaternelleRows(d.statsMaternelle), thStyle, tdStyle);
    html += '</div>';

    html += '<div style="margin-bottom:25px;"><h3 style="' + sectionStyle + '">Cycle Primaire</h3>';
    html += buildReportTable(['Classe','Total','Filles','Garçons','Handicapés'], buildPrimaireRows(d.statsPrimaire), thStyle, tdStyle);
    html += '</div>';

    html += '<div style="margin-bottom:25px;"><h3 style="' + sectionStyle + '">CTEB (7ème & 8ème)</h3>';
    html += buildReportTable(['Classe','Total','Filles','Garçons','Handicapés'], buildCtebRows(d.statsCTEB), thStyle, tdStyle);
    html += '</div>';

    html += '<div style="margin-bottom:25px;"><h3 style="' + sectionStyle + '">Cycle Long (1ère → 4ème Humanité)</h3>';
    html += buildReportTable(['Niveau','Option','Code','Total','Filles','Garçons','Handicap'], buildCycleLongRows(d.statsCycleLong), thStyle, tdStyle);
    html += '</div>';

    html += '<div style="margin-bottom:25px;"><h3 style="' + sectionStyle + '">Cycle Court (1ère → 3ème Humanité)</h3>';
    html += buildReportTable(['Niveau','Option','Code','Total','Filles','Garçons','Handicap'], buildCycleCourtRows(d.statsCycleCourt), thStyle, tdStyle);
    html += '</div>';

    // Synthèse par Sous-Division
    html += '<div style="margin-bottom:25px;"><h3 style="' + sectionStyle + '">Synthèse par Sous-Division</h3>';
    html += buildReportTable(
      ['Sous-Division','Écoles','Classes','Total','Filles','Garçons','Handicap'],
      buildSDSummaryRows(stats),
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
      const handicap = s.handicap[i] || 0;
      rows.push([
        niveaux[i-1],
        fmt(total),
        fmt(filles) + ' (' + pct(filles, total) + ')',
        fmt(garcons) + ' (' + pct(garcons, total) + ')',
        fmt(handicap) + ' (' + pct(handicap, total) + ')'
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
      const handicap = s.handicap[i] || 0;
      rows.push([
        niveaux[i-1],
        fmt(total),
        fmt(filles) + ' (' + pct(filles, total) + ')',
        fmt(garcons) + ' (' + pct(garcons, total) + ')',
        fmt(handicap) + ' (' + pct(handicap, total) + ')'
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
      const handicap = s.handicap[niv] || 0;
      rows.push([
        niv + 'ème',
        fmt(total),
        fmt(filles) + ' (' + pct(filles, total) + ')',
        fmt(garcons) + ' (' + pct(garcons, total) + ')',
        fmt(handicap) + ' (' + pct(handicap, total) + ')'
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
          const handicap = data.handicap || 0;
          rows.push([
            niveau + "ère Humanité",
            escape(data.optionLibelle || code),
            code,
            fmt(total),
            fmt(filles) + ' (' + pct(filles, total) + ')',
            fmt(garcons) + ' (' + pct(garcons, total) + ')',
            fmt(handicap) + ' (' + pct(handicap, total) + ')'
          ]);
        }
      }
    }
    if (rows.length === 0) rows.push(['—','—','—','0','0','0','0']);
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
          const handicap = data.handicap || 0;
          rows.push([
            niveau + "ère Humanité",
            escape(data.optionLibelle || code),
            code,
            fmt(total),
            fmt(filles) + ' (' + pct(filles, total) + ')',
            fmt(garcons) + ' (' + pct(garcons, total) + ')',
            fmt(handicap) + ' (' + pct(handicap, total) + ')'
          ]);
        }
      }
    }
    if (rows.length === 0) rows.push(['—','—','—','0','0','0','0']);
    return rows;
  }
  function buildSDSummaryRows(stats) {
    const rows = [];
    for (const sdId in stats.sdStats) {
      if (!stats.sdStats.hasOwnProperty(sdId)) continue;
      const s = stats.sdStats[sdId];
      rows.push([
        escape(s.nom),
        fmt(s.ecoles),
        fmt(s.classes),
        fmt(s.eleves),
        fmt(s.filles) + ' (' + pct(s.filles, s.eleves) + ')',
        fmt(s.garcons) + ' (' + pct(s.garcons, s.eleves) + ')',
        fmt(s.handicap)
      ]);
    }
    if (rows.length === 0) rows.push(['—','0','0','0','0','0','0']);
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
    const nomEntite = (currentProfile && currentProfile.nomEntite) ? currentProfile.nomEntite : "IPP";
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

    const nomEntite = (currentProfile && currentProfile.nomEntite) || "Inspection Principale Provinciale";
    const responsable = (currentProfile && currentProfile.responsable) || "Non spécifié";
    const dateRapport = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });

    const stats = getStats();
    const d = getStatsDetaillees();

    const wrapper = document.createElement("div");
    wrapper.style.cssText = "font-family:'Inter',Arial,sans-serif;padding:20px;color:#111827;background:white;width:1123px;";

    const thStyle = 'border:1px solid #e5e7eb;padding:6px 8px;background:#f3f4f6;text-align:left;';
    const tdStyle = 'border:1px solid #e5e7eb;padding:6px 8px;text-align:left;';
    const sectionStyle = 'font-size:14px;font-weight:bold;background:#eff6ff;padding:6px 10px;border-left:4px solid #2563eb;margin:20px 0 10px;';

    let html = "";
    html += '<div style="font-size:22px;font-weight:bold;color:#1e3a8a;text-align:center;margin-bottom:10px;">RAPPORT STATISTIQUE — ' + escape(nomEntite).toUpperCase() + '</div>';
    html += '<div style="text-align:center;color:#4b5563;margin-bottom:30px;">République Démocratique du Congo<br>Ministère de l\'Enseignement Primaire, Secondaire et Technique<br>Date : ' + dateRapport + '</div>';

    // Synthèse globale
    html += '<div style="' + sectionStyle + '">1. SYNTHÈSE GLOBALE</div>';
    html += '<table style="width:100%;border-collapse:collapse;margin-bottom:15px;font-size:12px;">';
    html += '<thead><tr>';
    html += '<th style="' + thStyle + '">Indicateur</th><th style="' + thStyle + '">Valeur</th>';
    html += '</tr></thead><tbody>';
    html += '<tr><td style="' + tdStyle + '">Sous-Divisions</td><td style="' + tdStyle + '">' + fmt(stats.totalSD) + '</td></tr>';
    html += '<tr><td style="' + tdStyle + '">Écoles</td><td style="' + tdStyle + '">' + fmt(stats.totalEcoles) + '</td></tr>';
    html += '<tr><td style="' + tdStyle + '">Classes</td><td style="' + tdStyle + '">' + fmt(stats.totalClasses) + '</td></tr>';
    html += '<tr><td style="' + tdStyle + '">Total élèves</td><td style="' + tdStyle + '">' + fmt(stats.totalEleves) + '</td></tr>';
    html += '<tr><td style="' + tdStyle + '">Filles</td><td style="' + tdStyle + '">' + fmt(stats.totalFilles) + ' (' + pct(stats.totalFilles, stats.totalEleves) + ')</td></tr>';
    html += '<tr><td style="' + tdStyle + '">Garçons</td><td style="' + tdStyle + '">' + fmt(stats.totalGarcons) + ' (' + pct(stats.totalGarcons, stats.totalEleves) + ')</td></tr>';
    html += '<tr><td style="' + tdStyle + '">Filles handicapées</td><td style="' + tdStyle + '">' + fmt(stats.totalFillesHandicap) + '</td></tr>';
    html += '<tr><td style="' + tdStyle + '">Garçons handicapés</td><td style="' + tdStyle + '">' + fmt(stats.totalGarconsHandicap) + '</td></tr>';
    html += '</tbody></table>';

    html += '<div style="' + sectionStyle + '">2. CYCLE MATERNELLE</div>';
    html += buildReportTable(['Classe','Total','Filles','Garçons','Handicapés'], buildMaternelleRows(d.statsMaternelle), thStyle, tdStyle);

    html += '<div style="' + sectionStyle + '">3. CYCLE PRIMAIRE</div>';
    html += buildReportTable(['Classe','Total','Filles','Garçons','Handicapés'], buildPrimaireRows(d.statsPrimaire), thStyle, tdStyle);

    html += '<div style="' + sectionStyle + '">4. CTEB (7ème & 8ème)</div>';
    html += buildReportTable(['Classe','Total','Filles','Garçons','Handicapés'], buildCtebRows(d.statsCTEB), thStyle, tdStyle);

    html += '<div style="' + sectionStyle + '">5. CYCLE LONG</div>';
    html += buildReportTable(['Niveau','Option','Code','Total','Filles','Garçons','Handicap'], buildCycleLongRows(d.statsCycleLong), thStyle, tdStyle);

    html += '<div style="' + sectionStyle + '">6. CYCLE COURT</div>';
    html += buildReportTable(['Niveau','Option','Code','Total','Filles','Garçons','Handicap'], buildCycleCourtRows(d.statsCycleCourt), thStyle, tdStyle);

    html += '<div style="' + sectionStyle + '">7. SYNTHÈSE PAR SOUS-DIVISION</div>';
    html += buildReportTable(
      ['Sous-Division','Écoles','Classes','Total','Filles','Garçons','Handicap'],
      buildSDSummaryRows(stats),
      thStyle, tdStyle
    );

    // Pied de page : signature
    html += '<div style="margin-top:30px;padding-top:15px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:flex-end;">';
    html += '  <div style="width:280px;text-align:center;">';
    html += '    <div>Fait à Kinshasa, le ' + dateRapport + '</div>';
    html += '    <div style="margin-top:50px;border-top:1px solid #000;width:100%;"></div>';
    html += '    <div style="margin-top:6px;">L\'Inspecteur Principal Provincial</div>';
    html += '    <div><strong>' + escape(responsable) + '</strong></div>';
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

    // Le conteneur doit être dans le DOM ET visible par html2canvas.
    // Astuce : on l'enveloppe dans un host invisible mais qui reste dans
    // le flux (sinon html2canvas v1 capture une zone vide → PDF blanc).
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;z-index:-9999;";
    wrapper.style.position = "relative";
    wrapper.style.left = "0";
    wrapper.style.top = "0";
    host.appendChild(wrapper);
    document.body.appendChild(host);

    // Petit délai pour laisser le layout/fonts se stabiliser avant la capture
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

    // On limite aux classes de la province
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

  // ==================== SOUS-DIVISION CRUD ====================
  function openSdModal(id = null) {
    const modal = document.getElementById("modal-sd");
    if (!modal) return;

    const sdIdInput = document.getElementById("sd-id");
    const nomInput = document.getElementById("sd-nom");
    const respInput = document.getElementById("sd-responsable");
    const emailInput = document.getElementById("sd-email");
    const passwordInput = document.getElementById("sd-password");
    const passwordField = document.getElementById("field-password");
    const modalTitle = document.getElementById("modal-sd-title");

    if (id && sousDivisions[id]) {
      const sd = sousDivisions[id];
      if (sdIdInput) sdIdInput.value = id;
      if (nomInput) nomInput.value = sd.nom || "";
      if (respInput) respInput.value = sd.responsable || "";
      if (emailInput) {
        emailInput.value = sd.email || "";
        emailInput.disabled = true;
      }
      if (passwordField) passwordField.style.display = "none";
      if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-edit"></i> Modifier la Sous-Division';
    } else {
      if (sdIdInput) sdIdInput.value = "";
      if (nomInput) nomInput.value = "";
      if (respInput) respInput.value = "";
      if (emailInput) {
        emailInput.value = "";
        emailInput.disabled = false;
      }
      if (passwordInput) passwordInput.value = generatePassword(10);
      if (passwordField) passwordField.style.display = "";
      if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-plus-circle"></i> Nouvelle Sous-Division';
    }

    modal.classList.add("show");
    if (nomInput) nomInput.focus();
  }

  async function saveSd(e) {
    e.preventDefault();

    const id = document.getElementById("sd-id").value;
    const nom = document.getElementById("sd-nom").value.trim();
    const responsable = document.getElementById("sd-responsable").value.trim();
    const email = document.getElementById("sd-email").value.trim();
    const password = document.getElementById("sd-password").value;

    if (!nom || !email) {
      toast("Le nom et l'email sont obligatoires", "error");
      return;
    }

    try {
      if (id) {
        // Modification simple
        await db.ref("sousDivisions/" + id).update({
          nom: nom,
          responsable: responsable,
          updatedAt: firebase.database.ServerValue.TIMESTAMP
        });
        toast("Sous-Division mise à jour", "success");
      } else {
        // Création : compte Firebase + entrée DB
        const secAuth = getSecondaryAuth();
        const cred = await secAuth.createUserWithEmailAndPassword(email, password);
        const newUid = cred.user.uid;

        const sdData = {
          nom: nom,
          responsable: responsable,
          email: email,
          ippId: currentIppId,
          statut: "actif",
          createdAt: firebase.database.ServerValue.TIMESTAMP
        };

        await db.ref("sousDivisions/" + newUid).set(sdData);
        await db.ref("utilisateurs/" + newUid).set({
          role: "sous-division",
          nomEntite: nom,
          responsable: responsable,
          entiteId: newUid,
          sdId: newUid,
          ippId: currentIppId,
          email: email,
          createdAt: firebase.database.ServerValue.TIMESTAMP
        });

        await secAuth.signOut();

        toast('Sous-Division "' + nom + '" créée. Mot de passe : ' + password, "success");
      }

      document.getElementById("modal-sd").classList.remove("show");

    } catch (error) {
      console.error(error);
      toast("Erreur : " + error.message, "error");
    }
  }

  async function toggleSd(id, currentStatut) {
    const sd = sousDivisions[id];
    if (!sd) return;

    const willInactivate = currentStatut !== "inactif";
    const ok = await confirmDialog(
      willInactivate ? "Désactiver cette Sous-Division ?" : "Réactiver cette Sous-Division ?",
      willInactivate
        ? 'La Sous-Division "' + sd.nom + '" sera marquée inactive.'
        : 'La Sous-Division "' + sd.nom + '" redeviendra active.'
    );
    if (!ok) return;

    try {
      await db.ref("sousDivisions/" + id + "/statut").set(willInactivate ? "inactif" : "actif");
      toast(willInactivate ? "Sous-Division désactivée" : "Sous-Division réactivée", "success");
    } catch (err) {
      toast("Erreur : " + err.message, "error");
    }
  }

  async function deleteSd(id, nom) {
    const ok = await confirmDialog(
      "⚠️ Supprimer définitivement ?",
      'La Sous-Division "' + nom + '" sera marquée supprimée. Action IRRÉVERSIBLE.'
    );
    if (!ok) return;

    try {
      await db.ref("sousDivisions/" + id + "/statut").set("supprime");
      toast('Sous-Division "' + nom + '" supprimée', "success");
    } catch (err) {
      toast("Erreur : " + err.message, "error");
    }
  }

  // Exposer pour onclick
  window.editSd = openSdModal;
  window.toggleSd = toggleSd;
  window.deleteSd = deleteSd;

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
