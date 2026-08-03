const MATERIAUX = {
  "Ciment": { unites: ["Sac (50kg)", "kg", "Tonne"], etapes: ["Livraison", "Utilisation"] },
  "Sable": { unites: ["m³", "Voyage (5m³)"], etapes: ["Livraison"] },
  "Concassé": { unites: ["m³"], etapes: ["Livraison"] },
  "Concassé 5/15": { unites: ["m³", "Tonne"], etapes: ["Livraison"] },
  "Concassé 15/25": { unites: ["m³", "Tonne"], etapes: ["Livraison"] },
};
const ETAPE_LABEL = { Livraison: "Reçu", Utilisation: "Utilisé" };
const TYPE_DOCUMENT_LABEL = {
  PVReceptionSite: "PV de réception — site",
  PVReceptionUsine: "PV de réception — usine",
  BordereauLivraisonPoteaux: "Bordereau de livraison — poteaux",
  BordereauLivraisonCiment: "Bordereau de livraison — ciment",
  BordereauLivraisonConcasse: "Bordereau de livraison — concassé",
};
// Les clés doivent correspondre EXACTEMENT aux catégories du logiciel de
// bureau (table travaux, colonne categorie) pour que la synchronisation
// incrémente les bonnes lignes.
const CATEGORIE_LABEL = {
  Implantation: "Poteaux implantés",
  FouillesImplantation: "Fouilles pour implantation réalisées",
  FouillesMALTTerre: "Fouilles mise à la terre — Terre réalisées",
  FouillesMALTMasse: "Fouilles mise à la terre — Masse réalisées",
  PointesDiamant: "Pointes de diamant réalisées",
  Plateforme: "Plateformes de manœuvre réalisées",
};

let utilisateurCourant = null;

async function api(path, options = {}) {
  const res = await fetch("/api" + path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erreur || "Erreur inconnue.");
  return data;
}

// Variante pour l'envoi de fichiers : pas de Content-Type manuel (le
// navigateur ajoute lui-même la limite "boundary" du multipart).
async function apiEnvoyerFichier(path, formData) {
  const res = await fetch("/api" + path, { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erreur || "Erreur inconnue.");
  return data;
}

function auj() {
  return new Date().toISOString().slice(0, 10);
}

function afficherMessage(id, texte, ok) {
  const el = document.getElementById(id);
  el.textContent = texte;
  el.className = "msg " + (ok ? "ok" : "err");
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 5000);
}

// ---------------- Connexion ----------------
async function verifierSession() {
  const data = await api("/me");
  if (data.connecte) {
    utilisateurCourant = data.utilisateur;
    afficherApp();
  } else {
    afficherLogin();
  }
}

function afficherLogin() {
  document.getElementById("app").innerHTML = `
    <div class="login-wrap">
      <div class="card login-card">
        <h2>LRA Suite — Portail terrain</h2>
        <label>Identifiant<input id="in-identifiant" autocomplete="username" /></label>
        <label>Mot de passe<input id="in-mdp" type="password" autocomplete="current-password" /></label>
        <button class="btn" id="btn-login">Se connecter</button>
        <div id="msg-login" class="msg hidden"></div>
      </div>
    </div>
  `;
  document.getElementById("btn-login").addEventListener("click", async () => {
    try {
      const data = await api("/login", { method: "POST", body: {
        identifiant: document.getElementById("in-identifiant").value.trim(),
        motDePasse: document.getElementById("in-mdp").value,
      }});
      utilisateurCourant = data.utilisateur;
      afficherApp();
    } catch (err) {
      afficherMessage("msg-login", err.message, false);
    }
  });
  document.getElementById("in-mdp").addEventListener("keyup", (e) => { if (e.key === "Enter") document.getElementById("btn-login").click(); });
}

async function deconnecter() {
  await api("/logout", { method: "POST" });
  utilisateurCourant = null;
  afficherLogin();
}

// ---------------- App ----------------
function afficherApp() {
  document.getElementById("app").innerHTML = `
    <header>
      <div>
        <h1>LRA Suite — Portail terrain</h1>
        <div class="sub">${utilisateurCourant.nom}${utilisateurCourant.departements && utilisateurCourant.departements.length ? " · " + utilisateurCourant.departements.join(", ") : " · Administrateur"}</div>
      </div>
      <button id="btn-logout">Déconnexion</button>
    </header>
    <main id="main"></main>
  `;
  document.getElementById("btn-logout").addEventListener("click", deconnecter);
  if (utilisateurCourant.role === "admin") afficherAdmin();
  else afficherSaisie();
}

