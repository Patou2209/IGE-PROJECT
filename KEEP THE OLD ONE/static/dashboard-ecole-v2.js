/* ============================================================
   EKOLSTAT — Tableau de bord École - Version 2.0
   Responsabilités : Gestion des classes avec cycles normalisés
   ============================================================ */

(function() {
  const auth = firebase.auth();
  const db = firebase.database();
  
  let currentUser = null;
  let currentProfile = null;
  let currentEcoleId = null;
  let currentEcoleCycle = null;
  
  // État global
  let classes = {};
  let effectifs = {};
  let cyclesData = null;
  let optionsData = [];
  
  // Graphique
  let evolutionChart = null;
  
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
    if (currentProfile.role !== "ecole" && currentProfile.role !== "école") {
      toast("Accès non autorisé", "error");
      await auth.signOut();
      setTimeout(() => window.location.href = "../index.html", 1200);
      return;
    }
    
    currentUser = user;
    currentEcoleId = currentProfile.entiteId || currentProfile.ecoleId || user.uid;
    currentEcoleCycle = currentProfile.cycle || "";
    
    document.getElementById("user-name").textContent = currentProfile.nomEntite || "Établissement";
    
    let roleText = "Établissement scolaire";
    if (currentProfile.cycle === "maternelle") roleText = "École Maternelle";
    else if (currentProfile.cycle === "primaire") roleText = "École Primaire";
    else if (currentProfile.cycle === "secondaire") roleText = "École Secondaire";
    document.getElementById("user-role").textContent = roleText;
    
    await loadReferenceData();
    init();
  });
  
  // ==================== CHARGEMENT DES DONNÉES DE RÉFÉRENCE ====================
  async function loadReferenceData() {
    const cyclesSnap = await db.ref("cycles").once("value");
    cyclesData = cyclesSnap.val();
    
    const optionsSnap = await db.ref("options_secondaire").once("value");
    optionsData = optionsSnap.val() || [];
  }
  
  // ==================== INITIALISATION ====================
  function init() {
    bindEvents();
    loadData();
    populateCycleSelect();
  }
  
  function loadData() {
    db.ref("classes").orderByChild("ecoleId").equalTo(currentEcoleId).on("value", (snap) => {
      classes = snap.val() || {};
      renderAll();
    });
    
    db.ref("effectifs").on("value", (snap) => {
      effectifs = snap.val() || {};
      renderAll();
    });
  }
  
  function bindEvents() {
    const logoutLink = document.getElementById("logout-link");
    if (logoutLink) {
      logoutLink.addEventListener("click", () => auth.signOut());
    }
    
    const refreshBtn = document.getElementById("refresh-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        renderAll();
        toast("Données rafraîchies", "success");
      });
    }
    
    const globalSearch = document.getElementById("global-search");
    if (globalSearch) {
      globalSearch.addEventListener("input", function(e) {
        const q = e.target.value.toLowerCase().trim();
        const rows = document.querySelectorAll("#classes-management-container tbody tr, #classes-table-container tbody tr, #effectifs-table-container tbody tr");
        rows.forEach(function(r) {
          if (!q) {
            r.style.display = "";
            return;
          }
          const txt = r.textContent.toLowerCase();
          r.style.display = txt.includes(q) ? "" : "none";
        });
      });
    }
    
    document.querySelectorAll(".nav-link[data-view]").forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const view = link.getAttribute("data-view");
        
        document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
        link.classList.add("active");
        
        document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
        const viewEl = document.getElementById(`view-${view}`);
        if (viewEl) viewEl.classList.add("active");
        
        const titles = {
          overview: "Vue d'ensemble",
          classes: "Gestion des classes",
          effectifs: "Saisie des effectifs",
          reports: "Rapports"
        };
        
        const pageTitle = document.getElementById("page-title");
        if (pageTitle) pageTitle.textContent = titles[view] || view;
        
        if (view === "overview") renderEvolutionChart();

        const sb = document.getElementById("sidebar");
        const ov = document.getElementById("sidebar-overlay");
        if (sb) sb.classList.remove("open");
        if (ov) ov.classList.remove("show");
      });
    });
    
    const btnNewClasse = document.getElementById("btn-new-classe");
    const btnNewClasseModal = document.getElementById("btn-new-classe-modal");
    const formClasse = document.getElementById("form-classe");
    
    if (btnNewClasse) btnNewClasse.addEventListener("click", () => openClasseModal());
    if (btnNewClasseModal) btnNewClasseModal.addEventListener("click", () => openClasseModal());
    if (formClasse) formClasse.addEventListener("submit", saveClasse);
    
    const cycleSelect = document.getElementById("classe-cycle");
    const sousCycleSelect = document.getElementById("classe-sous-cycle");
    
    if (cycleSelect) {
      cycleSelect.addEventListener("change", () => updateNiveauSelect());
    }
    if (sousCycleSelect) {
      sousCycleSelect.addEventListener("change", () => updateNiveauSelect());
    }
    
    const formEffectifs = document.getElementById("form-effectifs");
    if (formEffectifs) formEffectifs.addEventListener("submit", saveEffectifs);
    
    const btnExportPdf = document.getElementById("btn-export-pdf");
    if (btnExportPdf) btnExportPdf.addEventListener("click", exportToPdf);
    
    document.querySelectorAll("[data-close-modal]").forEach(btn => {
      btn.addEventListener("click", () => {
        const modal = btn.closest(".modal");
        if (modal) modal.classList.remove("show");
      });
    });

    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    const burger = document.getElementById("hamburger-btn");
    const sidebarToggle = document.getElementById("sidebar-toggle");

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
  
  function populateCycleSelect() {
    const cycleSelect = document.getElementById("classe-cycle");
    if (!cycleSelect || !cyclesData) return;
    
    cycleSelect.innerHTML = '<option value="">Sélectionner un cycle</option>';
    
    if (currentEcoleCycle && currentEcoleCycle !== "") {
      const cycle = cyclesData[currentEcoleCycle];
      if (cycle) {
        const option = document.createElement("option");
        option.value = currentEcoleCycle;
        option.textContent = cycle.nom;
        cycleSelect.appendChild(option);
        cycleSelect.disabled = true;
        cycleSelect.value = currentEcoleCycle;
        updateNiveauSelect();
      }
    } else {
      for (const [key, cycle] of Object.entries(cyclesData)) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = cycle.nom;
        cycleSelect.appendChild(option);
      }
    }
  }
  
  function updateNiveauSelect() {
    const cycle = document.getElementById("classe-cycle").value;
    const sousCycle = document.getElementById("classe-sous-cycle")?.value;
    const niveauSelect = document.getElementById("classe-niveau");
    const sousCycleField = document.getElementById("field-sous-cycle");
    const optionField = document.getElementById("field-option");
    
    if (!niveauSelect) return;
    
    niveauSelect.innerHTML = '<option value="">Sélectionner une classe</option>';
    
    if (!cycle) return;
    
    if (cycle === "secondaire") {
      if (sousCycleField) sousCycleField.classList.remove("hidden");
      
      if (!sousCycle) return;
      
      const sousCycleData = cyclesData.secondaire.sousCycles[sousCycle];
      if (sousCycleData) {
        sousCycleData.classes.forEach(classe => {
          const option = document.createElement("option");
          option.value = classe.niveau;
          option.textContent = classe.nom;
          niveauSelect.appendChild(option);
        });
      }
      
      if (sousCycle === "long" || sousCycle === "court") {
        if (optionField) optionField.classList.remove("hidden");
        populateOptionsSelect();
      } else {
        if (optionField) optionField.classList.add("hidden");
      }
    } else {
      if (sousCycleField) sousCycleField.classList.add("hidden");
      if (optionField) optionField.classList.add("hidden");
      
      const cycleData = cyclesData[cycle];
      if (cycleData && cycleData.classes) {
        cycleData.classes.forEach(classe => {
          const option = document.createElement("option");
          option.value = classe.niveau;
          option.textContent = classe.nom;
          niveauSelect.appendChild(option);
        });
      }
    }
  }
  
  function populateOptionsSelect() {
    const optionSelect = document.getElementById("classe-option");
    if (!optionSelect) return;
    
    optionSelect.innerHTML = '<option value="">Sélectionner une option</option>';
    
    optionsData.forEach(opt => {
      const option = document.createElement("option");
      option.value = opt.code;
      option.textContent = `${opt.code} - ${opt.libelle}`;
      optionSelect.appendChild(option);
    });
  }
  
  // ==================== AGRÉGATION ====================
  // MODIFICATION 1 : suppression des données handicapés
  function getStats() {
    let stats = {
      totalClasses: 0,
      totalEleves: 0,
      totalFilles: 0,
      totalGarcons: 0,
      classeStats: {},
      inactiveCount: 0,
      activeIn30: 0
    };
    
    const now = Date.now();
    const fifteenDays = 15 * 24 * 60 * 60 * 1000;
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    let activeClasses = 0;
    
    Object.entries(classes).forEach(([id, classe]) => {
      if (classe.statut === "supprime") return;
      
      const eff = effectifs[id] || {
        nb_filles: 0,
        nb_garcons: 0,
        lastUpdate: 0
      };
      
      const filles = eff.nb_filles || 0;
      const garcons = eff.nb_garcons || 0;
      const total = filles + garcons;
      
      stats.totalClasses++;
      stats.totalEleves += total;
      stats.totalFilles += filles;
      stats.totalGarcons += garcons;
      
      stats.classeStats[id] = {
        nom: classe.nom,
        cycle: classe.cycle,
        niveau: classe.niveau,
        sousCycle: classe.sousCycle,
        optionCode: classe.optionCode,
        optionLibelle: classe.optionLibelle,
        professeur: classe.professeurPrincipal || "",
        filles: filles,
        garcons: garcons,
        total: total,
        lastUpdate: eff.lastUpdate || 0
      };
      
      const lastUpdate = eff.lastUpdate || 0;
      if (lastUpdate && (now - lastUpdate) > fifteenDays) {
        stats.inactiveCount++;
      }
      if (lastUpdate && (now - lastUpdate) <= thirtyDays) {
        activeClasses++;
      }
    });
    
    stats.activityRate = stats.totalClasses > 0 ? (activeClasses / stats.totalClasses) * 100 : 0;
    
    return stats;
  }

  // MODIFICATION 1 : suppression des données handicapés dans getStatsDetaillees
  function getStatsDetaillees() {
    const statsMaternelle = { 1:0, 2:0, 3:0, filles: {1:0,2:0,3:0}, garcons:{1:0,2:0,3:0} };
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
    renderClassesTable(stats);
    renderClassesManagementTable(stats);
    renderEffectifsTable(stats);
    renderReports(stats);
    if (window.Chart) renderEvolutionChart();
  }
  
  // MODIFICATION 1 : suppression des 3 KPI handicap
  function renderKPIs(stats) {
    document.getElementById("total-classes").textContent = fmt(stats.totalClasses);
    document.getElementById("total-eleves").textContent = fmt(stats.totalEleves);
    document.getElementById("total-filles").textContent = fmt(stats.totalFilles);
    document.getElementById("total-garcons").textContent = fmt(stats.totalGarcons);
  }
  
  // MODIFICATION 2 : colonnes reordonnées Filles → Garçons → Total (bold, last)
  function renderClassesTable(stats) {
    const container = document.getElementById("classes-table-container");
    if (!container) return;
    
    if (Object.keys(classes).length === 0) {
      container.innerHTML = '<div class="empty">Aucune classe. Cliquez sur "Nouvelle classe" pour commencer.</div>';
      return;
    }
    
    let html = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Classe</th>
            <th>Cycle</th>
            <th>Option</th>
            <th>Professeur Principal</th>
            <th>Filles</th>
            <th>Garçons</th>
            <th><strong>Total élèves</strong></th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
    `;
    
    for (const [id, classe] of Object.entries(classes)) {
      if (classe.statut === "supprime") continue;
      
      const s = stats.classeStats[id] || { total: 0, filles: 0, garcons: 0 };
      let optionLabel = "-";
      if (classe.optionCode && classe.optionLibelle) {
        optionLabel = `${classe.optionCode} - ${classe.optionLibelle}`;
      } else if (classe.optionCode) {
        optionLabel = classe.optionCode;
      }
      
      let cycleLabel = "";
      if (classe.cycle === "maternelle") cycleLabel = "Maternelle";
      else if (classe.cycle === "primaire") cycleLabel = "Primaire";
      else if (classe.cycle === "secondaire") {
        if (classe.sousCycle === "cteb") cycleLabel = "Secondaire - CTEB";
        else if (classe.sousCycle === "long") cycleLabel = "Secondaire - Cycle Long";
        else if (classe.sousCycle === "court") cycleLabel = "Secondaire - Cycle Court";
        else cycleLabel = "Secondaire";
      }
      
      html += `
        <tr>
          <td><strong>${escape(classe.nom)}</strong></td>
          <td>${cycleLabel}</td>
          <td>${optionLabel}</td>
          <td>${escape(classe.professeurPrincipal || "-")}</td>
          <td>${fmt(s.filles)}</td>
          <td>${fmt(s.garcons)}</td>
          <td><strong>${fmt(s.total)}</strong></td>
          <td>
            <div class="row-actions">
              <button class="icon-btn" onclick="editClasse('${id}')" title="Modifier"><i class="fas fa-edit"></i></button>
              <button class="icon-btn danger" onclick="deleteClasse('${id}', '${escape(classe.nom)}')" title="Supprimer"><i class="fas fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    }
    
    html += `</tbody></table>`;
    container.innerHTML = html;
  }
  
  // MODIFICATION 2 : colonnes reordonnées Filles → Garçons → Total (bold, last)
  function renderClassesManagementTable(stats) {
    const container = document.getElementById("classes-management-container");
    if (!container) return;
    
    if (Object.keys(classes).length === 0) {
      container.innerHTML = '<div class="empty">Aucune classe. Cliquez sur "Nouvelle classe" pour commencer.</div>';
      return;
    }
    
    let html = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Cycle</th>
            <th>Option</th>
            <th>Professeur</th>
            <th>Filles</th>
            <th>Garçons</th>
            <th><strong>Total</strong></th>
            <th>Dernière MAJ</th>
            <th>Statut</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
    `;
    
    for (const [id, classe] of Object.entries(classes)) {
      if (classe.statut === "supprime") continue;
      
      const s = stats.classeStats[id] || { filles: 0, garcons: 0, total: 0, lastUpdate: 0 };
      const lastUpdate = s.lastUpdate ? new Date(s.lastUpdate).toLocaleDateString("fr-FR") : "Jamais";
      
      let optionLabel = "-";
      if (classe.optionCode && classe.optionLibelle) {
        optionLabel = `${classe.optionCode} - ${classe.optionLibelle}`;
      } else if (classe.optionCode) {
        optionLabel = classe.optionCode;
      }
      
      let cycleLabel = "";
      if (classe.cycle === "maternelle") cycleLabel = "Maternelle";
      else if (classe.cycle === "primaire") cycleLabel = "Primaire";
      else if (classe.cycle === "secondaire") {
        if (classe.sousCycle === "cteb") cycleLabel = "Secondaire - CTEB";
        else if (classe.sousCycle === "long") cycleLabel = "Secondaire - Cycle Long";
        else if (classe.sousCycle === "court") cycleLabel = "Secondaire - Cycle Court";
        else cycleLabel = "Secondaire";
      }
      
      let statusBadge = classe.statut === "inactif" ? 'badge-muted' : 'badge-success';
      let statusText = classe.statut === "inactif" ? 'Inactif' : 'Actif';
      
      html += `
        <tr>
          <td><strong>${escape(classe.nom)}</strong></td>
          <td>${cycleLabel}</td>
          <td>${optionLabel}</td>
          <td>${escape(classe.professeurPrincipal || "-")}</td>
          <td>${fmt(s.filles)}</td>
          <td>${fmt(s.garcons)}</td>
          <td><strong>${fmt(s.total)}</strong></td>
          <td>${lastUpdate}</td>
          <td><span class="badge ${statusBadge}">${statusText}</span></td>
          <td>
            <div class="row-actions">
              <button class="icon-btn" onclick="editClasse('${id}')" title="Modifier"><i class="fas fa-edit"></i></button>
              <button class="icon-btn ${classe.statut === 'inactif' ? '' : 'warning'}" onclick="toggleClasse('${id}', '${classe.statut}')" title="${classe.statut === 'inactif' ? 'Réactiver' : 'Désactiver'}">
                <i class="fas ${classe.statut === 'inactif' ? 'fa-circle-play' : 'fa-circle-pause'}"></i>
              </button>
              <button class="icon-btn danger" onclick="deleteClasse('${id}', '${escape(classe.nom)}')" title="Supprimer"><i class="fas fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    }
    
    html += `</tbody></table>`;
    container.innerHTML = html;
  }
  
  // MODIFICATION 1+2 : suppression colonnes handicap + reorder Filles → Garçons → Total
  function renderEffectifsTable(stats) {
    const container = document.getElementById("effectifs-table-container");
    if (!container) return;
    
    if (Object.keys(classes).length === 0) {
      container.innerHTML = '<div class="empty">Aucune classe. Créez d\'abord des classes.</div>';
      return;
    }
    
    let html = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Classe</th>
            <th>Filles</th>
            <th>Garçons</th>
            <th><strong>Total</strong></th>
            <th>Dernière mise à jour</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
    `;
    
    for (const [id, classe] of Object.entries(classes)) {
      if (classe.statut === "supprime") continue;
      
      const s = stats.classeStats[id] || { 
        filles: 0, 
        garcons: 0, 
        total: 0, 
        lastUpdate: 0 
      };
      
      const lastUpdate = s.lastUpdate ? new Date(s.lastUpdate).toLocaleDateString("fr-FR") : "Jamais";
      
      html += `
        <tr>
          <td><strong>${escape(classe.nom)}</strong></td>
          <td>${fmt(s.filles)}</td>
          <td>${fmt(s.garcons)}</td>
          <td><strong>${fmt(s.total)}</strong></td>
          <td>${lastUpdate}</td>
          <td>
            <div class="row-actions">
              <button class="icon-btn" onclick="editClasse('${id}')" title="Modifier les effectifs"><i class="fas fa-edit"></i></button>
            </div>
          </td>
        </tr>
      `;
    }
    
    html += `</tbody></table>`;
    container.innerHTML = html;
  }

  // ==================== RAPPORTS (UI) ====================
  // MODIFICATION 1+2 : suppression colonne Handicapés + ordre Filles → Garçons → Total
  function renderReports(stats) {
    const container = document.getElementById("reports-container");
    if (!container) return;

    const d = getStatsDetaillees();
    const cycle = currentEcoleCycle || "";

    const thStyle = 'border:1px solid #e5e7eb;padding:6px 8px;background:#f3f4f6;text-align:left;';
    const tdStyle = 'border:1px solid #e5e7eb;padding:6px 8px;text-align:left;';
    const sectionStyle = 'font-size:14px;font-weight:bold;background:#eff6ff;padding:6px 10px;border-left:4px solid #2563eb;margin:20px 0 10px;';

    let html = '';
    let sectionNum = 1;

    if (cycle === "" || cycle === "maternelle") {
      html += `<div style="margin-bottom:25px;"><h3 style="${sectionStyle}">${sectionNum++}. Cycle Maternelle</h3>`;
      html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildMaternelleRows(d.statsMaternelle), thStyle, tdStyle);
      html += '</div>';
    }

    if (cycle === "" || cycle === "primaire") {
      html += `<div style="margin-bottom:25px;"><h3 style="${sectionStyle}">${sectionNum++}. Cycle Primaire</h3>`;
      html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildPrimaireRows(d.statsPrimaire), thStyle, tdStyle);
      html += '</div>';
    }

    if (cycle === "" || cycle === "secondaire") {
      html += `<div style="margin-bottom:25px;"><h3 style="${sectionStyle}">${sectionNum++}. CTEB (7ème & 8ème)</h3>`;
      html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildCtebRows(d.statsCTEB), thStyle, tdStyle);
      html += '</div>';

      html += `<div style="margin-bottom:25px;"><h3 style="${sectionStyle}">${sectionNum++}. Cycle Long (1ère → 4ème Humanité)</h3>`;
      html += buildReportTable(['Niveau','Option','Code','Filles','Garçons','<strong>Total</strong>'], buildCycleLongRows(d.statsCycleLong), thStyle, tdStyle);
      html += '</div>';

      html += `<div style="margin-bottom:25px;"><h3 style="${sectionStyle}">${sectionNum++}. Cycle Court (1ère → 3ème Humanité)</h3>`;
      html += buildReportTable(['Niveau','Option','Code','Filles','Garçons','<strong>Total</strong>'], buildCycleCourtRows(d.statsCycleCourt), thStyle, tdStyle);
      html += '</div>';
    }

    if (html === '') {
      html = '<div class="empty">Aucun cycle défini pour cet établissement.</div>';
    }

    container.innerHTML = html;
  }

  // ---- Helpers de construction de lignes ----
  // MODIFICATION 1+2 : sans handicap, ordre Filles → Garçons → Total (bold)
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

  // ==================== EXPORT PDF ====================
  // MODIFICATION 3 : nouveau header officiel + footer avec numéro de série
  function buildPdfFilename() {
    const nomEntite = (currentProfile && currentProfile.nomEntite) ? currentProfile.nomEntite : "ECOLE";
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

  function generateSerialNumber() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const rand4 = String(Math.floor(1000 + Math.random() * 9000));
    return 'SERIE:MINENNC' + yyyy + mm + rand4;
  }

  function exportToPdf() {
    if (!window.html2pdf) {
      toast("Bibliothèque PDF indisponible (html2pdf manquant)", "error");
      return;
    }

    toast("Préparation du rapport PDF...", "info");

    const nomEntite = (currentProfile && currentProfile.nomEntite) || "Établissement scolaire";
    const responsable = (currentProfile && currentProfile.responsable) || "Non spécifié";
    const d = new Date();
    const dateRapport = d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
    const annee1 = d.getFullYear();
    const annee2 = annee1 + 1;
    const serial = generateSerialNumber();

    const det = getStatsDetaillees();

    const wrapper = document.createElement("div");
    wrapper.style.cssText = "font-family:'Inter',Arial,sans-serif;padding:20px;color:#111827;background:white;width:1123px;";

    const thStyle = 'border:1px solid #e5e7eb;padding:6px 8px;background:#f3f4f6;text-align:left;';
    const tdStyle = 'border:1px solid #e5e7eb;padding:6px 8px;text-align:left;';
    const sectionStyle = 'font-size:14px;font-weight:bold;background:#eff6ff;padding:6px 10px;border-left:4px solid #2563eb;margin:20px 0 10px;';

    // === EN-TÊTE OFFICIEL ===
    let html = '';
    html += '<div style="display:flex;align-items:center;border-bottom:2px solid #1e3a8a;padding-bottom:12px;margin-bottom:16px;">';
    html += '  <img src="../img/logo min backless.png" alt="Ministère RDC" style="width:80px;height:80px;object-fit:contain;margin-right:20px;" />';
    html += '  <div style="flex:1;text-align:center;">';
    html += '    <div style="font-size:11px;font-weight:600;color:#374151;letter-spacing:0.5px;">REPUBLIQUE DEMOCRATIQUE DU CONGO</div>';
    html += '    <div style="font-size:10px;color:#374151;margin-top:2px;">MINISTERE DE L\'EDUCATION NATIONALE ET NOUVELLE CITOYENNETE</div>';
    html += '    <div style="font-size:13px;font-weight:bold;color:#1e3a8a;margin-top:6px;">' + escape(nomEntite).toUpperCase() + '</div>';
    html += '    <div style="font-size:11px;font-weight:600;color:#1e3a8a;margin-top:4px;">RAPPORT STATISTIQUE DES BULLETINS SCOLAIRES ' + annee1 + '-' + annee2 + '</div>';
    html += '  </div>';
    html += '</div>';

    const cycleEcole = currentEcoleCycle || "";
    let sectionNum = 1;

    if (cycleEcole === "" || cycleEcole === "maternelle") {
      html += '<div style="' + sectionStyle + '">' + sectionNum++ + '. CYCLE MATERNELLE</div>';
      html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildMaternelleRows(det.statsMaternelle), thStyle, tdStyle);
    }

    if (cycleEcole === "" || cycleEcole === "primaire") {
      html += '<div style="' + sectionStyle + '">' + sectionNum++ + '. CYCLE PRIMAIRE</div>';
      html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildPrimaireRows(det.statsPrimaire), thStyle, tdStyle);
    }

    if (cycleEcole === "" || cycleEcole === "secondaire") {
      html += '<div style="' + sectionStyle + '">' + sectionNum++ + '. CTEB (7ème & 8ème)</div>';
      html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildCtebRows(det.statsCTEB), thStyle, tdStyle);

      html += '<div style="' + sectionStyle + '">' + sectionNum++ + '. CYCLE LONG</div>';
      html += buildReportTable(['Niveau','Option','Code','Filles','Garçons','<strong>Total</strong>'], buildCycleLongRows(det.statsCycleLong), thStyle, tdStyle);

      html += '<div style="' + sectionStyle + '">' + sectionNum++ + '. CYCLE COURT</div>';
      html += buildReportTable(['Niveau','Option','Code','Filles','Garçons','<strong>Total</strong>'], buildCycleCourtRows(det.statsCycleCourt), thStyle, tdStyle);
    }

    // === PIED DE PAGE OFFICIEL ===
    html += '<div style="margin-top:30px;padding-top:15px;border-top:2px solid #1e3a8a;display:flex;justify-content:space-between;align-items:flex-end;">';
    html += '  <div style="width:280px;text-align:center;">';
    html += '    <div style="font-size:11px;">Fait à Kinshasa, le ' + dateRapport + '</div>';
    html += '    <div style="margin-top:50px;border-top:1px solid #000;width:100%;"></div>';
    html += '    <div style="margin-top:6px;font-size:11px;">Le Responsable de l\'Établissement</div>';
    html += '    <div style="font-size:11px;"><strong>' + escape(responsable) + '</strong></div>';
    html += '  </div>';
    html += '  <div style="text-align:center;">';
    html += '    <div style="width:120px;height:80px;border:1px dashed #9ca3af;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:9px;">Sceau / Cachet</div>';
    html += '  </div>';
    html += '  <div style="text-align:right;font-size:9px;color:#6b7280;">';
    html += '    <div>' + serial + '</div>';
    html += '  </div>';
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
    
    Object.values(effectifs).forEach(eff => {
      const last = eff.lastUpdate || 0;
      if (!last) return;
      
      const total = (eff.nb_filles || 0) + (eff.nb_garcons || 0);
      const d = new Date(last);
      
      for (let i = 0; i < 12; i++) {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
        if (d.getFullYear() === monthDate.getFullYear() && d.getMonth() === monthDate.getMonth()) {
          data[i] += total;
          break;
        }
      }
    });
    
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
        plugins: {
          legend: { position: "bottom" }
        },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: "Nombre d'élèves" }
          }
        }
      }
    });
  }
  
  // ==================== CLASSE CRUD ====================
  function openClasseModal(id = null) {
    const modal = document.getElementById("modal-classe");
    if (!modal) return;
    
    const classeIdInput = document.getElementById("classe-id");
    const classeCycleSelect = document.getElementById("classe-cycle");
    const classeNiveauSelect = document.getElementById("classe-niveau");
    const classeSousCycleSelect = document.getElementById("classe-sous-cycle");
    const classeOptionSelect = document.getElementById("classe-option");
    const classeProfesseurInput = document.getElementById("classe-professeur");
    const sousCycleField = document.getElementById("field-sous-cycle");
    const optionField = document.getElementById("field-option");
    const modalTitle = document.getElementById("modal-classe-title");
    
    if (classeNiveauSelect) classeNiveauSelect.innerHTML = '<option value="">Sélectionner une classe</option>';
    if (sousCycleField) sousCycleField.classList.add("hidden");
    if (optionField) optionField.classList.add("hidden");
    
    const classFillesInput  = document.getElementById("classe-filles");
    const classGarconsInput = document.getElementById("classe-garcons");

    if (id && classes[id]) {
      const classe = classes[id];
      if (classeIdInput) classeIdInput.value = id;
      if (classeCycleSelect) classeCycleSelect.value = classe.cycle;
      if (classeProfesseurInput) classeProfesseurInput.value = classe.professeurPrincipal || "";
      // Pré-remplir effectifs existants
      const eff = effectifs[id] || {};
      if (classFillesInput)  classFillesInput.value  = eff.nb_filles  || 0;
      if (classGarconsInput) classGarconsInput.value = eff.nb_garcons || 0;
      
      if (classe.cycle === "secondaire") {
        if (sousCycleField) sousCycleField.classList.remove("hidden");
        if (classeSousCycleSelect) classeSousCycleSelect.value = classe.sousCycle;
        
        if (classe.sousCycle && (classe.sousCycle === "long" || classe.sousCycle === "court")) {
          if (optionField) optionField.classList.remove("hidden");
          populateOptionsSelect();
          if (classeOptionSelect) classeOptionSelect.value = classe.optionCode;
        }
      }
      
      updateNiveauSelect();
      
      setTimeout(() => {
        if (classeNiveauSelect) classeNiveauSelect.value = classe.niveau;
      }, 100);
      
      if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-edit"></i> Modifier la classe';
    } else {
      if (classeIdInput) classeIdInput.value = "";
      if (classeProfesseurInput) classeProfesseurInput.value = "";
      if (classeCycleSelect) classeCycleSelect.value = "";
      if (classeNiveauSelect) classeNiveauSelect.value = "";
      if (classeSousCycleSelect) classeSousCycleSelect.value = "";
      if (classeOptionSelect) classeOptionSelect.value = "";
      
      if (currentEcoleCycle && currentEcoleCycle !== "") {
        if (classeCycleSelect) classeCycleSelect.value = currentEcoleCycle;
        updateNiveauSelect();
      }
      
      if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-plus-circle"></i> Nouvelle classe';
      if (classFillesInput)  classFillesInput.value  = 0;
      if (classGarconsInput) classGarconsInput.value = 0;
    }
    
    modal.classList.add("show");
    if (classeProfesseurInput) classeProfesseurInput.focus();
  }
  
  async function saveClasse(e) {
    e.preventDefault();
    
    const id = document.getElementById("classe-id").value;
    const cycle = document.getElementById("classe-cycle").value;
    const niveau = document.getElementById("classe-niveau").value;
    const sousCycle = document.getElementById("classe-sous-cycle")?.value;
    const optionCode = document.getElementById("classe-option")?.value;
    const professeur = document.getElementById("classe-professeur").value.trim();
    const nbFilles   = parseInt(document.getElementById("classe-filles")?.value)  || 0;
    const nbGarcons  = parseInt(document.getElementById("classe-garcons")?.value) || 0;
    
    if (!cycle || !niveau) {
      toast("Veuillez remplir tous les champs obligatoires", "error");
      return;
    }
    
    let nom = "";
    let optionLibelle = "";
    
    try {
      if (cycle === "secondaire") {
        if (!sousCycle) {
          toast("Veuillez sélectionner un sous-cycle", "error");
          return;
        }
        const sousCycleData = cyclesData.secondaire.sousCycles[sousCycle];
        const classeData = sousCycleData.classes.find(c => c.niveau == niveau);
        nom = classeData ? classeData.nom : `${sousCycleData.nom} - Niveau ${niveau}`;
        
        if (sousCycle !== "cteb") {
          if (!optionCode) {
            toast("Veuillez sélectionner une option", "error");
            return;
          }
          const option = optionsData.find(opt => opt.code === optionCode);
          optionLibelle = option ? option.libelle : "";
        }
      } else {
        const cycleData = cyclesData[cycle];
        const classeData = cycleData.classes.find(c => c.niveau == niveau);
        nom = classeData ? classeData.nom : `${cycleData.nom} - Niveau ${niveau}`;
      }
      
      const newId = id || `classe_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      
      const classeData = {
        nom: nom,
        cycle: cycle,
        niveau: parseInt(niveau),
        professeurPrincipal: professeur,
        ecoleId: currentEcoleId,
        sdId: currentProfile.sdId,
        ippId: currentProfile.ippId,
        statut: "actif",
        createdAt: firebase.database.ServerValue.TIMESTAMP
      };
      
      if (cycle === "secondaire") {
        classeData.sousCycle = sousCycle;
        if (optionCode) {
          classeData.optionCode = optionCode;
          classeData.optionLibelle = optionLibelle;
        }
      }
      
      await db.ref(`classes/${newId}`).set(classeData);
      
      // Sauvegarder les effectifs (création ou mise à jour)
      await db.ref(`effectifs/${newId}`).set({
        nb_filles:  nbFilles,
        nb_garcons: nbGarcons,
        lastUpdate: firebase.database.ServerValue.TIMESTAMP
      });
      
      toast(`Classe "${nom}" créée/modifiée avec succès !`, "success");
      document.getElementById("modal-classe").classList.remove("show");
      
    } catch (error) {
      console.error(error);
      toast("Erreur : " + error.message, "error");
    }
  }
  
  // MODIFICATION 1 : saveEffectifs ne lit plus ni n'écrit les champs handicap
  async function saveEffectifs(e) {
    e.preventDefault();
    
    const classeId = document.getElementById("effectifs-classe-id").value;
    const filles = parseInt(document.getElementById("effectifs-filles").value) || 0;
    const garcons = parseInt(document.getElementById("effectifs-garcons").value) || 0;
    
    if (!classeId) return;
    
    try {
      await db.ref(`effectifs/${classeId}`).set({
        nb_filles: filles,
        nb_garcons: garcons,
        lastUpdate: firebase.database.ServerValue.TIMESTAMP
      });
      
      toast("Effectifs enregistrés avec succès !", "success");
      document.getElementById("modal-effectifs").classList.remove("show");
      
    } catch (error) {
      console.error(error);
      toast("Erreur : " + error.message, "error");
    }
  }
  
  async function toggleClasse(id, currentStatut) {
    const classe = classes[id];
    if (!classe) return;
    
    const willInactivate = currentStatut !== "inactif";
    const ok = await confirmDialog(
      willInactivate ? "Désactiver cette classe ?" : "Réactiver cette classe ?",
      willInactivate
        ? `La classe "${classe.nom}" ne pourra plus recevoir de mises à jour.`
        : `La classe "${classe.nom}" redeviendra active.`
    );
    if (!ok) return;
    
    try {
      await db.ref(`classes/${id}/statut`).set(willInactivate ? "inactif" : "actif");
      toast(willInactivate ? "Classe désactivée" : "Classe réactivée", "success");
    } catch (err) {
      toast("Erreur : " + err.message, "error");
    }
  }
  
  async function deleteClasse(id, nom) {
    const ok = await confirmDialog(
      "⚠️ Supprimer définitivement ?",
      `La classe "${nom}" sera définitivement supprimée. Cette action est IRRÉVERSIBLE.`
    );
    if (!ok) return;
    
    try {
      await db.ref(`classes/${id}`).remove();
      await db.ref(`effectifs/${id}`).remove();
      toast(`Classe "${nom}" supprimée`, "success");
    } catch (err) {
      toast("Erreur : " + err.message, "error");
    }
  }
  
  function openEffectifsModal(classeId) {
    const classe = classes[classeId];
    if (!classe) return;
    
    const modal = document.getElementById("modal-effectifs");
    const eff = effectifs[classeId] || {};
    
    document.getElementById("effectifs-classe-id").value = classeId;
    document.getElementById("effectifs-filles").value = eff.nb_filles || 0;
    document.getElementById("effectifs-garcons").value = eff.nb_garcons || 0;
    
    modal.classList.add("show");
  }
  
  window.openEffectifsModal = openEffectifsModal;
  window.editClasse = openClasseModal;
  window.toggleClasse = toggleClasse;
  window.deleteClasse = deleteClasse;
  
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
      if (!modal) {
        resolve(false);
        return;
      }
      
      const confirmTitle = document.getElementById("confirm-title");
      const confirmMessage = document.getElementById("confirm-message");
      const okBtn = document.getElementById("confirm-ok");
      
      if (confirmTitle) confirmTitle.innerHTML = '<i class="fas fa-circle-question"></i> ' + escape(title);
      if (confirmMessage) confirmMessage.textContent = message;
      
      const onOk = function() {
        cleanup();
        resolve(true);
      };
      const onCancel = function() {
        cleanup();
        resolve(false);
      };
      
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
    toastEl.className = `toast ${type || "info"}`;
    toastEl.classList.remove("hidden");
    setTimeout(() => toastEl.classList.add("hidden"), 3000);
  }
})();
