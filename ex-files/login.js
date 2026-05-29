/* ============================================================
   EKOLSTAT — Page de connexion (CORRIGÉ)
   ============================================================ */
(function () {
  const form     = document.getElementById("login-form");
  const emailIn  = document.getElementById("email");
  const passIn   = document.getElementById("password");
  const remember = document.getElementById("remember");
  const btn      = document.getElementById("login-btn");
  const btnLabel = btn.querySelector(".btn-label");
  const btnLoad  = btn.querySelector(".btn-loader");
  const message  = document.getElementById("auth-message");
  const toggle   = document.getElementById("toggle-pass");
  const forgot   = document.getElementById("forgot-link");

  const auth = window.EKOLSTAT.auth;
  const db   = window.EKOLSTAT.db;


  // ==================== SPLASH SCREEN ====================
(function initSplashScreen() {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;
  
  // Forcer l'affichage du splash pendant 2 secondes minimum
  const minDisplayTime = 2000; // 2 secondes
  const startTime = Date.now();
  
  // Fonction pour masquer le splash
  function hideSplash() {
    const elapsed = Date.now() - startTime;
    const remaining = minDisplayTime - elapsed;
    
    if (remaining > 0) {
      setTimeout(() => {
        splash.classList.add('hide');
        // Supprimer complètement du DOM après l'animation
        setTimeout(() => {
          if (splash.parentNode) splash.parentNode.removeChild(splash);
        }, 500);
      }, remaining);
    } else {
      splash.classList.add('hide');
      setTimeout(() => {
        if (splash.parentNode) splash.parentNode.removeChild(splash);
      }, 500);
    }
  }
  
  // Masquer le splash après le chargement complet de la page
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideSplash);
  } else {
    hideSplash();
  }
  
  // Fallback : au cas où, masquer après 3 secondes maximum
  setTimeout(hideSplash, 3000);
})();

  // Variable pour éviter les redirections multiples
  let redirecting = false;

  // Rediriger automatiquement si déjà connecté
  auth.onAuthStateChanged(async function (user) {
    if (!user || redirecting) return;
    
    try {
      redirecting = true;
      console.log("[Login] Utilisateur déjà connecté, vérification du profil...");
      const snap = await db.ref("utilisateurs/" + user.uid).get();
      const data = snap.exists() ? snap.val() : null;
      
      if (data && data.role) {
        const targetUrl = window.EKOLSTAT.routeByRole(data.role);
        console.log("[Login] Redirection vers:", targetUrl);
        window.location.href = targetUrl;
      } else {
        console.warn("[Login] Aucun rôle trouvé, déconnexion");
        await auth.signOut();
        redirecting = false;
      }
    } catch (e) {
      console.error("[Login] Erreur lors de la vérification:", e);
      redirecting = false;
    }
  });

  // Afficher / masquer le mot de passe
  toggle.addEventListener("click", function () {
    const isPwd = passIn.type === "password";
    passIn.type = isPwd ? "text" : "password";
    toggle.querySelector("i").className = isPwd ? "fas fa-eye-slash" : "fas fa-eye";
  });

  // Soumission du formulaire
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    
    if (redirecting) {
      console.log("[Login] Redirection déjà en cours, ignore");
      return;
    }
    
    const email = emailIn.value.trim();
    const pass  = passIn.value;
    if (!email || !pass) return;

    setLoading(true);
    showMessage("", "");

    try {
      // Persistance selon "Se souvenir"
      const persistence = remember.checked
        ? firebase.auth.Auth.Persistence.LOCAL
        : firebase.auth.Auth.Persistence.SESSION;
      await auth.setPersistence(persistence);

      console.log("[Login] Tentative de connexion pour:", email);
      const cred = await auth.signInWithEmailAndPassword(email, pass);
      const uid  = cred.user.uid;

      // Récupérer le rôle dans la base avec un timeout
      console.log("[Login] Récupération du profil pour UID:", uid);
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Timeout chargement profil")), 10000)
      );
      
      const snap = await Promise.race([
        db.ref("utilisateurs/" + uid).get(),
        timeoutPromise
      ]);
      
      if (!snap.exists()) {
        console.error("[Login] Profil introuvable pour UID:", uid);
        await auth.signOut();
        showMessage("Aucun profil EKOLSTAT lié à ce compte. Contactez votre administrateur.", "error");
        setLoading(false);
        redirecting = false;
        return;
      }
      
      const profile = snap.val();
      console.log("[Login] Profil trouvé, rôle:", profile.role);
      
      showMessage("Connexion réussie. Redirection...", "success");
      redirecting = true;

      // Redirection après un court délai pour afficher le message
      setTimeout(function () {
        const targetUrl = window.EKOLSTAT.routeByRole(profile.role);
        console.log("[Login] Redirection vers:", targetUrl);
        window.location.href = targetUrl;
      }, 800);
      
    } catch (err) {
      console.error("[Login] Erreur de connexion:", err);
      showMessage(window.EKOLSTAT.translateAuthError(err), "error");
      setLoading(false);
      redirecting = false;
    }
  });

  // Mot de passe oublié
  forgot.addEventListener("click", async function (e) {
    e.preventDefault();
    const email = emailIn.value.trim();
    if (!email) {
      showMessage("Saisissez votre adresse e-mail puis cliquez à nouveau sur 'Mot de passe oublié'.", "info");
      emailIn.focus();
      return;
    }
    try {
      await auth.sendPasswordResetEmail(email);
      showMessage("Un e-mail de réinitialisation vient d'être envoyé à " + email + ".", "success");
    } catch (err) {
      showMessage(window.EKOLSTAT.translateAuthError(err), "error");
    }
  });

  function setLoading(on) {
    btn.disabled = on;
    btnLabel.classList.toggle("hidden", on);
    btnLoad.classList.toggle("hidden", !on);
  }

  function showMessage(text, type) {
    if (!text) {
      message.classList.add("hidden");
      message.textContent = "";
      message.className = "auth-message hidden";
      return;
    }
    message.className = "auth-message " + (type || "info");
    const icon = type === "error"   ? "fa-circle-exclamation"
              : type === "success" ? "fa-circle-check"
              : "fa-circle-info";
    message.innerHTML = '<i class="fas ' + icon + '"></i><span>' + text + '</span>';
    message.classList.remove("hidden");
  }
})();
