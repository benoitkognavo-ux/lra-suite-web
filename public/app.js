// localiteRequise : le ciment est géré au niveau du département (pas besoin
// de préciser la localité) — le sable et les concassés, eux, sont livrés
// directement à chaque localité, donc la localité est demandée pour eux.
const MATERIAUX = {
  "Ciment": { unites: ["Sac (50kg)", "kg", "Tonne"], etapes: ["Livraison", "Utilisation"], localiteRequise: false },
  "Sable": { unites: ["m³", "Voyage (5m³)"], etapes: ["Livraison"], localiteRequise: true },
  "Concassé": { unites: ["m³"], etapes: ["Livraison"], localiteRequise: true },
  "Concassé 5/15": { unites: ["m³", "Tonne"], etapes: ["Livraison"], localiteRequise: true },
  "Concassé 15/25": { unites: ["m³", "Tonne"], etapes: ["Livraison"], localiteRequise: true },
};
const ETAPE_LABEL = { Livraison: "Reçu", Utilisation: "Utilisé" };
const TYPE_MOUVEMENT_EQUIPEMENT_LABEL = { Arrivee: "Arrivée", Transfert: "Transfert" };
const TYPE_DOCUMENT_LABEL = {
  PVReceptionSite: "PV de réception — site",
  PVReceptionUsine: "PV de réception — usine",
  BordereauLivraisonPoteaux: "Bordereau de livraison — poteaux",
  BordereauLivraisonCiment: "Bordereau de livraison — ciment",
  BordereauLivraisonConcasse: "Bordereau de livraison — concassé",
};
// Les clés doivent correspondre EXACTEMENT aux catégories du logiciel de
// bureau (table travaux, colonne categorie) pour que la synchronisation
// incrémente les bonnes lignes. Regroupées par domaine (comme dans le
// logiciel de bureau, voir renderer/modules/electricite.js et cables.js)
// pour que le menu déroulant reste lisible malgré le nombre de catégories.
const GROUPES_CATEGORIES = [
  {
    groupe: "Implantation & fouilles",
    categories: {
      Implantation: "Poteaux implantés",
      FouillesImplantation: "Fouilles pour implantation réalisées",
      FouillesMALTTerre: "Fouilles mise à la terre — Terre réalisées",
      FouillesMALTMasse: "Fouilles mise à la terre — Masse réalisées",
      PointesDiamant: "Pointes de diamant réalisées",
      Plateforme: "Plateformes de manœuvre réalisées",
    },
  },
  {
    groupe: "Électricité",
    categories: {
      IACM: "IACM",
      DMT_CC: "DMT-CC",
      Transformateur: "Transformateur",
      MiseTerreNeutreBT: "Mise à la terre — Neutre BT",
      MiseTerreMassesMetalliques: "Mise à la terre — Masses métalliques",
    },
  },
  {
    groupe: "Câbles",
    categories: {
      CableBTRehab50: "Ligne BT à réhabiliter en 50mm²",
      CableBTRenforce70: "Ligne BT à renforcer en 70mm²",
      LigneHTA75Aerienne: "Ligne HTA 75mm² aérienne à construire",
      LigneHTA546Aerienne: "Ligne HTA 54,6mm² aérienne à construire",
      LigneBT3x70: "Ligne BT 3×70mm² + 54,6mm² + 2×16mm² à construire",
      LigneBT3x50: "Ligne BT 3×50mm² + 54,6mm² + 2×16mm² à construire",
      LigneMixteHTA755BT3x70: "Ligne mixte HTA 75,5mm² + BT 3×70mm² + 54,6mm² + 2×16mm² à construire",
      LigneMixteHTA546BT3x70: "Ligne mixte HTA 54,6mm² + BT 3×70mm² + 54,6mm² + 2×16mm² à construire",
      LigneMixteHTA546BT3x50: "Ligne mixte HTA 54,6mm² + BT 3×50mm² + 54,6mm² + 2×16mm² à construire",
    },
  },
];
// Table à plat (toutes catégories confondues) pour un accès direct par clé,
// utilisée dans l'historique des saisies (chargerMesSaisies) et ailleurs.
const CATEGORIE_LABEL = Object.assign({}, ...GROUPES_CATEGORIES.map((g) => g.categories));

let utilisateurCourant = null;
let localitesParDepartement = {};
let departementsConnus = [];

