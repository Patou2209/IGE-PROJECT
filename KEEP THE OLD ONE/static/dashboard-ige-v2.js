/* ============================================================
   EKOLSTAT — Tableau de bord IGE (Version 2.0)
   Gestion des IPP avec dropdown provinces + Cycles complets
   ============================================================ */

(function() {
  const auth = firebase.auth();
  const db = firebase.database();
  
  let currentUser = null;
  let currentProfile = null;
  
  // Données de référence
  let provincesList = [];
  let optionsSecondaire = [];
  let cyclesData = null;
  
  // État
  let ipps = {};
  let sousDivisions = {};
  let ecoles = {};
  let effectifs = {};
  let classes = {};
  
  let filterIpp = "";
  let filterCategorie = "";
  
  // Graphique évolution
  let evolutionChart = null;

  // MODIFICATION 4 : variable pour mémoriser l'IPP sélectionné
  var _currentStatsIppId = null;
  
  const fmt = function(n) { return n ? n.toLocaleString("fr-FR") : "0"; };
  const pct = function(num, den) { return den ? ((num / den) * 100).toFixed(1).replace(".", ",") + "%" : "0%"; };
  
  // ==================== AUTHENTIFICATION ====================
  auth.onAuthStateChanged(async function(user) {
    if (!user) { window.location.href = "../index.html"; return; }
    
    var snap = await db.ref("utilisateurs/" + user.uid).get();
    if (!snap.exists()) { await auth.signOut(); window.location.href = "../index.html"; return; }
    
    currentProfile = snap.val();
    if (currentProfile.role !== "ige") {
      toast("Accès refusé", "error");
      await auth.signOut();
      setTimeout(function() { window.location.href = "../index.html"; }, 1200);
      return;
    }
    
    currentUser = user;
    var nameEl = document.getElementById("user-name");
    if (nameEl) nameEl.textContent = currentProfile.nomEntite || "Inspection Générale";
    
    await loadReferenceData();
    init();
  });
  
  // ==================== CHARGEMENT DES DONNÉES DE RÉFÉRENCE ====================
  async function loadReferenceData() {
    var provincesSnap = await db.ref("provinces").once("value");
    if (provincesSnap.exists()) {
      provincesList = Object.values(provincesSnap.val());
    }
    
    var optionsSnap = await db.ref("options_secondaire").once("value");
    if (optionsSnap.exists()) {
      optionsSecondaire = Object.values(optionsSnap.val());
    }
    
    var cyclesSnap = await db.ref("cycles").once("value");
    if (cyclesSnap.exists()) {
      cyclesData = cyclesSnap.val();
    }
  }
  
  function init() {
    bindEvents();
    loadData();
    populateProvincesDropdown();
  }
  
  function loadData() {
    db.ref("utilisateurs").orderByChild("role").equalTo("ipp").on("value", function(snap) {
      ipps = snap.val() || {};
      updateIppSelect();
      renderAll();
    });
    
    db.ref("sousDivisions").on("value", function(snap) {
      sousDivisions = snap.val() || {};
      renderAll();
    });
    
    db.ref("ecoles").on("value", function(snap) {
      ecoles = snap.val() || {};
      renderAll();
    });
    
    db.ref("classes").on("value", function(snap) {
      classes = snap.val() || {};
      renderAll();
    });
    
    db.ref("effectifs").on("value", function(snap) {
      effectifs = snap.val() || {};
      renderAll();
    });
  }
  
  function populateProvincesDropdown() {
    var select = document.getElementById("ipp-province");
    if (!select) return;
    
    select.innerHTML = '<option value="">Sélectionner une province</option>';
    provincesList.forEach(function(province) {
      var option = document.createElement("option");
      option.value = province.nom;
      option.setAttribute("data-code", province.code);
      option.textContent = province.nom + " (Code: " + province.code + ")";
      select.appendChild(option);
    });
    
    select.addEventListener("change", function() {
      var codeInput = document.getElementById("ipp-code");
      var selectedOption = select.options[select.selectedIndex];
      var code = selectedOption ? (selectedOption.getAttribute("data-code") || "") : "";
      if (codeInput) codeInput.value = code;
    });
  }
  
  function updateIppSelect() {
    var filterSelect = document.getElementById("filter-ipp");
    if (!filterSelect) return;
    
    filterSelect.innerHTML = '<option value="">Toutes les provinces</option>';
    for (var uid in ipps) {
      if (ipps.hasOwnProperty(uid)) {
        var ipp = ipps[uid];
        if (ipp.statut === "supprime") continue;
        var option = document.createElement("option");
        option.value = uid;
        option.textContent = ipp.nomEntite;
        filterSelect.appendChild(option);
      }
    }
  }
  
  function bindEvents() {
    var navLinks = document.querySelectorAll(".nav-link[data-view]");
    for (var i = 0; i < navLinks.length; i++) {
      navLinks[i].addEventListener("click", function(e) {
        e.preventDefault();
        var view = this.getAttribute("data-view");
        var allLinks = document.querySelectorAll(".nav-link");
        for (var j = 0; j < allLinks.length; j++) {
          allLinks[j].classList.remove("active");
        }
        this.classList.add("active");
        var allViews = document.querySelectorAll(".view");
        for (var k = 0; k < allViews.length; k++) {
          allViews[k].classList.remove("active");
        }
        var viewEl = document.getElementById("view-" + view);
        if (viewEl) viewEl.classList.add("active");
        
        var titles = {
          overview: "Vue d'ensemble nationale",
          ipp: "Gestion des IPP",
          maternelle: "Cycle Maternelle",
          primaire: "Cycle Primaire",
          secondaire: "Cycle Secondaire",
          indicators: "Indicateurs",
          reports: "Rapports"
        };
        var pageTitle = document.getElementById("page-title");
        if (pageTitle) pageTitle.textContent = titles[view] || view;

        var sb = document.getElementById("sidebar");
        var ov = document.getElementById("sidebar-overlay");
        if (sb) sb.classList.remove("open");
        if (ov) ov.classList.remove("show");
      });
    }
    
    var filterIppEl = document.getElementById("filter-ipp");
    var filterCategorieEl = document.getElementById("filter-categorie");
    var resetFiltersEl = document.getElementById("reset-filters");
    
    if (filterIppEl) {
      filterIppEl.addEventListener("change", function(e) { 
        filterIpp = e.target.value; 
        renderAll(); 
      });
    }
    if (filterCategorieEl) {
      filterCategorieEl.addEventListener("change", function(e) { 
        filterCategorie = e.target.value; 
        renderAll(); 
      });
    }
    if (resetFiltersEl) {
      resetFiltersEl.addEventListener("click", function() {
        if (filterIppEl) filterIppEl.value = "";
        if (filterCategorieEl) filterCategorieEl.value = "";
        filterIpp = "";
        filterCategorie = "";
        renderAll();
      });
    }
    
    var btnNewIpp = document.getElementById("btn-new-ipp");
    var genPass = document.getElementById("gen-pass");
    var formIpp = document.getElementById("form-ipp");
    
    if (btnNewIpp) btnNewIpp.addEventListener("click", function() { openIppModal(); });
    if (genPass) {
      genPass.addEventListener("click", function() {
        var passInput = document.getElementById("ipp-pass");
        if (passInput) passInput.value = generatePassword(10);
      });
    }
    if (formIpp) formIpp.addEventListener("submit", saveIpp);
    
    var logoutLink = document.getElementById("logout-link");
    if (logoutLink) {
      logoutLink.addEventListener("click", async function(e) {
        e.preventDefault();
        await auth.signOut();
        window.location.href = "../index.html";
      });
    }
    
    var refreshBtn = document.getElementById("refresh-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function() {
        renderAll();
        toast("Données rafraîchies", "success");
      });
    }

    // Recherche
    var globalSearch = document.getElementById("global-search");
    if (globalSearch) {
      globalSearch.addEventListener("input", function(e) {
        var q = e.target.value.toLowerCase().trim();
        var rows = document.querySelectorAll("#ipp-table tr, #maternelle-table-container tbody tr, #primaire-table-container tbody tr, #cteb-table-container tbody tr, #cycle-long-table-container tbody tr, #cycle-court-table-container tbody tr");
        for (var m = 0; m < rows.length; m++) {
          var r = rows[m];
          if (!q) {
            r.style.display = "";
          } else {
            r.style.display = r.textContent.toLowerCase().includes(q) ? "" : "none";
          }
        }
      });
    }
    
    var btnExportPdf = document.getElementById("btn-export-pdf");
    if (btnExportPdf) btnExportPdf.addEventListener("click", exportToPdf);
    
    var closeButtons = document.querySelectorAll("[data-close-modal]");
    for (var l = 0; l < closeButtons.length; l++) {
      closeButtons[l].addEventListener("click", function() {
        var modal = this.closest(".modal");
        if (modal) modal.classList.remove("show");
      });
    }

    var sidebar = document.getElementById("sidebar");
    var overlay = document.getElementById("sidebar-overlay");
    var burger = document.getElementById("hamburger-btn");

    if (burger && sidebar) {
      burger.addEventListener("click", function() {
        if (window.innerWidth <= 1024) {
          sidebar.classList.add("open");
          if (overlay) overlay.classList.add("show");
        } else {
          sidebar.classList.toggle("collapsed");
        }
      });
    }
    if (overlay && sidebar) {
      overlay.addEventListener("click", function() {
        sidebar.classList.remove("open");
        overlay.classList.remove("show");
      });
    }
    window.addEventListener("resize", function() {
      if (window.innerWidth > 1024) {
        sidebar.classList.remove("open");
        if (overlay) overlay.classList.remove("show");
      }
    });
  }
  
  // ==================== CALCUL DES STATISTIQUES ====================
  // MODIFICATION 1 : suppression totalFillesHandicap / totalGarconsHandicap / handicap
  function calculateStats() {
    var totalEleves = 0, totalFilles = 0, totalGarcons = 0;
    var totalIPP = 0, totalSD = 0, totalEcoles = 0;
    var ecolesMaternelle = 0, ecolesPrimaire = 0, ecolesSecondaire = 0;
    var ecolesPubliques = 0, ecolesPrivees = 0;
    var classesInactives = 0, incoherences = 0;
    var activeIn30 = 0;
    var now = Date.now();
    var thirtyDays = 30 * 24 * 60 * 60 * 1000;
    
    var statsMaternelle = { 1:0, 2:0, 3:0, filles: {1:0,2:0,3:0}, garcons:{1:0,2:0,3:0} };
    var statsPrimaire = { 1:0,2:0,3:0,4:0,5:0,6:0, filles:{1:0,2:0,3:0,4:0,5:0,6:0}, garcons:{1:0,2:0,3:0,4:0,5:0,6:0} };
    var statsCTEB = { 7:0, 8:0, filles:{7:0,8:0}, garcons:{7:0,8:0} };
    var statsCycleLong = {};
    var statsCycleCourt = {};
    
    for (var uid in ipps) {
      if (ipps.hasOwnProperty(uid)) {
        var ipp = ipps[uid];
        if (ipp.statut !== "supprime" && ipp.statut !== "inactif") totalIPP++;
      }
    }
    
    for (var sid in sousDivisions) {
      if (sousDivisions.hasOwnProperty(sid)) {
        var sd = sousDivisions[sid];
        if (filterIpp && sd.ippId !== filterIpp) continue;
        totalSD++;
      }
    }
    
    for (var eid in ecoles) {
      if (ecoles.hasOwnProperty(eid)) {
        var ecole = ecoles[eid];
        if (filterIpp && ecole.ippId !== filterIpp) continue;
        if (filterCategorie && ecole.categorie !== filterCategorie) continue;
        if (ecole.statut === "supprime") continue;
        
        totalEcoles++;
        if (ecole.categorie === "publique") ecolesPubliques++;
        else if (ecole.categorie === "privee") ecolesPrivees++;
        
        if (ecole.cycle === "maternelle") ecolesMaternelle++;
        else if (ecole.cycle === "primaire") ecolesPrimaire++;
        else if (ecole.cycle === "secondaire") ecolesSecondaire++;
      }
    }
    
    for (var cid in classes) {
      if (classes.hasOwnProperty(cid)) {
        var classe = classes[cid];
        var ecoleC = ecoles[classe.ecoleId];
        if (!ecoleC) continue;
        if (filterIpp && ecoleC.ippId !== filterIpp) continue;
        if (filterCategorie && ecoleC.categorie !== filterCategorie) continue;
        if (ecoleC.statut === "supprime") continue;
        if (classe.statut === "supprime") continue;
        
        var eff = effectifs[cid] || { nb_filles: 0, nb_garcons: 0, lastUpdate: 0 };
        var f = eff.nb_filles || 0;
        var g = eff.nb_garcons || 0;
        
        totalFilles += f;
        totalGarcons += g;
        
        var lastUpdate = eff.lastUpdate || 0;
        if (lastUpdate > 0 && (now - lastUpdate) > thirtyDays) classesInactives++;
        if (lastUpdate > 0 && (now - lastUpdate) <= thirtyDays) activeIn30++;
        
        var niveau = classe.niveau;
        var cycle = classe.cycle;
        var option = classe.optionCode;
        
        if (cycle === "maternelle") {
          statsMaternelle[niveau] = (statsMaternelle[niveau] || 0) + f + g;
          statsMaternelle.filles[niveau] = (statsMaternelle.filles[niveau] || 0) + f;
          statsMaternelle.garcons[niveau] = (statsMaternelle.garcons[niveau] || 0) + g;
        } else if (cycle === "primaire") {
          statsPrimaire[niveau] = (statsPrimaire[niveau] || 0) + f + g;
          statsPrimaire.filles[niveau] = (statsPrimaire.filles[niveau] || 0) + f;
          statsPrimaire.garcons[niveau] = (statsPrimaire.garcons[niveau] || 0) + g;
        } else if (cycle === "secondaire") {
          var sousCycle = classe.sousCycle;
          if (sousCycle === "cteb") {
            statsCTEB[niveau] = (statsCTEB[niveau] || 0) + f + g;
            statsCTEB.filles[niveau] = (statsCTEB.filles[niveau] || 0) + f;
            statsCTEB.garcons[niveau] = (statsCTEB.garcons[niveau] || 0) + g;
          } else if (sousCycle === "long") {
            if (!statsCycleLong[niveau]) statsCycleLong[niveau] = {};
            if (!statsCycleLong[niveau][option]) {
              statsCycleLong[niveau][option] = { total: 0, filles: 0, garcons: 0, optionLibelle: classe.optionLibelle };
            }
            statsCycleLong[niveau][option].total += f + g;
            statsCycleLong[niveau][option].filles += f;
            statsCycleLong[niveau][option].garcons += g;
          } else if (sousCycle === "court") {
            if (!statsCycleCourt[niveau]) statsCycleCourt[niveau] = {};
            if (!statsCycleCourt[niveau][option]) {
              statsCycleCourt[niveau][option] = { total: 0, filles: 0, garcons: 0, optionLibelle: classe.optionLibelle };
            }
            statsCycleCourt[niveau][option].total += f + g;
            statsCycleCourt[niveau][option].filles += f;
            statsCycleCourt[niveau][option].garcons += g;
          }
        }
      }
    }
    
    totalEleves = totalFilles + totalGarcons;
    var activityRate = Object.keys(classes).length > 0 ? (activeIn30 / Object.keys(classes).length) * 100 : 0;
    
    return {
      totalEleves: totalEleves, totalFilles: totalFilles, totalGarcons: totalGarcons,
      totalIPP: totalIPP, totalSD: totalSD, totalEcoles: totalEcoles, 
      ecolesMaternelle: ecolesMaternelle, ecolesPrimaire: ecolesPrimaire, ecolesSecondaire: ecolesSecondaire,
      ecolesPubliques: ecolesPubliques, ecolesPrivees: ecolesPrivees, 
      classesInactives: classesInactives, incoherences: incoherences, activityRate: activityRate,
      statsMaternelle: statsMaternelle, statsPrimaire: statsPrimaire, statsCTEB: statsCTEB, 
      statsCycleLong: statsCycleLong, statsCycleCourt: statsCycleCourt
    };
  }

  // MODIFICATION 4 : calcul des stats filtrées pour un IPP spécifique
  function calculateStatsForIpp(ippId) {
    var totalEleves = 0, totalFilles = 0, totalGarcons = 0;
    var totalSD = 0, totalEcoles = 0, totalClasses = 0;

    var statsMaternelle = { 1:0, 2:0, 3:0, filles:{1:0,2:0,3:0}, garcons:{1:0,2:0,3:0} };
    var statsPrimaire = { 1:0,2:0,3:0,4:0,5:0,6:0, filles:{1:0,2:0,3:0,4:0,5:0,6:0}, garcons:{1:0,2:0,3:0,4:0,5:0,6:0} };
    var statsCTEB = { 7:0, 8:0, filles:{7:0,8:0}, garcons:{7:0,8:0} };
    var statsCycleLong = {};
    var statsCycleCourt = {};

    for (var sid in sousDivisions) {
      if (sousDivisions.hasOwnProperty(sid) && sousDivisions[sid].ippId === ippId) totalSD++;
    }
    for (var eid in ecoles) {
      if (ecoles.hasOwnProperty(eid) && ecoles[eid].ippId === ippId && ecoles[eid].statut !== "supprime") totalEcoles++;
    }

    for (var cid in classes) {
      if (!classes.hasOwnProperty(cid)) continue;
      var classe = classes[cid];
      if (classe.ippId !== ippId) continue;
      if (classe.statut === "supprime") continue;

      totalClasses++;
      var eff = effectifs[cid] || { nb_filles:0, nb_garcons:0 };
      var f = eff.nb_filles || 0;
      var g = eff.nb_garcons || 0;
      totalFilles += f;
      totalGarcons += g;

      var niveau = classe.niveau;
      var cycle = classe.cycle;
      var option = classe.optionCode;

      if (cycle === "maternelle") {
        statsMaternelle[niveau] = (statsMaternelle[niveau]||0) + f + g;
        statsMaternelle.filles[niveau] = (statsMaternelle.filles[niveau]||0) + f;
        statsMaternelle.garcons[niveau] = (statsMaternelle.garcons[niveau]||0) + g;
      } else if (cycle === "primaire") {
        statsPrimaire[niveau] = (statsPrimaire[niveau]||0) + f + g;
        statsPrimaire.filles[niveau] = (statsPrimaire.filles[niveau]||0) + f;
        statsPrimaire.garcons[niveau] = (statsPrimaire.garcons[niveau]||0) + g;
      } else if (cycle === "secondaire") {
        var sc = classe.sousCycle;
        if (sc === "cteb") {
          statsCTEB[niveau] = (statsCTEB[niveau]||0) + f + g;
          statsCTEB.filles[niveau] = (statsCTEB.filles[niveau]||0) + f;
          statsCTEB.garcons[niveau] = (statsCTEB.garcons[niveau]||0) + g;
        } else if (sc === "long") {
          if (!statsCycleLong[niveau]) statsCycleLong[niveau] = {};
          if (!statsCycleLong[niveau][option]) statsCycleLong[niveau][option] = {total:0,filles:0,garcons:0,optionLibelle:classe.optionLibelle};
          statsCycleLong[niveau][option].total += f+g;
          statsCycleLong[niveau][option].filles += f;
          statsCycleLong[niveau][option].garcons += g;
        } else if (sc === "court") {
          if (!statsCycleCourt[niveau]) statsCycleCourt[niveau] = {};
          if (!statsCycleCourt[niveau][option]) statsCycleCourt[niveau][option] = {total:0,filles:0,garcons:0,optionLibelle:classe.optionLibelle};
          statsCycleCourt[niveau][option].total += f+g;
          statsCycleCourt[niveau][option].filles += f;
          statsCycleCourt[niveau][option].garcons += g;
        }
      }
    }
    totalEleves = totalFilles + totalGarcons;

    return { totalEleves, totalFilles, totalGarcons, totalSD, totalEcoles, totalClasses,
             statsMaternelle, statsPrimaire, statsCTEB, statsCycleLong, statsCycleCourt };
  }
  
  function renderAll() {
    var stats = calculateStats();
    renderKPIs(stats);
    renderIppTable(stats);
    renderMaternelleTable(stats);
    renderPrimaireTable(stats);
    renderCTEBTable(stats);
    renderCycleLongTable(stats);
    renderCycleCourtTable(stats);
    renderIndicators(stats);
    renderReports(stats);
    if (window.Chart) renderEvolutionChart();
  }
  
  // MODIFICATION 1 : suppression des 3 KPI handicap
  function renderKPIs(s) {
    var el;
    el = document.getElementById("total-eleves"); if (el) el.textContent = fmt(s.totalEleves);
    el = document.getElementById("total-filles"); if (el) el.textContent = fmt(s.totalFilles);
    el = document.getElementById("total-garcons"); if (el) el.textContent = fmt(s.totalGarcons);
    el = document.getElementById("total-ipp"); if (el) el.textContent = fmt(s.totalIPP);
    el = document.getElementById("total-sd"); if (el) el.textContent = fmt(s.totalSD);
    el = document.getElementById("total-ecoles"); if (el) el.textContent = fmt(s.totalEcoles);
    el = document.getElementById("ecoles-maternelle"); if (el) el.textContent = fmt(s.ecolesMaternelle);
    el = document.getElementById("ecoles-primaire"); if (el) el.textContent = fmt(s.ecolesPrimaire);
    el = document.getElementById("ecoles-secondaire"); if (el) el.textContent = fmt(s.ecolesSecondaire);
    el = document.getElementById("ecoles-publiques"); if (el) el.textContent = fmt(s.ecolesPubliques);
    el = document.getElementById("ecoles-privees"); if (el) el.textContent = fmt(s.ecolesPrivees);
  }
  
  // MODIFICATION 4 : ajout du bouton "Voir stats" en première action
  function renderIppTable(stats) {
    var tbody = document.getElementById("ipp-table");
    if (!tbody) return;
    
    var list = [];
    for (var uid in ipps) {
      if (ipps.hasOwnProperty(uid)) {
        var i = ipps[uid];
        i._uid = uid;  // garantit que l'uid est toujours accessible
        if (i.statut !== "supprime") list.push(i);
      }
    }
    
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">Aucun IPP enregistré</td></tr>';
      return;
    }
    
    var html = "";
    for (var idx = 0; idx < list.length; idx++) {
      var i = list[idx];
      var nbSd = 0, nbEcoles = 0, nbClasses = 0, nbEleves = 0;
      for (var sid in sousDivisions) {
        if (sousDivisions.hasOwnProperty(sid)) {
          if (sousDivisions[sid].ippId === i.uid) nbSd++;
        }
      }
      for (var eid in ecoles) {
        if (ecoles.hasOwnProperty(eid)) {
          if (ecoles[eid].ippId === i.uid) nbEcoles++;
        }
      }
      for (var cid in classes) {
        if (classes.hasOwnProperty(cid)) {
          if (classes[cid].ippId === i.uid) {
            nbClasses++;
            var eff = effectifs[cid] || {};
            nbEleves += (eff.nb_filles || 0) + (eff.nb_garcons || 0);
          }
        }
      }
      
      var statusBadge = i.statut === "inactif" ? 'badge-muted' : 'badge-success';
      var statusText = i.statut === "inactif" ? 'Inactif' : 'Actif';
      
      html += '<tr>';
      html += '<td><strong>' + escape(i.nomEntite) + '</strong></td>';
      html += '<td>' + escape(i.codeProvince || "-") + '</td>';
      html += '<td>' + escape(i.responsable || "-") + '</td>';
      //html += '<td>' + fmt(nbSd) + '</td>';
      //html += '<td>' + fmt(nbEcoles) + '</td>';
      //html += '<td>' + fmt(nbClasses) + '</td>';
      //html += '<td>' + fmt(nbEleves) + '</td>';
      html += '<td><span class="badge ' + statusBadge + '">' + statusText + '</span></td>';
      html += '<td><div class="row-actions">';
      // Bouton "Voir stats" en premier
      var iid = i._uid || i.uid || '';
      html += '<button class="icon-btn success" data-action="stats" data-id="' + iid + '" title="Voir statistiques"><i class="fas fa-chart-bar"></i></button>';
      html += '<button class="icon-btn" data-action="edit" data-id="' + iid + '" title="Modifier"><i class="fas fa-pen"></i></button>';
      html += '<button class="icon-btn" data-action="reset" data-id="' + iid + '" data-email="' + escape(i.email || '') + '" title="Réinitialiser MDP"><i class="fas fa-key"></i></button>';
      html += '<button class="icon-btn ' + (i.statut === 'inactif' ? '' : 'warning') + '" data-action="toggle" data-id="' + iid + '" data-statut="' + i.statut + '" title="' + (i.statut === 'inactif' ? 'Réactiver' : 'Désactiver') + '">';
      html += '<i class="fas ' + (i.statut === 'inactif' ? 'fa-circle-play' : 'fa-circle-pause') + '"></i></button>';
      html += '<button class="icon-btn danger" data-action="delete" data-id="' + iid + '" data-nom="' + escape(i.nomEntite) + '" title="Supprimer"><i class="fas fa-trash"></i></button>';
      html += '</div></td></tr>';
    }
    
    tbody.innerHTML = html;
    
    var btns = tbody.querySelectorAll("button[data-action]");
    for (var b = 0; b < btns.length; b++) {
      btns[b].addEventListener("click", function(e) {
        e.stopPropagation();
        var action = this.getAttribute("data-action");
        var id = this.getAttribute("data-id");
        var email = this.getAttribute("data-email");
        var nom = this.getAttribute("data-nom");
        var statut = this.getAttribute("data-statut");
        
        if (action === "stats") showIppStats(id);
        else if (action === "edit") openIppModal(id);
        else if (action === "reset") resetIppPassword(email, nom);
        else if (action === "toggle") toggleIpp(id, statut);
        else if (action === "delete") deleteIpp(id, nom);
      });
    }
  }

  // MODIFICATION 4 : fonction showIppStats — affiche les stats d'un IPP dans un modal
  function showIppStats(ippId) {
    _currentStatsIppId = ippId;
    var ipp = ipps[ippId];
    var ippNom = ipp ? (ipp.nomEntite || ippId) : ippId;

    var titleEl = document.getElementById("modal-ipp-stats-title");
    if (titleEl) titleEl.innerHTML = '<i class="fas fa-chart-bar"></i> Statistiques — ' + escape(ippNom);

    var s = calculateStatsForIpp(ippId);

    var thStyle = 'border:1px solid #e5e7eb;padding:5px 7px;background:#f3f4f6;text-align:left;font-size:12px;';
    var tdStyle = 'border:1px solid #e5e7eb;padding:5px 7px;text-align:left;font-size:12px;';
    var sectionStyle = 'font-size:13px;font-weight:bold;background:#eff6ff;padding:5px 10px;border-left:4px solid #2563eb;margin:16px 0 8px;';
    var tblStyle = 'width:100%;border-collapse:collapse;margin-bottom:12px;table-layout:auto;';

    var html = '';
    // KPI résumé
    html += '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;">';
    html += kpiMini('Sous-Divisions', s.totalSD, 'fa-sitemap', '#3b82f6');
    html += kpiMini('Écoles', s.totalEcoles, 'fa-school', '#10b981');
    html += kpiMini('Classes', s.totalClasses, 'fa-chalkboard', '#f59e0b');
    html += kpiMini('Total élèves', s.totalEleves, 'fa-users', '#8b5cf6');
    html += kpiMini('Filles', s.totalFilles, 'fa-venus', '#ec4899');
    html += kpiMini('Garçons', s.totalGarcons, 'fa-mars', '#06b6d4');
    html += '</div>';

    html += '<div style="' + sectionStyle + '">Cycle Maternelle</div>';
    html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildMaternelleRows(s), thStyle, tdStyle, tblStyle);

    html += '<div style="' + sectionStyle + '">Cycle Primaire</div>';
    html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildPrimaireRows(s), thStyle, tdStyle, tblStyle);

    html += '<div style="' + sectionStyle + '">CTEB</div>';
    html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildCtebRows(s), thStyle, tdStyle, tblStyle);

    html += '<div style="' + sectionStyle + '">Cycle Long</div>';
    html += buildReportTable(['Niveau','Option','Code','Filles','Garçons','<strong>Total</strong>'], buildCycleLongRows(s), thStyle, tdStyle, tblStyle);

    html += '<div style="' + sectionStyle + '">Cycle Court</div>';
    html += buildReportTable(['Niveau','Option','Code','Filles','Garçons','<strong>Total</strong>'], buildCycleCourtRows(s), thStyle, tdStyle, tblStyle);

    var content = document.getElementById("ipp-stats-content");
    if (content) content.innerHTML = html;

    // Lier le bouton export PDF IPP
    var btnExport = document.getElementById("btn-export-ipp-stats");
    if (btnExport) {
      btnExport.onclick = function() { exportIppToPdf(ippId); };
    }

    var modal = document.getElementById("modal-ipp-stats");
    if (modal) modal.classList.add("show");
  }

  function kpiMini(label, val, icon, color) {
    return '<div style="flex:1;min-width:120px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;text-align:center;">'
      + '<div style="color:' + color + ';font-size:18px;margin-bottom:4px;"><i class="fas ' + icon + '"></i></div>'
      + '<div style="font-size:20px;font-weight:700;color:#0f172a;">' + fmt(val) + '</div>'
      + '<div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">' + label + '</div>'
      + '</div>';
  }

  // MODIFICATION 4 : export PDF IPP — porte le nom de l'IPP
  function exportIppToPdf(ippId) {
    if (!window.html2pdf) {
      toast("Bibliothèque PDF indisponible", "error");
      return;
    }
    var ipp = ipps[ippId];
    var ippNom = ipp ? (ipp.nomEntite || ippId) : ippId;
    var responsable = ipp ? (ipp.responsable || "Non spécifié") : "Non spécifié";
    var d = new Date();
    var dateRapport = d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
    var annee1 = d.getFullYear();
    var annee2 = annee1 + 1;
    var serial = generateSerialNumber();

    var s = calculateStatsForIpp(ippId);

    var wrapper = document.createElement("div");
    wrapper.style.cssText = "font-family:'Inter',Arial,sans-serif;padding:16px 20px;color:#111827;background:white;width:257mm;max-width:100%;box-sizing:border-box;";

    var thStyle = 'border:1px solid #d1d5db;padding:5px 7px;background:#f3f4f6;text-align:left;font-size:11px;';
    var tdStyle = 'border:1px solid #d1d5db;padding:5px 7px;text-align:left;font-size:11px;';
    var sectionStyle = 'font-size:12px;font-weight:bold;background:#eff6ff;padding:5px 8px;border-left:4px solid #2563eb;margin:14px 0 8px;';
    var tableStyle = 'width:100%;border-collapse:collapse;margin-bottom:12px;table-layout:fixed;word-break:break-word;';

    // En-tête officiel
    var html = '';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #1e3a8a;padding-bottom:10px;margin-bottom:14px;">';
    html += '  <img src="../img/logo min backless.png" alt="Ministère RDC" style="width:70px;height:70px;object-fit:contain;flex-shrink:0;" />';
    html += '  <div style="flex:1;text-align:center;padding:0 12px;">';
    html += '    <div style="font-size:10px;font-weight:600;color:#374151;letter-spacing:0.5px;">REPUBLIQUE DEMOCRATIQUE DU CONGO</div>';
    html += '    <div style="font-size:9px;color:#374151;margin-top:2px;">MINISTERE DE L\'EDUCATION NATIONALE ET NOUVELLE CITOYENNETE</div>';
    html += '    <div style="font-size:13px;font-weight:bold;color:#1e3a8a;margin-top:5px;">' + escape(ippNom).toUpperCase() + '</div>';
    html += '    <div style="font-size:10px;font-weight:600;color:#1e3a8a;margin-top:3px;">RAPPORT STATISTIQUE DES BULLETINS SCOLAIRES ' + annee1 + '-' + annee2 + '</div>';
    html += '  </div>';
    html += '  <div style="width:70px;"></div>';
    html += '</div>';

    // Synthèse globale
    html += '<div style="' + sectionStyle + '">1. SYNTHÈSE GLOBALE</div>';
    html += '<table style="' + tableStyle + '">';
    html += '<thead><tr><th style="' + thStyle + 'width:70%;">Indicateur</th><th style="' + thStyle + 'width:30%;">Valeur</th></tr></thead><tbody>';
    html += '<tr><td style="' + tdStyle + '">Sous-Divisions</td><td style="' + tdStyle + '">' + fmt(s.totalSD) + '</td></tr>';
    html += '<tr><td style="' + tdStyle + '">Écoles</td><td style="' + tdStyle + '">' + fmt(s.totalEcoles) + '</td></tr>';
    html += '<tr><td style="' + tdStyle + '">Classes</td><td style="' + tdStyle + '">' + fmt(s.totalClasses) + '</td></tr>';
    html += '<tr><td style="' + tdStyle + '">Total élèves</td><td style="' + tdStyle + '">' + fmt(s.totalEleves) + '</td></tr>';
    html += '<tr><td style="' + tdStyle + '">Filles</td><td style="' + tdStyle + '">' + fmt(s.totalFilles) + ' (' + pct(s.totalFilles, s.totalEleves) + ')</td></tr>';
    html += '<tr><td style="' + tdStyle + '">Garçons</td><td style="' + tdStyle + '">' + fmt(s.totalGarcons) + ' (' + pct(s.totalGarcons, s.totalEleves) + ')</td></tr>';
    html += '</tbody></table>';

    html += '<div style="' + sectionStyle + '">2. CYCLE MATERNELLE</div>';
    html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildMaternelleRows(s), thStyle, tdStyle, tableStyle);
    html += '<div style="' + sectionStyle + '">3. CYCLE PRIMAIRE</div>';
    html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildPrimaireRows(s), thStyle, tdStyle, tableStyle);
    html += '<div style="' + sectionStyle + '">4. CTEB (7ème & 8ème)</div>';
    html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildCtebRows(s), thStyle, tdStyle, tableStyle);
    html += '<div style="' + sectionStyle + '">5. CYCLE LONG</div>';
    html += buildReportTable(['Niveau','Option','Code','Filles','Garçons','<strong>Total</strong>'], buildCycleLongRows(s), thStyle, tdStyle, tableStyle);
    html += '<div style="' + sectionStyle + '">6. CYCLE COURT</div>';
    html += buildReportTable(['Niveau','Option','Code','Filles','Garçons','<strong>Total</strong>'], buildCycleCourtRows(s), thStyle, tdStyle, tableStyle);

    // Pied de page officiel
    html += '<div style="margin-top:20px;padding-top:12px;border-top:2px solid #1e3a8a;display:flex;justify-content:space-between;align-items:flex-end;">';
    html += '  <div style="width:220px;text-align:center;">';
    html += '    <div style="font-size:10px;">Fait à Kinshasa, le ' + dateRapport + '</div>';
    html += '    <div style="margin-top:40px;border-top:1px solid #000;width:100%;"></div>';
    html += '    <div style="margin-top:5px;font-size:10px;">L\'Inspecteur Principal Provincial</div>';
    html += '    <div style="font-size:10px;"><strong>' + escape(responsable) + '</strong></div>';
    html += '  </div>';
    html += '  <div style="text-align:center;font-size:8px;color:#6b7280;"><div>' + serial + '</div></div>';
    html += '  <div style="width:100px;height:70px;border:1px dashed #9ca3af;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:9px;">Sceau/Cachet</div>';
    html += '</div>';

    wrapper.innerHTML = html;

    var slug = String(ippNom).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z0-9]+/g,"_").replace(/^_+|_+$/g,"").toUpperCase();
    var pad = function(n){ return n < 10 ? "0"+n : ""+n; };
    var filename = "RAPPORT_IPP_" + slug + "_" + d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) + ".pdf";

    var opt = {
      margin: [10,10,10,10], filename: filename,
      image: { type:'jpeg', quality:0.98 },
      html2canvas: { scale:2, useCORS:true, logging:false },
      jsPDF: { unit:'mm', format:'a4', orientation:'landscape' },
      pagebreak: { mode:['avoid-all','css','legacy'] }
    };

    var host = document.createElement("div");
    host.setAttribute("aria-hidden","true");
    host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;z-index:-9999;";
    wrapper.style.position = "relative";
    host.appendChild(wrapper);
    document.body.appendChild(host);

    toast("Génération du PDF IPP...", "info");
    setTimeout(function() {
      window.html2pdf().set(opt).from(wrapper).save().then(function() {
        if (host.parentNode) document.body.removeChild(host);
        toast("PDF généré : " + filename, "success");
      }).catch(function(err) {
        if (host.parentNode) document.body.removeChild(host);
        console.error(err);
        toast("Erreur lors de la génération du PDF", "error");
      });
    }, 100);
  }

  function generateSerialNumber() {
    var d = new Date();
    var yyyy = d.getFullYear();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var rand4 = String(Math.floor(1000 + Math.random() * 9000));
    return 'SERIE:MINENNC' + yyyy + mm + rand4;
  }
  
  // MODIFICATION 2 : colonnes reordonnées Filles → Garçons → Total (sans handicap)
  function renderMaternelleTable(s) {
    var container = document.getElementById("maternelle-table-container");
    if (!container) return;
    
    var html = '<table class="data-table"><thead><tr><th>Classe</th><th>Filles</th><th>Garçons</th><th><strong>Total</strong></th></tr></thead><tbody>';
    var niveaux = ["1ère Maternelle", "2ème Maternelle", "3ème Maternelle"];
    for (var i = 1; i <= 3; i++) {
      var total = s.statsMaternelle[i] || 0;
      var filles = s.statsMaternelle.filles[i] || 0;
      var garcons = s.statsMaternelle.garcons[i] || 0;
      html += '<tr>';
      html += '<td>' + niveaux[i-1] + '</td>';
      html += '<td>' + fmt(filles) + ' (' + pct(filles, total) + ')' + '</td>';
      html += '<td>' + fmt(garcons) + ' (' + pct(garcons, total) + ')' + '</td>';
      html += '<td><strong>' + fmt(total) + '</strong></td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  }
  
  // MODIFICATION 2 : colonnes reordonnées Filles → Garçons → Total (sans handicap)
  function renderPrimaireTable(s) {
    var container = document.getElementById("primaire-table-container");
    if (!container) return;
    
    var html = '<table class="data-table"><thead><tr><th>Classe</th><th>Filles</th><th>Garçons</th><th><strong>Total</strong></th></tr></thead><tbody>';
    var niveaux = ["1ère Primaire", "2ème Primaire", "3ème Primaire", "4ème Primaire", "5ème Primaire", "6ème Primaire"];
    for (var i = 1; i <= 6; i++) {
      var total = s.statsPrimaire[i] || 0;
      var filles = s.statsPrimaire.filles[i] || 0;
      var garcons = s.statsPrimaire.garcons[i] || 0;
      html += '<tr>';
      html += '<td>' + niveaux[i-1] + '</td>';
      html += '<td>' + fmt(filles) + ' (' + pct(filles, total) + ')' + '</td>';
      html += '<td>' + fmt(garcons) + ' (' + pct(garcons, total) + ')' + '</td>';
      html += '<td><strong>' + fmt(total) + '</strong></td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  }
  
  // MODIFICATION 2 : colonnes reordonnées Filles → Garçons → Total (sans handicap)
  function renderCTEBTable(s) {
    var container = document.getElementById("cteb-table-container");
    if (!container) return;
    
    var html = '<table class="data-table"><thead><tr><th>Classe</th><th>Filles</th><th>Garçons</th><th><strong>Total</strong></th></tr></thead><tbody>';
    
    var niveauxCteb = [7, 8];
    for (var n = 0; n < niveauxCteb.length; n++) {
      var niv = niveauxCteb[n];
      var total = s.statsCTEB[niv] || 0;
      var filles = s.statsCTEB.filles[niv] || 0;
      var garcons = s.statsCTEB.garcons[niv] || 0;
      html += '<tr>';
      html += '<td>' + niv + 'ème</td>';
      html += '<td>' + fmt(filles) + ' (' + pct(filles, total) + ')' + '</td>';
      html += '<td>' + fmt(garcons) + ' (' + pct(garcons, total) + ')' + '</td>';
      html += '<td><strong>' + fmt(total) + '</strong></td>';
      html += '</tr>';
    }
    
    html += '</tbody></table>';
    container.innerHTML = html;
  }
  
  // MODIFICATION 2 : colonnes reordonnées Filles → Garçons → Total (sans handicap)
  function renderCycleLongTable(s) {
    var container = document.getElementById("cycle-long-table-container");
    if (!container) return;
    
    var html = '<table class="data-table"><thead><tr><th>Niveau</th><th>Option</th><th>Code</th><th>Filles</th><th>Garçons</th><th><strong>Total</strong></th></tr></thead><tbody>';
    
    for (var niveau = 1; niveau <= 4; niveau++) {
      if (s.statsCycleLong[niveau] && Object.keys(s.statsCycleLong[niveau]).length > 0) {
        for (var code in s.statsCycleLong[niveau]) {
          if (s.statsCycleLong[niveau].hasOwnProperty(code)) {
            var data = s.statsCycleLong[niveau][code];
            var total = data.total || 0;
            var filles = data.filles || 0;
            var garcons = data.garcons || 0;
            var niveauNom = niveau + "ère Humanité";
            html += '<tr>';
            html += '<td>' + niveauNom + '</td>';
            html += '<td>' + escape(data.optionLibelle || code) + '</td>';
            html += '<td>' + code + '</td>';
            html += '<td>' + fmt(filles) + ' (' + pct(filles, total) + ')' + '</td>';
            html += '<td>' + fmt(garcons) + ' (' + pct(garcons, total) + ')' + '</td>';
            html += '<td><strong>' + fmt(total) + '</strong></td>';
            html += '</tr>';
          }
        }
      }
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  }
  
  // MODIFICATION 2 : colonnes reordonnées Filles → Garçons → Total (sans handicap)
  function renderCycleCourtTable(s) {
    var container = document.getElementById("cycle-court-table-container");
    if (!container) return;
    
    var html = '<table class="data-table"><thead><tr><th>Niveau</th><th>Option</th><th>Code</th><th>Filles</th><th>Garçons</th><th><strong>Total</strong></th></tr></thead><tbody>';
    
    for (var niveau = 1; niveau <= 3; niveau++) {
      if (s.statsCycleCourt[niveau] && Object.keys(s.statsCycleCourt[niveau]).length > 0) {
        for (var code in s.statsCycleCourt[niveau]) {
          if (s.statsCycleCourt[niveau].hasOwnProperty(code)) {
            var data = s.statsCycleCourt[niveau][code];
            var total = data.total || 0;
            var filles = data.filles || 0;
            var garcons = data.garcons || 0;
            var niveauNom = niveau + "ère Humanité";
            html += '<tr>';
            html += '<td>' + niveauNom + '</td>';
            html += '<td>' + escape(data.optionLibelle || code) + '</td>';
            html += '<td>' + code + '</td>';
            html += '<td>' + fmt(filles) + ' (' + pct(filles, total) + ')' + '</td>';
            html += '<td>' + fmt(garcons) + ' (' + pct(garcons, total) + ')' + '</td>';
            html += '<td><strong>' + fmt(total) + '</strong></td>';
            html += '</tr>';
          }
        }
      }
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  }
  
  function renderIndicators(s) {
    var el;
    el = document.getElementById("ind-activity"); if (el) el.textContent = s.activityRate.toFixed(1).replace(".", ",") + "%";
    el = document.getElementById("ind-inactive"); if (el) el.textContent = fmt(s.classesInactives);
    el = document.getElementById("ind-incoherences"); if (el) el.textContent = fmt(s.incoherences);
  }
  
  // MODIFICATION 1+2 : sans handicap, Filles → Garçons → Total
  function renderReports(s) {
    var container = document.getElementById("reports-container");
    if (!container) return;

    var html = '';

    html += '<div class="report-section" style="margin-bottom: 25px;">';
    html += '<h3 class="section-title" style="font-size: 14px; font-weight: bold; background: #eff6ff; padding: 6px 10px; border-left: 4px solid #2563eb; margin-bottom: 10px;">Cycle Maternelle</h3>';
    html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildMaternelleRows(s));
    html += '</div>';

    html += '<div class="report-section" style="margin-bottom: 25px;">';
    html += '<h3 class="section-title" style="font-size: 14px; font-weight: bold; background: #eff6ff; padding: 6px 10px; border-left: 4px solid #2563eb; margin-bottom: 10px;">Cycle Primaire</h3>';
    html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildPrimaireRows(s));
    html += '</div>';

    html += '<div class="report-section" style="margin-bottom: 25px;">';
    html += '<h3 class="section-title" style="font-size: 14px; font-weight: bold; background: #eff6ff; padding: 6px 10px; border-left: 4px solid #2563eb; margin-bottom: 10px;">CTEB (7ème & 8ème)</h3>';
    html += buildReportTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildCtebRows(s));
    html += '</div>';

    html += '<div class="report-section" style="margin-bottom: 25px;">';
    html += '<h3 class="section-title" style="font-size: 14px; font-weight: bold; background: #eff6ff; padding: 6px 10px; border-left: 4px solid #2563eb; margin-bottom: 10px;">Cycle Long (1ère → 4ème Humanité)</h3>';
    html += buildReportTable(['Niveau','Option','Code','Filles','Garçons','<strong>Total</strong>'], buildCycleLongRows(s));
    html += '</div>';

    html += '<div class="report-section" style="margin-bottom: 25px;">';
    html += '<h3 class="section-title" style="font-size: 14px; font-weight: bold; background: #eff6ff; padding: 6px 10px; border-left: 4px solid #2563eb; margin-bottom: 10px;">Cycle Court (1ère → 3ème Humanité)</h3>';
    html += buildReportTable(['Niveau','Option','Code','Filles','Garçons','<strong>Total</strong>'], buildCycleCourtRows(s));
    html += '</div>';

    container.innerHTML = html;
  }

  // ---- Helpers de construction de lignes ----
  // MODIFICATION 1+2 : sans handicap, ordre Filles → Garçons → Total (bold)
  function buildMaternelleRows(s) {
    var rows = [];
    var niveaux = ["1ère Maternelle", "2ème Maternelle", "3ème Maternelle"];
    for (var i = 1; i <= 3; i++) {
      var total = s.statsMaternelle[i] || 0;
      var filles = s.statsMaternelle.filles[i] || 0;
      var garcons = s.statsMaternelle.garcons[i] || 0;
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
    var rows = [];
    var niveaux = ["1ère Primaire", "2ème Primaire", "3ème Primaire", "4ème Primaire", "5ème Primaire", "6ème Primaire"];
    for (var i = 1; i <= 6; i++) {
      var total = s.statsPrimaire[i] || 0;
      var filles = s.statsPrimaire.filles[i] || 0;
      var garcons = s.statsPrimaire.garcons[i] || 0;
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
    var rows = [];
    var niveaux = [7, 8];
    for (var n = 0; n < niveaux.length; n++) {
      var niv = niveaux[n];
      var total = s.statsCTEB[niv] || 0;
      var filles = s.statsCTEB.filles[niv] || 0;
      var garcons = s.statsCTEB.garcons[niv] || 0;
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
    var rows = [];
    for (var niveau = 1; niveau <= 4; niveau++) {
      if (s.statsCycleLong[niveau] && Object.keys(s.statsCycleLong[niveau]).length > 0) {
        for (var code in s.statsCycleLong[niveau]) {
          if (s.statsCycleLong[niveau].hasOwnProperty(code)) {
            var data = s.statsCycleLong[niveau][code];
            var total = data.total || 0;
            var filles = data.filles || 0;
            var garcons = data.garcons || 0;
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
    }
    if (rows.length === 0) rows.push(['—','—','—','0','0','<strong>0</strong>']);
    return rows;
  }
  function buildCycleCourtRows(s) {
    var rows = [];
    for (var niveau = 1; niveau <= 3; niveau++) {
      if (s.statsCycleCourt[niveau] && Object.keys(s.statsCycleCourt[niveau]).length > 0) {
        for (var code in s.statsCycleCourt[niveau]) {
          if (s.statsCycleCourt[niveau].hasOwnProperty(code)) {
            var data = s.statsCycleCourt[niveau][code];
            var total = data.total || 0;
            var filles = data.filles || 0;
            var garcons = data.garcons || 0;
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
    }
    if (rows.length === 0) rows.push(['—','—','—','0','0','<strong>0</strong>']);
    return rows;
  }

  function buildReportTable(headers, rows, thStyle, tdStyle, tableStyleOverride) {
    thStyle = thStyle || 'border:1px solid #e5e7eb;padding:6px 8px;background:#f3f4f6;font-size:11px;';
    tdStyle = tdStyle || 'border:1px solid #e5e7eb;padding:6px 8px;font-size:11px;';
    var ts = tableStyleOverride || 'width:100%;border-collapse:collapse;margin-bottom:12px;table-layout:fixed;word-break:break-word;';
    var html = '<table style="' + ts + '">';
    html += '<thead><tr>';
    for (var h = 0; h < headers.length; h++) html += '<th style="' + thStyle + '">' + headers[h] + '</th>';
    html += '</tr></thead><tbody>';
    for (var r = 0; r < rows.length; r++) {
      html += '<tr>';
      for (var c = 0; c < rows[r].length; c++) html += '<td style="' + tdStyle + '">' + rows[r][c] + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }
  
  function renderEvolutionChart() {
    var ctx = document.getElementById("chart-evolution");
    if (!ctx || !window.Chart) return;
    if (evolutionChart) evolutionChart.destroy();
    
    var labels = [];
    var data = [];
    var now = new Date();
    for (var i = 11; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labels.push(d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }));
      data.push(0);
    }
    
    for (var eid in effectifs) {
      if (effectifs.hasOwnProperty(eid)) {
        var eff = effectifs[eid];
        var last = eff.lastUpdate || 0;
        if (!last) continue;
        var total = (eff.nb_filles || 0) + (eff.nb_garcons || 0);
        var d = new Date(last);
        for (var j = 0; j < 12; j++) {
          var monthDate = new Date(now.getFullYear(), now.getMonth() - (11 - j), 1);
          if (d.getFullYear() === monthDate.getFullYear() && d.getMonth() === monthDate.getMonth()) {
            data[j] += total;
            break;
          }
        }
      }
    }
    
    evolutionChart = new Chart(ctx, {
      type: "line",
      data: { labels: labels, datasets: [{ label: "Effectifs", data: data, borderColor: "#2563eb", backgroundColor: "rgba(37,99,235,0.1)", fill: true, tension: 0.3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    });
  }
  
  // ==================== GESTION DES IPP ====================
  function openIppModal(id) {
    id = id || null;
    var modal = document.getElementById("modal-ipp");
    var title = document.getElementById("modal-ipp-title");
    var idInput = document.getElementById("ipp-id");
    var provinceSelect = document.getElementById("ipp-province");
    var codeInput = document.getElementById("ipp-code");
    var responsableInput = document.getElementById("ipp-responsable");
    var emailInput = document.getElementById("ipp-email");
    var passInput = document.getElementById("ipp-pass");
    var fldEmail = document.getElementById("field-ipp-email");
    var fldPass = document.getElementById("field-ipp-pass");
    
    if (id && ipps[id]) {
      var ipp = ipps[id];
      title.innerHTML = '<i class="fas fa-edit"></i> Modifier l\'IPP';
      idInput.value = id;
      provinceSelect.value = ipp.nomEntite;
      codeInput.value = ipp.codeProvince || "";
      responsableInput.value = ipp.responsable || "";
      fldEmail.classList.add("hidden");
      fldPass.classList.add("hidden");
      emailInput.required = false;
      passInput.required = false;
    } else {
      title.innerHTML = '<i class="fas fa-plus-circle"></i> Nouvel IPP';
      idInput.value = "";
      provinceSelect.value = "";
      codeInput.value = "";
      responsableInput.value = "";
      emailInput.value = "";
      passInput.value = generatePassword(10);
      fldEmail.classList.remove("hidden");
      fldPass.classList.remove("hidden");
      emailInput.required = true;
      passInput.required = true;
    }
    modal.classList.add("show");
  }
  
  async function saveIpp(e) {
    e.preventDefault();
    var id = document.getElementById("ipp-id").value;
    var provinceSelect = document.getElementById("ipp-province");
    var nom = provinceSelect.value;
    var code = document.getElementById("ipp-code").value;
    var responsable = document.getElementById("ipp-responsable").value.trim() || "";
    var email = document.getElementById("ipp-email").value.trim();
    var password = document.getElementById("ipp-pass").value;
    
    if (!nom) {
      toast("Veuillez sélectionner une province", "error");
      return;
    }
    
    try {
      if (id) {
        var updates = {};
        updates["utilisateurs/" + id + "/nomEntite"] = nom;
        updates["utilisateurs/" + id + "/codeProvince"] = code;
        if (responsable) updates["utilisateurs/" + id + "/responsable"] = responsable;
        await db.ref().update(updates);
        toast("IPP modifié avec succès", "success");
        document.getElementById("modal-ipp").classList.remove("show");
      } else {
        if (!email || !password || password.length < 6) {
          toast("Email et mot de passe (≥6 caractères) requis", "error");
          return;
        }
        
        var secondary = firebase.apps.find(function(a) { return a.name === "ekolstat-create-ipp"; });
        if (!secondary) {
          secondary = firebase.initializeApp(window.EKOLSTAT_FIREBASE_CONFIG, "ekolstat-create-ipp");
        }
        
        var cred = await secondary.auth().createUserWithEmailAndPassword(email, password);
        var uid = cred.user.uid;
        
        await db.ref("utilisateurs/" + uid).set({
          email: email,
          role: "ipp",
          nomEntite: nom,
          codeProvince: code,
          responsable: responsable,
          statut: "actif",
          creePar: currentUser.uid,
          createdAt: firebase.database.ServerValue.TIMESTAMP
        });
        
        await secondary.auth().signOut();
        toast("IPP \"" + nom + "\" créé avec succès", "success");
        document.getElementById("modal-ipp").classList.remove("show");
        
        provinceSelect.value = "";
        document.getElementById("ipp-code").value = "";
        document.getElementById("ipp-responsable").value = "";
        document.getElementById("ipp-email").value = "";
        document.getElementById("ipp-pass").value = "";
      }
    } catch (err) {
      toast(err.message, "error");
    }
  }
  
  async function resetIppPassword(email, nom) {
    if (!email) { toast("Cet IPP n'a pas d'email", "error"); return; }
    var ok = await confirmDialog("Réinitialiser le mot de passe", "Envoyer un email à " + email + " ?");
    if (!ok) return;
    try {
      await auth.sendPasswordResetEmail(email);
      toast("Email envoyé à " + email, "success");
    } catch (err) { toast(err.message, "error"); }
  }
  
  async function toggleIpp(id, currentStatut) {
    var ipp = ipps[id];
    var willInactivate = currentStatut !== "inactif";
    var ok = await confirmDialog(
      willInactivate ? "Désactiver l'IPP" : "Réactiver l'IPP",
      willInactivate ? "L'IPP \"" + ipp.nomEntite + "\" ne pourra plus se connecter" : "L'IPP \"" + ipp.nomEntite + "\" pourra se connecter"
    );
    if (!ok) return;
    await db.ref("utilisateurs/" + id + "/statut").set(willInactivate ? "inactif" : "actif");
    toast(willInactivate ? "IPP désactivé" : "IPP réactivé", "success");
  }
  
  async function deleteIpp(id, nom) {
    var ok = await confirmDialog("Supprimer définitivement", "L'IPP \"" + nom + "\" sera supprimé. Irréversible !");
    if (!ok) return;
    await db.ref("utilisateurs/" + id + "/statut").set("supprime");
    await db.ref("utilisateurs/" + id + "/supprimeLe").set(firebase.database.ServerValue.TIMESTAMP);
    toast("IPP \"" + nom + "\" supprimé", "success");
  }
  
  // ==================== EXPORT PDF PRINCIPAL IGE ====================
  // MODIFICATION 3 : nouveau header officiel + footer avec numéro de série
  function buildPdfFilename() {
    var nomEntite = (currentProfile && currentProfile.nomEntite) ? currentProfile.nomEntite : "IGE";
    var slug = String(nomEntite)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase();
    var d = new Date();
    var pad = function(n){ return n < 10 ? "0" + n : "" + n; };
    var date = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    return "RAPPORT_STATISTIQUE_" + slug + "_" + date;
  }

  function exportToPdf() {
    if (!window.html2pdf) {
      toast("Bibliothèque PDF indisponible (html2pdf manquant)", "error");
      return;
    }

    toast("Préparation du rapport PDF...", "info");

    var stats = calculateStats();
    var nomEntite = (currentProfile && currentProfile.nomEntite) || "Inspection Générale";
    var responsable = (currentProfile && currentProfile.responsable) || "Inspection Générale";
    var d = new Date();
    var dateRapport = d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
    var annee1 = d.getFullYear();
    var annee2 = annee1 + 1;
    var serial = generateSerialNumber();

    var wrapper = document.createElement("div");
    wrapper.style.cssText = "font-family:'Inter',Arial,sans-serif;padding:20px;color:#111827;background:white;width:1123px";

    var thStyle = 'border:1px solid #e5e7eb;padding:6px 8px;background:#f3f4f6;text-align:left;';
    var tdStyle = 'border:1px solid #e5e7eb;padding:6px 8px;text-align:left;';
    var sectionStyle = 'font-size:14px;font-weight:bold;background:#eff6ff;padding:6px 10px;border-left:4px solid #2563eb;margin:20px 0 10px;';

    // En-tête officiel
    var html = '';
    html += '<div style="display:flex;align-items:center;border-bottom:2px solid #1e3a8a;padding-bottom:12px;margin-bottom:16px;">';
    html += '  <img src="../img/logo min backless.png" alt="Ministère RDC" style="width:80px;height:80px;object-fit:contain;margin-right:20px;" />';
    html += '  <div style="flex:1;text-align:center;">';
    html += '    <div style="font-size:11px;font-weight:600;color:#374151;letter-spacing:0.5px;">REPUBLIQUE DEMOCRATIQUE DU CONGO</div>';
    html += '    <div style="font-size:10px;color:#374151;margin-top:2px;">MINISTERE DE L\'EDUCATION NATIONALE ET NOUVELLE CITOYENNETE</div>';
    html += '    <div style="font-size:13px;font-weight:bold;color:#1e3a8a;margin-top:6px;">' + escape(nomEntite).toUpperCase() + '</div>';
    html += '    <div style="font-size:11px;font-weight:600;color:#1e3a8a;margin-top:4px;">RAPPORT STATISTIQUE DES BULLETINS SCOLAIRES ' + annee1 + '-' + annee2 + '</div>';
    html += '  </div>';
    html += '</div>';

    html += '<div style="' + sectionStyle + '">1. CYCLE MATERNELLE</div>';
    html += buildPdfTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildMaternelleRows(stats), thStyle, tdStyle);

    html += '<div style="' + sectionStyle + '">2. CYCLE PRIMAIRE</div>';
    html += buildPdfTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildPrimaireRows(stats), thStyle, tdStyle);

    html += '<div style="' + sectionStyle + '">3. CTEB (7ème & 8ème)</div>';
    html += buildPdfTable(['Classe','Filles','Garçons','<strong>Total</strong>'], buildCtebRows(stats), thStyle, tdStyle);

    html += '<div style="' + sectionStyle + '">4. CYCLE LONG</div>';
    html += buildPdfTable(['Niveau','Option','Code','Filles','Garçons','<strong>Total</strong>'], buildCycleLongRows(stats), thStyle, tdStyle);

    html += '<div style="' + sectionStyle + '">5. CYCLE COURT</div>';
    html += buildPdfTable(['Niveau','Option','Code','Filles','Garçons','<strong>Total</strong>'], buildCycleCourtRows(stats), thStyle, tdStyle);

    // Pied de page officiel
    html += '<div style="margin-top:30px;padding-top:15px;border-top:2px solid #1e3a8a;display:flex;justify-content:space-between;align-items:flex-end;">';
    html += '  <div style="width:280px;text-align:center;">';
    html += '    <div style="font-size:11px;">Fait à Kinshasa, le ' + dateRapport + '</div>';
    html += '    <div style="margin-top:50px;border-top:1px solid #000;width:100%;"></div>';
    html += '    <div style="margin-top:6px;font-size:11px;">Le Responsable</div>';
    html += '    <div style="font-size:11px;"><strong>' + escape(responsable) + '</strong></div>';
    html += '  </div>';
    html += '  <div style="width:120px;height:80px;border:1px dashed #9ca3af;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:9px;">Sceau / Cachet</div>';
    html += '  <div style="text-align:right;font-size:9px;color:#6b7280;"><div>' + serial + '</div></div>';
    html += '</div>';

    wrapper.innerHTML = html;

    var filename = buildPdfFilename() + ".pdf";

    var opt = {
      margin:       [10, 10, 10, 10],
      filename:     filename,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true, logging: false },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'landscape' },
      pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
    };

    var host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;z-index:-9999;";
    wrapper.style.position = "relative";
    wrapper.style.left = "0";
    wrapper.style.top = "0";
    host.appendChild(wrapper);
    document.body.appendChild(host);

    setTimeout(function() {
      window.html2pdf().set(opt).from(wrapper).save().then(function() {
        if (host.parentNode) document.body.removeChild(host);
        toast("Rapport PDF généré : " + filename, "success");
      }).catch(function(err) {
        if (host.parentNode) document.body.removeChild(host);
        console.error(err);
        toast("Erreur lors de la génération du PDF", "error");
      });
    }, 100);
  }

  function buildPdfTable(headers, rows, thStyle, tdStyle) {
    var html = '<table style="width:100%;border-collapse:collapse;margin-bottom:15px;font-size:11px;">';
    html += '<thead><tr>';
    for (var h = 0; h < headers.length; h++) html += '<th style="' + thStyle + '">' + headers[h] + '</th>';
    html += '</tr></thead><tbody>';
    for (var r = 0; r < rows.length; r++) {
      html += '<tr>';
      for (var c = 0; c < rows[r].length; c++) html += '<td style="' + tdStyle + '">' + rows[r][c] + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }
  
  function generatePassword(len) {
    len = len || 10;
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    var out = "";
    var arr = new Uint32Array(len);
    crypto.getRandomValues(arr);
    for (var i = 0; i < len; i++) out += chars[arr[i] % chars.length];
    return out;
  }
  
  function confirmDialog(title, message) {
    return new Promise(function(resolve) {
      var modal = document.getElementById("modal-confirm");
      var confirmTitle = document.getElementById("confirm-title");
      var confirmMessage = document.getElementById("confirm-message");
      var okBtn = document.getElementById("confirm-ok");
      
      if (confirmTitle) confirmTitle.innerHTML = '<i class="fas fa-circle-question"></i> ' + escape(title);
      if (confirmMessage) confirmMessage.textContent = message;
      
      var onOk = function() { cleanup(); resolve(true); };
      var onCancel = function() { cleanup(); resolve(false); };
      
      function cleanup() {
        modal.classList.remove("show");
        if (okBtn) okBtn.removeEventListener("click", onOk);
        var closeButtons = modal.querySelectorAll("[data-close-modal]");
        for (var i = 0; i < closeButtons.length; i++) {
          closeButtons[i].removeEventListener("click", onCancel);
        }
      }
      
      if (okBtn) okBtn.addEventListener("click", onOk);
      var closeButtons = modal.querySelectorAll("[data-close-modal]");
      for (var i = 0; i < closeButtons.length; i++) {
        closeButtons[i].addEventListener("click", onCancel);
      }
      modal.classList.add("show");
    });
  }
  
  function escape(s) { 
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); 
  }
  
  function toast(msg, type) {
    var toastEl = document.getElementById("toast");
    var toastMsg = document.getElementById("toast-msg");
    if (!toastEl) return;
    if (toastMsg) toastMsg.textContent = msg;
    toastEl.className = "toast " + (type || "info");
    toastEl.classList.remove("hidden");
    setTimeout(function() { toastEl.classList.add("hidden"); }, 3000);
  }
})();
