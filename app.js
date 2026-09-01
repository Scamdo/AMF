(() => {
  "use strict";

  const CONFIG = window.AMF_CONFIG || {};

  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_PUBLISHABLE_KEY) {
    console.error("AMF configuration is missing.");
    return;
  }

  if (!window.supabase) {
    console.error("Supabase library failed to load.");
    return;
  }

  const db = window.supabase.createClient(
    CONFIG.SUPABASE_URL,
    CONFIG.SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  const RECENT_KEY = "amf_recent_modules_v1";
  const RECENT_LIMIT = 5;

  const state = {
    allMetadata: [],
    rawResults: [],
    displayedResults: [],
    currentQuery: "",
    currentModule: null,
    wordingMode: "display",
    currentUser: null,
    initialized: false,
    recentModules: []
  };

  const el = {
    authScreen: document.getElementById("authScreen"),
    loginForm: document.getElementById("loginForm"),
    loginEmail: document.getElementById("loginEmail"),
    loginPassword: document.getElementById("loginPassword"),
    loginButton: document.getElementById("loginButton"),
    loginError: document.getElementById("loginError"),
    logoutButton: document.getElementById("logoutButton"),
    userEmail: document.getElementById("userEmail"),

    connectionStatus: document.getElementById("connectionStatus"),
    databaseSummary: document.getElementById("databaseSummary"),

    searchForm: document.getElementById("searchForm"),
    searchInput: document.getElementById("searchInput"),
    clearSearchButton: document.getElementById("clearSearchButton"),

    filtersToggle: document.getElementById("filtersToggle"),
    filtersPanel: document.getElementById("filtersPanel"),
    activeFilterCount: document.getElementById("activeFilterCount"),
    resetFiltersButton: document.getElementById("resetFiltersButton"),

    elementTypeFilter: document.getElementById("elementTypeFilter"),
    elementFilter: document.getElementById("elementFilter"),
    componentFilter: document.getElementById("componentFilter"),
    csmFilter: document.getElementById("csmFilter"),
    reuseFilter: document.getElementById("reuseFilter"),
    includeInvalid: document.getElementById("includeInvalid"),

    sortSelect: document.getElementById("sortSelect"),

    resultsTitle: document.getElementById("resultsTitle"),
    resultsMeta: document.getElementById("resultsMeta"),
    resultsGrid: document.getElementById("resultsGrid"),

    loadingState: document.getElementById("loadingState"),
    initialState: document.getElementById("initialState"),
    emptyState: document.getElementById("emptyState"),
    emptyStateMessage: document.getElementById("emptyStateMessage"),
    errorState: document.getElementById("errorState"),
    errorMessage: document.getElementById("errorMessage"),

    browseAllButton: document.getElementById("browseAllButton"),

    recentSection: document.getElementById("recentSection"),
    recentModules: document.getElementById("recentModules"),
    clearRecentButton: document.getElementById("clearRecentButton"),

    drawerBackdrop: document.getElementById("drawerBackdrop"),
    moduleDrawer: document.getElementById("moduleDrawer"),
    closeDrawerButton: document.getElementById("closeDrawerButton"),
    invalidWarning: document.getElementById("invalidWarning"),

    detailModuleNumber: document.getElementById("detailModuleNumber"),
    detailValidity: document.getElementById("detailValidity"),
    detailModuleDescription: document.getElementById("detailModuleDescription"),

    detailElementType: document.getElementById("detailElementType"),
    detailElement: document.getElementById("detailElement"),
    detailComponent: document.getElementById("detailComponent"),
    detailCsm: document.getElementById("detailCsm"),
    detailReuse: document.getElementById("detailReuse"),
    detailBaseModule: document.getElementById("detailBaseModule"),

    detailWording: document.getElementById("detailWording"),
    detailGuidelines: document.getElementById("detailGuidelines"),
    detailExplanation: document.getElementById("detailExplanation"),
    detailApplication: document.getElementById("detailApplication"),
    detailElementExplanation: document.getElementById("detailElementExplanation"),

    guidelinesSection: document.getElementById("guidelinesSection"),
    explanationSection: document.getElementById("explanationSection"),
    applicationSection: document.getElementById("applicationSection"),
    elementExplanationSection: document.getElementById("elementExplanationSection"),

    copyModuleButton: document.getElementById("copyModuleButton"),
    copyWordingButton: document.getElementById("copyWordingButton"),

    displayWordingButton: document.getElementById("displayWordingButton"),
    rawWordingButton: document.getElementById("rawWordingButton"),

    toast: document.getElementById("toast")
  };

  async function init() {
    bindEvents();
    updateClearButton();
    loadRecentModules();
    setConnectionStatus("checking");

    const {
      data: { session }
    } = await db.auth.getSession();

    if (session && session.user) {
      await startAuthenticatedApp(session.user);
    } else {
      showLogin();
    }

    db.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") {
        resetApplication();
        showLogin();
      }

      if (
        (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") &&
        session &&
        session.user &&
        !state.currentUser
      ) {
        await startAuthenticatedApp(session.user);
      }
    });
  }

  function bindEvents() {
    el.loginForm.addEventListener("submit", handleLogin);

    el.logoutButton.addEventListener("click", async () => {
      await db.auth.signOut();
    });

    el.searchForm.addEventListener("submit", async event => {
      event.preventDefault();
      await runSearch();
    });

    el.searchInput.addEventListener("input", updateClearButton);

    el.clearSearchButton.addEventListener("click", () => {
      el.searchInput.value = "";
      state.currentQuery = "";
      updateClearButton();
      el.searchInput.focus();
      showInitialState();
    });

    document.querySelectorAll(".quick-search").forEach(button => {
      button.addEventListener("click", async () => {
        el.searchInput.value = button.dataset.query || "";
        updateClearButton();
        await runSearch();
      });
    });

    el.browseAllButton.addEventListener("click", browseModules);

    el.filtersToggle.addEventListener("click", () => {
      const open = el.filtersPanel.hidden;
      el.filtersPanel.hidden = !open;
      el.filtersToggle.setAttribute("aria-expanded", String(open));
    });

    el.resetFiltersButton.addEventListener("click", () => {
      resetFilters();
      applyFiltersAndSort();
    });

    el.elementTypeFilter.addEventListener("change", () => {
      populateElementFilter();
      updateActiveFilterCount();
      applyFiltersAndSort();
    });

    [
      el.elementFilter,
      el.componentFilter,
      el.csmFilter,
      el.reuseFilter
    ].forEach(control => {
      control.addEventListener("change", () => {
        updateActiveFilterCount();
        applyFiltersAndSort();
      });
    });

    el.includeInvalid.addEventListener("change", async () => {
      updateActiveFilterCount();

      if (state.currentQuery) {
        await runSearch();
      } else if (state.rawResults.length) {
        await browseModules();
      }
    });

    el.sortSelect.addEventListener("change", applyFiltersAndSort);

    el.closeDrawerButton.addEventListener("click", closeDrawer);
    el.drawerBackdrop.addEventListener("click", closeDrawer);

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        if (el.moduleDrawer.classList.contains("open")) {
          closeDrawer();
        } else if (el.searchInput.value) {
          el.searchInput.value = "";
          state.currentQuery = "";
          updateClearButton();
          showInitialState();
          el.searchInput.focus();
        }
      }
    });

    el.copyModuleButton.addEventListener("click", async () => {
      if (!state.currentModule) return;
      await copyText(state.currentModule.module || "");
      showToast("Module number copied");
    });

    el.copyWordingButton.addEventListener("click", async () => {
      if (!state.currentModule) return;
      await copyFullModule(state.currentModule);
    });

    el.displayWordingButton.addEventListener("click", () => {
      state.wordingMode = "display";
      renderCurrentWording();
    });

    el.rawWordingButton.addEventListener("click", () => {
      state.wordingMode = "raw";
      renderCurrentWording();
    });

    el.clearRecentButton.addEventListener("click", () => {
      state.recentModules = [];
      localStorage.removeItem(RECENT_KEY);
      renderRecentModules();
    });
  }

  async function handleLogin(event) {
    event.preventDefault();

    el.loginError.hidden = true;
    el.loginButton.disabled = true;
    el.loginButton.textContent = "Signing in...";

    const email = el.loginEmail.value.trim();
    const password = el.loginPassword.value;

    try {
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.user) throw new Error("Unable to authenticate.");

      await startAuthenticatedApp(data.user);
      el.loginPassword.value = "";
    } catch (error) {
      console.error(error);
      el.loginError.textContent = error.message || "Sign in failed.";
      el.loginError.hidden = false;
    } finally {
      el.loginButton.disabled = false;
      el.loginButton.textContent = "Sign in";
    }
  }

  async function startAuthenticatedApp(user) {
    if (state.currentUser) return;

    state.currentUser = user;
    el.userEmail.textContent = user.email || "";
    el.authScreen.hidden = true;

    try {
      setConnectionStatus("checking");
      await loadMetadata();
      setConnectionStatus("online");
      state.initialized = true;
      renderRecentModules();
      showInitialState();
    } catch (error) {
      console.error(error);
      setConnectionStatus("offline");
      showError(
        "The database could not be loaded. Check access permissions and Supabase configuration."
      );
    }
  }

  function showLogin() {
    state.currentUser = null;
    el.userEmail.textContent = "";
    el.authScreen.hidden = false;
    setConnectionStatus("offline");

    setTimeout(() => {
      el.loginEmail.focus();
    }, 100);
  }

  function resetApplication() {
    state.allMetadata = [];
    state.rawResults = [];
    state.displayedResults = [];
    state.currentQuery = "";
    state.currentModule = null;
    state.currentUser = null;
    state.initialized = false;

    el.databaseSummary.textContent = "Authentication required";
    el.resultsGrid.innerHTML = "";
    closeDrawer();
  }

  async function loadMetadata() {
    const pageSize = 1000;
    let from = 0;
    let rows = [];

    while (true) {
      const { data, error } = await db
        .from("modules")
        .select(`
          id,
          module,
          module_description,
          element_type,
          element_type_description,
          element,
          element_description,
          component,
          csm,
          reuse_ind,
          valid_flag
        `)
        .range(from, from + pageSize - 1);

      if (error) throw error;

      const batch = data || [];
      rows = rows.concat(batch);

      if (batch.length < pageSize) break;
      from += pageSize;
    }

    state.allMetadata = rows;
    populateFilters();
    updateDatabaseSummary();
  }

  function updateDatabaseSummary() {
    const total = state.allMetadata.length;
    const valid = state.allMetadata.filter(row => row.valid_flag === "Y").length;
    const invalid = total - valid;

    el.databaseSummary.textContent =
      `${total.toLocaleString()} modules · ` +
      `${valid.toLocaleString()} valid · ` +
      `${invalid.toLocaleString()} invalid`;
  }

  function populateFilters() {
    fillSelect(
      el.elementTypeFilter,
      uniqueSorted(
        state.allMetadata
          .filter(row => row.element_type)
          .map(row => ({
            value: row.element_type,
            label: row.element_type_description || row.element_type
          }))
      ),
      "All Element Types"
    );

    fillSelect(
      el.componentFilter,
      uniqueSorted(
        state.allMetadata
          .filter(row => row.component)
          .map(row => ({
            value: row.component,
            label: row.component
          }))
      ),
      "All Components"
    );

    populateElementFilter();
  }

  function populateElementFilter() {
    const selectedType = el.elementTypeFilter.value;

    const source = selectedType
      ? state.allMetadata.filter(row => row.element_type === selectedType)
      : state.allMetadata;

    const currentElement = el.elementFilter.value;

    const options = uniqueSorted(
      source
        .filter(row => row.element)
        .map(row => ({
          value: row.element,
          label: row.element_description || row.element
        }))
    );

    fillSelect(el.elementFilter, options, "All Elements");

    if (options.some(option => option.value === currentElement)) {
      el.elementFilter.value = currentElement;
    }
  }

  function uniqueSorted(items) {
    const map = new Map();

    items.forEach(item => {
      if (!map.has(item.value)) map.set(item.value, item);
    });

    return Array.from(map.values()).sort((a, b) =>
      String(a.label).localeCompare(String(b.label))
    );
  }

  function fillSelect(select, items, firstLabel) {
    select.innerHTML = "";

    const first = document.createElement("option");
    first.value = "";
    first.textContent = firstLabel;
    select.appendChild(first);

    items.forEach(item => {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    });
  }

  async function runSearch() {
    if (!state.currentUser) {
      showLogin();
      return;
    }

    const query = el.searchInput.value.trim();

    if (!query) {
      await browseModules();
      return;
    }

    state.currentQuery = query;
    showLoading();

    try {
      const { data, error } = await db.rpc("search_modules", {
        search_query: query,
        include_invalid: el.includeInvalid.checked,
        result_limit: 100
      });

      if (error) throw error;

      state.rawResults = data || [];

      if (state.rawResults.length === 0 && !el.includeInvalid.checked) {
        const invalidExact = await findInvalidExactModule(query);

        if (invalidExact) {
          showEmpty(
            `Module ${query} exists, but it is currently marked invalid / obsolete. ` +
            `Enable "Include invalid / obsolete" to view it.`
          );
          return;
        }
      }

      applyFiltersAndSort();
    } catch (error) {
      console.error(error);
      showError(error.message || "Search could not be completed.");
    }
  }

  async function findInvalidExactModule(query) {
    const { data, error } = await db
      .from("modules")
      .select("id,module,valid_flag")
      .ilike("module", query)
      .eq("valid_flag", "N")
      .limit(1);

    if (error) {
      console.warn(error);
      return null;
    }

    return data && data.length ? data[0] : null;
  }

  async function browseModules() {
    if (!state.currentUser) {
      showLogin();
      return;
    }

    state.currentQuery = "";
    showLoading();

    try {
      let request = db
        .from("modules")
        .select(`
          id,
          module,
          module_description,
          element_type,
          element_type_description,
          element,
          element_description,
          component,
          csm,
          reuse_ind,
          base_module,
          valid_flag,
          wording,
          guidelines,
          explanation,
          application,
          element_explanation
        `)
        .order("module", { ascending: true })
        .limit(500);

      if (!el.includeInvalid.checked) {
        request = request.eq("valid_flag", "Y");
      }

      const { data, error } = await request;
      if (error) throw error;

      state.rawResults = data || [];
      applyFiltersAndSort();
    } catch (error) {
      console.error(error);
      showError(error.message || "Modules could not be loaded.");
    }
  }

  function applyFiltersAndSort() {
    let results = [...state.rawResults];

    const elementType = el.elementTypeFilter.value;
    const element = el.elementFilter.value;
    const component = el.componentFilter.value;
    const csm = el.csmFilter.value;
    const reuse = el.reuseFilter.value;
    const includeInvalid = el.includeInvalid.checked;

    if (!includeInvalid) results = results.filter(row => row.valid_flag === "Y");
    if (elementType) results = results.filter(row => row.element_type === elementType);
    if (element) results = results.filter(row => row.element === element);
    if (component) results = results.filter(row => row.component === component);
    if (csm) results = results.filter(row => row.csm === csm);
    if (reuse) results = results.filter(row => row.reuse_ind === reuse);

    const sort = el.sortSelect.value;

    if (sort === "module_asc") {
      results.sort((a, b) =>
        String(a.module || "").localeCompare(String(b.module || ""), undefined, { numeric: true })
      );
    }

    if (sort === "description_asc") {
      results.sort((a, b) =>
        String(a.module_description || "").localeCompare(String(b.module_description || ""))
      );
    }

    if (sort === "relevance" && state.currentQuery) {
      results.sort(
        (a, b) => Number(b.search_score || 0) - Number(a.search_score || 0)
      );
    }

    state.displayedResults = results;
    renderResults();
    updateActiveFilterCount();
  }

  function renderResults() {
    hideAllStates();
    el.resultsGrid.innerHTML = "";

    const count = state.displayedResults.length;

    if (!count) {
      showEmpty(
        state.currentQuery
          ? "No modules match the current search and filters."
          : "No modules match the current filters."
      );
      return;
    }

    el.resultsTitle.textContent = state.currentQuery ? "Search results" : "Modules";
    el.resultsMeta.textContent =
      `${count.toLocaleString()} module${count === 1 ? "" : "s"}` +
      (state.currentQuery ? ` found for "${state.currentQuery}"` : " shown");

    state.displayedResults.forEach(module => {
      el.resultsGrid.appendChild(createModuleCard(module));
    });
  }

  function createModuleCard(module) {
    const card = document.createElement("article");
    card.className = "module-card" + (module.valid_flag === "N" ? " module-card-invalid" : "");
    card.tabIndex = 0;

    const top = document.createElement("div");
    top.className = "module-card-top";

    const main = document.createElement("div");
    main.className = "module-main";

    const numberLine = document.createElement("div");
    numberLine.className = "module-number-line";

    const moduleNumber = document.createElement("span");
    moduleNumber.className = "module-number";
    moduleNumber.textContent = module.module || "-";

    const validity = document.createElement("span");
    validity.className =
      "validity-badge " +
      (module.valid_flag === "Y" ? "validity-valid" : "validity-invalid");
    validity.textContent = module.valid_flag === "Y" ? "Valid" : "Invalid";

    numberLine.append(moduleNumber, validity);

    const title = document.createElement("h3");
    title.className = "module-description";
    title.textContent = module.module_description || "No module description";

    main.append(numberLine, title);

    const action = document.createElement("div");
    action.className = "module-card-action";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "copy-card-button";
    copyButton.textContent = "Copy";
    copyButton.title = "Copy full module wording";

    copyButton.addEventListener("click", async event => {
      event.stopPropagation();
      const fullModule = await fetchFullModule(module.id);
      if (fullModule) await copyFullModule(fullModule);
    });

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "open-module-button";
    openButton.textContent = "View module";

    openButton.addEventListener("click", event => {
      event.stopPropagation();
      openModule(module.id);
    });

    action.append(copyButton, openButton);
    top.append(main, action);
    card.appendChild(top);

    const classification = document.createElement("div");
    classification.className = "module-classification";

    const pills = [];
    if (module.element_type_description) pills.push(module.element_type_description);
    if (module.element_description) pills.push(module.element_description);
    if (module.component) pills.push(`Component ${module.component}`);

    pills.forEach(value => {
      const pill = document.createElement("span");
      pill.className = "meta-pill";
      pill.textContent = value;
      classification.appendChild(pill);
    });

    if (pills.length) card.appendChild(classification);

    const snippetData = selectBestSnippet(module, state.currentQuery);

    if (snippetData.text) {
      const snippet = document.createElement("div");
      snippet.className = "match-snippet";

      const label = document.createElement("span");
      label.className = "match-label";
      label.textContent = snippetData.label;

      const content = document.createElement("div");
      appendHighlightedText(
        content,
        trimSnippet(snippetData.text, state.currentQuery),
        state.currentQuery
      );

      snippet.append(label, content);
      card.appendChild(snippet);
    }

    card.addEventListener("click", () => openModule(module.id));

    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openModule(module.id);
      }
    });

    return card;
  }

  function selectBestSnippet(module, query) {
    const fields = [
      ["Module description", module.module_description],
      ["Guidelines", module.guidelines],
      ["Element description", module.element_description],
      ["Explanation", module.explanation],
      ["Wording", module.wording],
      ["Application", module.application],
      ["Element explanation", module.element_explanation]
    ];

    if (!query) {
      for (const [label, value] of fields) {
        if (value) return { label, text: value };
      }
      return { label: "", text: "" };
    }

    const normalizedQuery = query.toLowerCase();

    for (const [label, value] of fields) {
      if (value && String(value).toLowerCase().includes(normalizedQuery)) {
        return { label, text: value };
      }
    }

    for (const [label, value] of fields) {
      if (value) return { label, text: value };
    }

    return { label: "", text: "" };
  }

  function trimSnippet(text, query) {
    if (!text) return "";

    const clean = readableText(text).replace(/\s+/g, " ").trim();

    if (clean.length <= 360) return clean;
    if (!query) return clean.slice(0, 360) + "…";

    const index = clean.toLowerCase().indexOf(query.toLowerCase());

    if (index < 0) return clean.slice(0, 360) + "…";

    const start = Math.max(0, index - 120);
    const end = Math.min(clean.length, index + query.length + 220);

    return (
      (start > 0 ? "…" : "") +
      clean.slice(start, end) +
      (end < clean.length ? "…" : "")
    );
  }

  function appendHighlightedText(container, text, query) {
    if (!query) {
      container.textContent = text;
      return;
    }

    const lower = text.toLowerCase();
    const needle = query.toLowerCase();

    let cursor = 0;
    let index;

    while ((index = lower.indexOf(needle, cursor)) !== -1) {
      container.appendChild(document.createTextNode(text.slice(cursor, index)));

      const mark = document.createElement("mark");
      mark.textContent = text.slice(index, index + query.length);
      container.appendChild(mark);

      cursor = index + query.length;
    }

    container.appendChild(document.createTextNode(text.slice(cursor)));
  }

  async function fetchFullModule(id) {
    try {
      const { data, error } = await db
        .from("modules")
        .select(`
          id,
          module,
          module_description,
          element_type,
          element_type_description,
          element,
          element_description,
          component,
          csm,
          reuse_ind,
          base_module,
          valid_flag,
          wording,
          guidelines,
          explanation,
          application,
          element_explanation
        `)
        .eq("id", id)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error(error);
      showToast("Unable to load module");
      return null;
    }
  }

  async function openModule(id) {
    const module = await fetchFullModule(id);
    if (!module) return;

    state.currentModule = module;
    state.wordingMode = "display";

    addRecentModule(module);
    renderModuleDetail();

    el.drawerBackdrop.hidden = false;
    el.moduleDrawer.classList.add("open");
    el.moduleDrawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
  }

  function renderModuleDetail() {
    const module = state.currentModule;
    if (!module) return;

    el.detailModuleNumber.textContent = module.module || "-";
    el.detailModuleDescription.textContent =
      module.module_description || "No module description";

    el.detailValidity.className =
      "validity-badge " +
      (module.valid_flag === "Y" ? "validity-valid" : "validity-invalid");

    el.detailValidity.textContent =
      module.valid_flag === "Y" ? "Valid" : "Invalid / obsolete";

    el.invalidWarning.hidden = module.valid_flag === "Y";

    el.detailElementType.textContent =
      combineCodeAndDescription(module.element_type, module.element_type_description);

    el.detailElement.textContent =
      combineCodeAndDescription(module.element, module.element_description);

    el.detailComponent.textContent = module.component || "-";
    el.detailCsm.textContent = module.csm || "-";
    el.detailReuse.textContent = module.reuse_ind || "-";
    el.detailBaseModule.textContent = module.base_module || "-";

    setOptionalSection(el.guidelinesSection, el.detailGuidelines, module.guidelines);
    setOptionalSection(el.explanationSection, el.detailExplanation, module.explanation);
    setOptionalSection(el.applicationSection, el.detailApplication, module.application);
    setOptionalSection(
      el.elementExplanationSection,
      el.detailElementExplanation,
      module.element_explanation
    );

    renderCurrentWording();
  }

  function renderCurrentWording() {
    const module = state.currentModule;
    if (!module) return;

    const raw = module.wording || "";

    if (state.wordingMode === "raw") {
      el.rawWordingButton.classList.add("active");
      el.displayWordingButton.classList.remove("active");
      el.detailWording.textContent = raw || "No wording available.";
    } else {
      el.displayWordingButton.classList.add("active");
      el.rawWordingButton.classList.remove("active");
      el.detailWording.textContent = raw ? readableText(raw) : "No wording available.";
    }
  }

  function readableText(text) {
    if (!text) return "";

    return String(text)
      .replace(/\[NL\]/gi, "\n")
      .replace(/\[INDENT1\]/gi, "    ")
      .replace(/\[INDENT0\]/gi, "")
      .replace(/\[IT\]/gi, "")
      .replace(/\[RO\]/gi, "");
  }

  function setOptionalSection(section, contentElement, value) {
    if (!value || !String(value).trim()) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    contentElement.textContent = readableText(value);
  }

  function combineCodeAndDescription(code, description) {
    if (code && description) return `${description} (${code})`;
    return description || code || "-";
  }

  function closeDrawer() {
    el.moduleDrawer.classList.remove("open");
    el.moduleDrawer.setAttribute("aria-hidden", "true");
    el.drawerBackdrop.hidden = true;
    document.body.classList.remove("drawer-open");
  }

  function resetFilters() {
    el.elementTypeFilter.value = "";
    populateElementFilter();

    el.elementFilter.value = "";
    el.componentFilter.value = "";
    el.csmFilter.value = "";
    el.reuseFilter.value = "";
    el.includeInvalid.checked = false;

    updateActiveFilterCount();
  }

  function updateActiveFilterCount() {
    let count = 0;

    if (el.elementTypeFilter.value) count++;
    if (el.elementFilter.value) count++;
    if (el.componentFilter.value) count++;
    if (el.csmFilter.value) count++;
    if (el.reuseFilter.value) count++;
    if (el.includeInvalid.checked) count++;

    el.activeFilterCount.textContent = count;
    el.activeFilterCount.hidden = count === 0;

    if (count > 0) {
      el.filtersPanel.hidden = false;
      el.filtersToggle.setAttribute("aria-expanded", "true");
    }
  }

  function hideAllStates() {
    el.loadingState.hidden = true;
    el.initialState.hidden = true;
    el.emptyState.hidden = true;
    el.errorState.hidden = true;
  }

  function showLoading() {
    hideAllStates();
    el.resultsGrid.innerHTML = "";
    el.loadingState.hidden = false;
    el.resultsTitle.textContent = "Modules";
    el.resultsMeta.textContent = "Searching database...";
  }

  function showInitialState() {
    hideAllStates();
    el.resultsGrid.innerHTML = "";
    el.initialState.hidden = false;
    el.resultsTitle.textContent = "Modules";
    el.resultsMeta.textContent = "Valid modules are shown by default.";
  }

  function showEmpty(message) {
    hideAllStates();
    el.resultsGrid.innerHTML = "";
    el.emptyState.hidden = false;
    el.emptyStateMessage.textContent =
      message || "Try another phrase or broaden the filters.";

    el.resultsTitle.textContent = state.currentQuery ? "Search results" : "Modules";
    el.resultsMeta.textContent = "No matching modules found.";
  }

  function showError(message) {
    hideAllStates();
    el.resultsGrid.innerHTML = "";
    el.errorState.hidden = false;
    el.errorMessage.textContent = message;
    el.resultsMeta.textContent = "Database error.";
  }

  function setConnectionStatus(status) {
    el.connectionStatus.classList.remove(
      "connection-checking",
      "connection-online",
      "connection-offline"
    );

    if (status === "online") {
      el.connectionStatus.classList.add("connection-online");
      el.connectionStatus.textContent = "Database connected";
    } else if (status === "offline") {
      el.connectionStatus.classList.add("connection-offline");
      el.connectionStatus.textContent = "Signed out";
    } else {
      el.connectionStatus.classList.add("connection-checking");
      el.connectionStatus.textContent = "Connecting...";
    }
  }

  function updateClearButton() {
    el.clearSearchButton.hidden = !el.searchInput.value;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function copyFullModule(module) {
    const wording = module.wording || "";

    if (!wording) {
      showToast("No wording available");
      return;
    }

    const moduleDescription = module.module_description || "Module";
    const moduleNumber = module.module || "";
    const heading = `${moduleDescription} (${moduleNumber})`;
    const readableWording = readableText(wording);

    const plainText = `${heading}\n\n${readableWording}`;

    const htmlWording = escapeHtml(readableWording)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\n/g, "<br>");

    const htmlContent =
      `<strong>${escapeHtml(heading)}</strong><br><br>${htmlWording}`;

    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const clipboardItem = new ClipboardItem({
          "text/plain": new Blob([plainText], { type: "text/plain" }),
          "text/html": new Blob([htmlContent], { type: "text/html" })
        });

        await navigator.clipboard.write([clipboardItem]);
        showToast("Full module copied");
        return;
      }

      await copyText(plainText);
      showToast("Full module copied");
    } catch (error) {
      console.error(error);
      await copyText(plainText);
      showToast("Full module copied");
    }
  }

  async function copyText(text) {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function loadRecentModules() {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      state.recentModules = raw ? JSON.parse(raw) : [];
    } catch {
      state.recentModules = [];
    }
  }

  function addRecentModule(module) {
    const recentItem = {
      id: module.id,
      module: module.module || "",
      module_description: module.module_description || ""
    };

    state.recentModules = state.recentModules
      .filter(item => item.id !== module.id);

    state.recentModules.unshift(recentItem);
    state.recentModules = state.recentModules.slice(0, RECENT_LIMIT);

    localStorage.setItem(RECENT_KEY, JSON.stringify(state.recentModules));
    renderRecentModules();
  }

  function renderRecentModules() {
    if (!state.currentUser || !state.recentModules.length) {
      el.recentSection.hidden = true;
      el.recentModules.innerHTML = "";
      return;
    }

    el.recentModules.innerHTML = "";

    state.recentModules.forEach(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "recent-module";

      const number = document.createElement("strong");
      number.textContent = item.module;

      const description = document.createElement("span");
      description.textContent = item.module_description || "Module";

      button.append(number, description);
      button.addEventListener("click", () => openModule(item.id));

      el.recentModules.appendChild(button);
    });

    el.recentSection.hidden = false;
  }

  let toastTimeout;

  function showToast(message) {
    clearTimeout(toastTimeout);
    el.toast.textContent = message;
    el.toast.hidden = false;

    toastTimeout = setTimeout(() => {
      el.toast.hidden = true;
    }, 1800);
  }

  init();
})();