// Récupère le référentiel des localités et des départements (poussé par le
// logiciel de bureau à chaque synchronisation) et regroupe les localités par
// département — permet de proposer des listes déroulantes plutôt qu'une
// saisie libre. departementsConnus contient TOUS les départements du projet,
// même ceux sans aucune localité encore enregistrée (utile pour la
// destination d'un transfert d'équipement).
async function chargerLocalites() {
  try {
    const data = await api("/saisie/localites");
    localitesParDepartement = {};
    for (const l of data.localites) {
      if (!localitesParDepartement[l.departement]) localitesParDepartement[l.departement] = [];
      localitesParDepartement[l.departement].push(l.localite);
    }
    departementsConnus = data.departements && data.departements.length ? data.departements : Object.keys(localitesParDepartement);
  } catch (err) {
    localitesParDepartement = {};
    departementsConnus = [];
  }
}

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
          ${GROUPES_CATEGORIES.map((g) => `
            <optgroup label="${g.groupe}">
              ${Object.entries(g.categories).map(([v, label]) => `<option value="${v}">${label}</option>`).join("")}
            </optgroup>
          `).join("")}
        </select>
      </label>
      <label>Localité
        <select id="tr-localite" disabled><option value="">Chargement…</option></select>
      </label>
      <p class="hint" id="hint-localite" style="display:none;">Aucune localité configurée pour ce département — demandez à l'ingénieur de les ajouter dans le logiciel de bureau, puis de synchroniser.</p>
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
      <label id="lbl-mat-localite" style="display:none;">Localité de livraison
        <select id="mat-localite" disabled><option value="">Chargement…</option></select>
      </label>
      <p class="hint" id="hint-mat-localite" style="display:none;">Aucune localité configurée pour ce département — demandez à l'ingénieur de les ajouter dans le logiciel de bureau, puis de synchroniser.</p>
      <label>Quantité<input id="mat-quantite" type="number" min="0.01" step="0.01" /></label>
      <label>Unité<select id="mat-unite"></select></label>
      <label>Date<input id="mat-date" type="date" /></label>
      <button class="btn" id="btn-mat-save">Enregistrer</button>
      <div id="msg-mat" class="msg hidden"></div>
    </div>

    <div class="card">
      <h2>Équipements &amp; matériel${plusieursDepartements ? "" : " — " + utilisateurCourant.departements[0]}</h2>
      <p class="hint" style="margin-top:0;">Signalez ici un moule de pointe de diamant, une barre à mine, ou tout autre matériel/équipement qui arrive dans le département, ou que vous envoyez vers un autre département.</p>
      <label>Mouvement
        <select id="eq-mouvement">
          <option value="Arrivee">Matériel arrivé dans le département</option>
          <option value="Transfert">Envoi vers un autre département</option>
        </select>
      </label>
      <label id="lbl-eq-destination" style="display:none;">Département de destination
        <select id="eq-destination"></select>
      </label>
      <label>Désignation<input id="eq-designation" placeholder="ex: Moule de pointe de diamant, Barre à mine..." /></label>
      <label>Quantité<input id="eq-quantite" type="number" min="1" step="1" /></label>
      <label>Date<input id="eq-date" type="date" /></label>
      <label>Commentaire (optionnel)<input id="eq-commentaire" /></label>
      <button class="btn" id="btn-eq-save">Enregistrer</button>
      <div id="msg-eq" class="msg hidden"></div>
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
  document.getElementById("eq-date").value = auj();
  document.getElementById("doc-date").value = auj();

  function departementSaisieActuel() {
    const select = document.getElementById("saisie-departement");
    return select ? select.value : utilisateurCourant.departements[0];
  }

  // Remplit un menu déroulant de localités à partir du référentiel envoyé par
  // le logiciel de bureau, filtré sur le département actuellement sélectionné
  // pour cette saisie. Renvoie false si aucune localité n'est configurée pour
  // ce département (pour bloquer l'enregistrement plutôt que d'accepter une
  // saisie libre).
  function remplirLocalites(selectId) {
    const liste = localitesParDepartement[departementSaisieActuel()] || [];
    const select = document.getElementById(selectId);
    if (!liste.length) {
      select.innerHTML = `<option value="">Aucune localité disponible</option>`;
      select.disabled = true;
    } else {
      select.innerHTML = liste.map((l) => `<option value="${l}">${l}</option>`).join("");
      select.disabled = false;
    }
    return liste.length > 0;
  }

  function majOptionsLocalite() {
    const ok = remplirLocalites("tr-localite");
    document.getElementById("btn-tr-save").disabled = !ok;
    document.getElementById("hint-localite").style.display = ok ? "none" : "";
  }

  function majOptionsMateriau() {
    const m = document.getElementById("mat-materiau").value;
    const cfg = MATERIAUX[m];
    const etapeSelect = document.getElementById("mat-etape");
    etapeSelect.innerHTML = cfg.etapes.map((e) => `<option value="${e}">${ETAPE_LABEL[e]}</option>`).join("");
    document.getElementById("lbl-mat-etape").style.display = cfg.etapes.length > 1 ? "" : "none";
    document.getElementById("mat-unite").innerHTML = cfg.unites.map((u) => `<option value="${u}">${u}</option>`).join("");

    const lblLocalite = document.getElementById("lbl-mat-localite");
    const hintLocalite = document.getElementById("hint-mat-localite");
    const btnSave = document.getElementById("btn-mat-save");
    if (cfg.localiteRequise) {
      lblLocalite.style.display = "";
      const ok = remplirLocalites("mat-localite");
      hintLocalite.style.display = ok ? "none" : "";
      btnSave.disabled = !ok;
    } else {
      lblLocalite.style.display = "none";
      hintLocalite.style.display = "none";
      btnSave.disabled = false;
    }
  }
  document.getElementById("mat-materiau").addEventListener("change", majOptionsMateriau);
  majOptionsMateriau();

  // Menu de destination pour un transfert d'équipement : tous les départements
  // connus (référentiel des localités) sauf celui d'où part l'envoi.
  function majOptionsDestinationEquipement() {
    const mouvement = document.getElementById("eq-mouvement").value;
    const lbl = document.getElementById("lbl-eq-destination");
    const select = document.getElementById("eq-destination");
    if (mouvement !== "Transfert") { lbl.style.display = "none"; return; }
    lbl.style.display = "";
    const origine = departementSaisieActuel();
    const options = departementsConnus.filter((d) => d !== origine);
    select.innerHTML = options.length
      ? options.map((d) => `<option value="${d}">${d}</option>`).join("")
      : `<option value="">Aucun autre département disponible</option>`;
  }
  document.getElementById("eq-mouvement").addEventListener("change", majOptionsDestinationEquipement);
  majOptionsDestinationEquipement();

  const selectDepartement = document.getElementById("saisie-departement");
  if (selectDepartement) {
    selectDepartement.addEventListener("change", () => {
      majOptionsLocalite();
      majOptionsMateriau();
      majOptionsDestinationEquipement();
    });
  }
  chargerLocalites().then(() => {
    majOptionsLocalite();
    majOptionsMateriau();
    majOptionsDestinationEquipement();
  });

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
      document.getElementById("tr-type").value = "";
      document.getElementById("tr-quantite").value = "";
      chargerMesSaisies();
    } catch (err) {
      afficherMessage("msg-tr", err.message, false);
    }
  });

  document.getElementById("btn-mat-save").addEventListener("click", async () => {
    try {
      const materiau = document.getElementById("mat-materiau").value;
      const cfg = MATERIAUX[materiau];
      const body = {
        departement: departementSaisieActuel(),
        materiau,
        etape: document.getElementById("mat-etape").value,
        quantite: document.getElementById("mat-quantite").value,
        unite: document.getElementById("mat-unite").value,
        date_saisie: document.getElementById("mat-date").value,
      };
      if (cfg.localiteRequise) body.localite = document.getElementById("mat-localite").value;
      await api("/saisie/materiaux", { method: "POST", body });
      afficherMessage("msg-mat", "Enregistré.", true);
      document.getElementById("mat-quantite").value = "";
      chargerMesSaisies();
    } catch (err) {
      afficherMessage("msg-mat", err.message, false);
    }
  });

  document.getElementById("btn-eq-save").addEventListener("click", async () => {
    try {
      const mouvement = document.getElementById("eq-mouvement").value;
      const body = {
        type_mouvement: mouvement,
        designation: document.getElementById("eq-designation").value,
        quantite: document.getElementById("eq-quantite").value,
        date_saisie: document.getElementById("eq-date").value,
        commentaire: document.getElementById("eq-commentaire").value,
      };
      if (mouvement === "Arrivee") {
        body.departement = departementSaisieActuel();
      } else {
        body.departement_origine = departementSaisieActuel();
        body.departement = document.getElementById("eq-destination").value;
      }
      await api("/saisie/equipements", { method: "POST", body });
      afficherMessage("msg-eq", "Enregistré.", true);
      document.getElementById("eq-designation").value = "";
      document.getElementById("eq-quantite").value = "";
      document.getElementById("eq-commentaire").value = "";
      chargerMesSaisies();
    } catch (err) {
      afficherMessage("msg-eq", err.message, false);
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
      texte: `${prefixeDep(r.departement)}${r.materiau} ${ETAPE_LABEL[r.etape].toLowerCase()}${r.localite ? " — " + r.localite : ""} : ${r.quantite} ${r.unite}`,
      ts: r.date_creation,
    })),
    ...data.documents.map((r) => ({
      date: r.date_saisie.slice(0, 10),
      texte: `${prefixeDep(r.departement)}${TYPE_DOCUMENT_LABEL[r.type]} — ${r.nom_fichier}`,
      ts: r.date_creation,
    })),
    ...(data.equipements || []).map((r) => ({
      date: r.date_saisie.slice(0, 10),
      texte: r.type_mouvement === "Transfert"
        ? `${r.designation} — Transfert ${r.departement_origine} → ${r.departement} : ${r.quantite}`
        : `${prefixeDep(r.departement)}${r.designation} — ${TYPE_MOUVEMENT_EQUIPEMENT_LABEL[r.type_mouvement]} : ${r.quantite}`,
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