// ---------------- Vue collaborateur : saisie quotidienne ----------------
function afficherSaisie() {
  const main = document.getElementById("main");
  const plusieursDepartements = utilisateurCourant.departements.length > 1;
  const optionsDepartements = utilisateurCourant.departements.map((d) => `<option value="${d}">${d}</option>`).join("");
  main.innerHTML = `
    ${plusieursDepartements ? `
      <div class="card">
        <label>Département concerné par cette saisie
          <select id="saisie-departement">${optionsDepartements}</select>
        </label>
      </div>
    ` : ""}

    <div class="card">
      <h2>Travaux réalisés aujourd'hui</h2>
      <label>Catégorie
        <select id="tr-categorie">
          ${Object.entries(CATEGORIE_LABEL).map(([v, label]) => `<option value="${v}">${label}</option>`).join("")}
        </select>
      </label>
      <label>Localité<input id="tr-localite" placeholder="ex: BORIYOURE" /></label>
      <label>Type de poteau (optionnel)<input id="tr-type" placeholder="ex: 9A650" /></label>
      <label>Quantité réalisée aujourd'hui<input id="tr-quantite" type="number" min="1" step="1" /></label>
      <label>Date<input id="tr-date" type="date" /></label>
      <button class="btn" id="btn-tr-save">Enregistrer</button>
      <div id="msg-tr" class="msg hidden"></div>
    </div>

    <div class="card">
      <h2>Matériaux${plusieursDepartements ? "" : " — " + utilisateurCourant.departements[0]}</h2>
      <label>Matériau
        <select id="mat-materiau">
          ${Object.keys(MATERIAUX).map((m) => `<option value="${m}">${m}</option>`).join("")}
        </select>
      </label>
      <label id="lbl-mat-etape">Mouvement
        <select id="mat-etape"></select>
      </label>
      <label>Quantité<input id="mat-quantite" type="number" min="0.01" step="0.01" /></label>
      <label>Unité<select id="mat-unite"></select></label>
      <label>Date<input id="mat-date" type="date" /></label>
      <button class="btn" id="btn-mat-save">Enregistrer</button>
      <div id="msg-mat" class="msg hidden"></div>
    </div>

    <div class="card">
      <h2>Envoyer un document (PV, bordereau…)</h2>
      <p class="hint" style="margin-top:0;">Prenez le document en photo ou scannez-le, puis envoyez-le ici — il sera disponible dans le logiciel de bureau après la prochaine synchronisation.</p>
      <label>Type de document
        <select id="doc-type">
          ${Object.entries(TYPE_DOCUMENT_LABEL).map(([v, label]) => `<option value="${v}">${label}</option>`).join("")}
        </select>
      </label>
      <label>Fichier (photo ou PDF)<input id="doc-fichier" type="file" accept="application/pdf,image/*" capture="environment" /></label>
      <label>Date<input id="doc-date" type="date" /></label>
      <button class="btn" id="btn-doc-save">Envoyer</button>
      <div id="msg-doc" class="msg hidden"></div>
    </div>

    <div class="card">
      <h2>Mes dernières saisies (30 derniers jours)</h2>
      <ul class="liste-saisies" id="liste-saisies"><li>Chargement…</li></ul>
    </div>
  `;

  document.getElementById("tr-date").value = auj();
  document.getElementById("mat-date").value = auj();
  document.getElementById("doc-date").value = auj();

  function majOptionsMateriau() {
    const m = document.getElementById("mat-materiau").value;
    const cfg = MATERIAUX[m];
    const etapeSelect = document.getElementById("mat-etape");
    etapeSelect.innerHTML = cfg.etapes.map((e) => `<option value="${e}">${ETAPE_LABEL[e]}</option>`).join("");
    document.getElementById("lbl-mat-etape").style.display = cfg.etapes.length > 1 ? "" : "none";
    document.getElementById("mat-unite").innerHTML = cfg.unites.map((u) => `<option value="${u}">${u}</option>`).join("");
  }
  document.getElementById("mat-materiau").addEventListener("change", majOptionsMateriau);
  majOptionsMateriau();

  function departementSaisieActuel() {
    const select = document.getElementById("saisie-departement");
    return select ? select.value : utilisateurCourant.departements[0];
  }

  document.getElementById("btn-tr-save").addEventListener("click", async () => {
    try {
      await api("/saisie/travaux", { method: "POST", body: {
        departement: departementSaisieActuel(),
        categorie: document.getElementById("tr-categorie").value,
        localite: document.getElementById("tr-localite").value,
        type_poteau: document.getElementById("tr-type").value,
        quantite: document.getElementById("tr-quantite").value,
        date_saisie: document.getElementById("tr-date").value,
      }});
      afficherMessage("msg-tr", "Enregistré.", true);
      document.getElementById("tr-localite").value = "";
      document.getElementById("tr-type").value = "";
      document.getElementById("tr-quantite").value = "";
      chargerMesSaisies();
    } catch (err) {
      afficherMessage("msg-tr", err.message, false);
    }
  });

  document.getElementById("btn-mat-save").addEventListener("click", async () => {
    try {
      await api("/saisie/materiaux", { method: "POST", body: {
        departement: departementSaisieActuel(),
        materiau: document.getElementById("mat-materiau").value,
        etape: document.getElementById("mat-etape").value,
        quantite: document.getElementById("mat-quantite").value,
        unite: document.getElementById("mat-unite").value,
        date_saisie: document.getElementById("mat-date").value,
      }});
      afficherMessage("msg-mat", "Enregistré.", true);
      document.getElementById("mat-quantite").value = "";
      chargerMesSaisies();
    } catch (err) {
      afficherMessage("msg-mat", err.message, false);
    }
  });

  document.getElementById("btn-doc-save").addEventListener("click", async () => {
    try {
      const fichier = document.getElementById("doc-fichier").files[0];
      if (!fichier) { afficherMessage("msg-doc", "Merci de choisir un fichier.", false); return; }
      const formData = new FormData();
      formData.append("departement", departementSaisieActuel());
      formData.append("type", document.getElementById("doc-type").value);
      formData.append("date_saisie", document.getElementById("doc-date").value);
      formData.append("fichier", fichier);
      await apiEnvoyerFichier("/saisie/documents", formData);
      afficherMessage("msg-doc", "Document envoyé.", true);
      document.getElementById("doc-fichier").value = "";
      chargerMesSaisies();
    } catch (err) {
      afficherMessage("msg-doc", err.message, false);
    }
  });

  chargerMesSaisies();
}

