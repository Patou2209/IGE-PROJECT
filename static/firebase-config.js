/* ============================================================
   EKOLSTAT — Configuration Firebase
   ============================================================
   IMPORTANT : remplacez les valeurs par celles de votre projet
   Firebase. Les clés ci-dessous sont des valeurs par défaut
   destinées à être surchargées via la console Firebase.
   ============================================================ */

   window.EKOLSTAT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyAqcoW8gmua4ttyaesCd6E15enapVXlvWc",
    databaseURL: "https://ekolstat-default-rtdb.europe-west1.firebasedatabase.app/",
    authDomain: "ekolstat.firebaseapp.com",
    projectId: "ekolstat",
    storageBucket: "ekolstat.firebasestorage.app",
    messagingSenderId: "660352315364",
    appId: "1:660352315364:web:c9110af7df01e8db13a1f1"
};

(function initFirebase() {
  if (!window.firebase) {
    console.error("[EKOLSTAT] Firebase SDK introuvable.");
    return;
  }
  if (!firebase.apps || !firebase.apps.length) {
    firebase.initializeApp(window.EKOLSTAT_FIREBASE_CONFIG);
  }
  window.EKOLSTAT = window.EKOLSTAT || {};
  window.EKOLSTAT.auth = firebase.auth();
  window.EKOLSTAT.db   = firebase.database();
})();

/* Helpers communs --------------------------------------------------------- */
window.EKOLSTAT = window.EKOLSTAT || {};

window.EKOLSTAT.formatNumber = function (n) {
  if (n === null || n === undefined || isNaN(n)) return "0";
  return Number(n).toLocaleString("fr-FR");
};

window.EKOLSTAT.percent = function (num, den, digits) {
  if (!den || den === 0) return "0%";
  const v = (num / den) * 100;
  return v.toFixed(digits === undefined ? 1 : digits).replace(".", ",") + "%";
};

window.EKOLSTAT.toast = function (message, type) {
  const t = document.getElementById("toast");
  const m = document.getElementById("toast-msg");
  if (!t || !m) return;
  m.textContent = message;
  t.className = "toast " + (type || "info");
  setTimeout(() => { t.classList.add("hidden"); }, 4200);
};

window.EKOLSTAT.translateAuthError = function (err) {
  const code = err && err.code ? err.code : "";
  switch (code) {
    case "auth/invalid-email":         return "Adresse e-mail invalide.";
    case "auth/user-disabled":         return "Ce compte a été désactivé.";
    case "auth/user-not-found":        return "Aucun compte avec cet e-mail.";
    case "auth/wrong-password":        return "Mot de passe incorrect.";
    case "auth/invalid-credential":    return "Identifiants invalides.";
    case "auth/too-many-requests":     return "Trop de tentatives. Réessayez plus tard.";
    case "auth/network-request-failed":return "Connexion réseau impossible.";
    case "auth/email-already-in-use":  return "Cette adresse e-mail est déjà utilisée.";
    case "auth/weak-password":         return "Le mot de passe doit contenir au moins 6 caractères.";
    default: return (err && err.message) ? err.message : "Une erreur est survenue.";
  }
};

window.EKOLSTAT.routeByRole = function (role) {
  switch ((role || "").toLowerCase()) {
    case "ige":          return "dashboard/ige.html";
    case "ipp":          return "dashboard/ipp.html";
    case "sousdivision":
    case "sous-division":return "dashboard/sous-division.html";
    case "ecole":
    case "école":        return "dashboard/ecole.html";
    case "classe":       return "dashboard/classe.html";
    default:             return "index.html";
  }
};