async function chargerMesSaisies() {
  const data = await api("/saisie/mes-saisies");
  const plusieursDepartements = utilisateurCourant.departements.length > 1;
  const prefixeDep = (dep) => (plusieursDepartements ? `[${dep}] ` : "");
  const lignes = [
    ...data.travaux.map((r) => ({
      date: r.date_saisie.slice(0, 10),
      texte: `${prefixeDep(r.departement)}${CATEGORIE_LABEL[r.categorie]} — ${r.localite}${r.type_poteau ? " (" + r.type_poteau + ")" : ""} : ${r.quantite}`,
      ts: r.date_creation,
    })),
    ...data.materiaux.map((r) => ({
      date: r.date_saisie.slice(0, 10),
      texte: `${prefixeDep(r.departement)}${r.materiau} ${ETAPE_LABEL[r.etape].toLowerCase()} : ${r.quantite} ${r.unite}`,
      ts: r.date_creation,
    })),
    ...data.documents.map((r) => ({
      date: r.date_saisie.slice(0, 10),
      texte: `${prefixeDep(r.departement)}${TYPE_DOCUMENT_LABEL[r.type]} — ${r.nom_fichier}`,
      ts: r.date_creation,
    })),
  ].sort((a, b) => new Date(b.ts) - new Date(a.ts));

  const ul = document.getElementById("liste-saisies");
  ul.innerHTML = lignes.map((l) => `<li><b>${l.date}</b> — ${l.texte}</li>`).join("") || "<li>Aucune saisie pour l'instant.</li>";
}

// ---------------- Vue admin : gestion des accès ----------------
const DEPARTEMENTS_CONNUS = ["ATACORA", "BORGOU", "DONGA", "ALIBORI"];
let editingUserId = null;

function casesDepartements(departementsCoches = []) {
  return DEPARTEMENTS_CONNUS.map((d) => `
    <label class="case-departement">
      <input type="checkbox" value="${d}" ${departementsCoches.includes(d) ? "checked" : ""} /> ${d}
    </label>
  `).join("");
}

function departementsCoches() {
  return [...document.querySelectorAll("#cases-departements input:checked")].map((c) => c.value);
}

async function afficherAdmin() {
  const main = document.getElementById("main");
  main.innerHTML = `
    <div class="card">
      <b id="ad-form-title">Ajouter un collaborateur</b>
      <div id="ad-champs-nouveau">
        <label>Nom complet<input id="ad-nom" /></label>
        <label>Identifiant de connexion<input id="ad-identifiant" placeholder="ex: jean.atacora" /></label>
        <label>Mot de passe initial<input id="ad-mdp" type="text" placeholder="au moins 6 caractères" /></label>
      </div>
      <label>Département(s) — un collaborateur peut en gérer plusieurs
        <div id="cases-departements">${casesDepartements()}</div>
      </label>
      <div class="form-actions">
        <button class="btn" id="btn-ad-save">Créer le compte</button>
        <button class="btn secondary" id="btn-ad-cancel" style="display:none;">Annuler</button>
      </div>
      <div id="msg-ad" class="msg hidden"></div>
    </div>

    <div class="card">
      <h2>Comptes existants</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Nom</th><th>Identifiant</th><th>Département(s)</th><th>Statut</th><th></th></tr></thead>
          <tbody id="tbody-users"></tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("btn-ad-cancel").addEventListener("click", () => afficherAdmin());

  document.getElementById("btn-ad-save").addEventListener("click", async () => {
    try {
      const deps = departementsCoches();
      if (editingUserId) {
        await api(`/admin/users/${editingUserId}/departements`, { method: "PATCH", body: { departements: deps } });
        afficherMessage("msg-ad", "Départements mis à jour.", true);
      } else {
        await api("/admin/users", { method: "POST", body: {
          nom: document.getElementById("ad-nom").value,
          identifiant: document.getElementById("ad-identifiant").value,
          motDePasse: document.getElementById("ad-mdp").value,
          departements: deps,
        }});
        afficherMessage("msg-ad", "Compte créé.", true);
      }
      editingUserId = null;
      afficherAdmin();
    } catch (err) {
      afficherMessage("msg-ad", err.message, false);
    }
  });

  await chargerUsers();
}

function modifierDepartements(id, nom, departementsActuels) {
  editingUserId = id;
  document.getElementById("ad-form-title").textContent = `Départements de ${nom}`;
  document.getElementById("ad-champs-nouveau").style.display = "none";
  document.getElementById("cases-departements").innerHTML = casesDepartements(departementsActuels);
  document.getElementById("btn-ad-save").textContent = "Enregistrer les départements";
  document.getElementById("btn-ad-cancel").style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function chargerUsers() {
  const { users } = await api("/admin/users");
  document.getElementById("tbody-users").innerHTML = users.map((u) => `
    <tr>
      <td>${u.nom}</td>
      <td>${u.identifiant}</td>
      <td>${u.departements && u.departements.length ? u.departements.join(", ") : (u.role === "admin" ? "— (admin)" : "")}</td>
      <td><span class="badge ${u.actif ? "actif" : "inactif"}">${u.actif ? "Autorisé" : "Retiré"}</span></td>
      <td>
        ${u.role === "admin" ? "" : `
          <button class="btn small secondary" data-modifier-dep="${u.id}">Départements</button>
          <button class="btn small ${u.actif ? "danger" : ""}" data-toggle="${u.id}" data-actif="${u.actif}">${u.actif ? "Retirer l'accès" : "Autoriser"}</button>
        `}
      </td>
    </tr>
  `).join("") || `<tr><td colspan="5">Aucun compte pour l'instant.</td></tr>`;

  document.querySelectorAll("[data-toggle]").forEach((btn) => btn.addEventListener("click", async () => {
    const id = Number(btn.dataset.toggle);
    const actifActuel = btn.dataset.actif === "true";
    await api(`/admin/users/${id}/actif`, { method: "PATCH", body: { actif: !actifActuel } });
    chargerUsers();
  }));

  document.querySelectorAll("[data-modifier-dep]").forEach((btn) => btn.addEventListener("click", () => {
    const id = Number(btn.dataset.modifierDep);
    const u = users.find((x) => x.id === id);
    if (u) modifierDepartements(id, u.nom, u.departements || []);
  }));
}

verifierSession();
