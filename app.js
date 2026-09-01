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

  const SEARCH_STOP_WORDS = new Set([
    "a", "an", "the", "and", "or", "for", "of", "to", "by", "in", "on",
    "at", "from", "with", "without", "under", "over", "into", "about",
    "is", "are", "be", "being", "been", "that", "this", "these", "those",
    "it", "its", "as", "than", "then", "which", "who", "whom", "whose"
  ]);

  const state = {
    allMetadata: [],
    rawResults: [],
    displayedResults: [],
    currentQuery: "",
    currentModule: null,
    wordingMode: "display",
    currentUser: null,
    initialized: false,
    recentModules: [],
    aiSearchAvailable: true,
    lastSearchUsedAI: false
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
    aiSearchStatus: document.getElementById("aiSearchStatus"),

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
    hasWording: document.getElementById("hasWording"),
    hasGuidelines: document.getElementById("hasGuidelines"),
    hasExplanation: document.getElementById("hasExplanation"),

    copyTop5Button: document.getElementById("copyTop5Button"),
    top5Menu: document.getElementById("top5Menu"),
    copyTop5Wording: document.getElementById("copyTop5Wording"),
    copyTop5Full: document.getElementById("copyTop5Full"),
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
      el.reuseFilter,
      el.hasWording,
      el.hasGuidelines,
      el.hasExplanation
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

    el.copyTop5Button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!state.displayedResults.length) return;
      el.top5Menu.classList.toggle("hidden");
    });

    el.copyTop5Wording.addEventListener("click", async () => {
      el.top5Menu.classList.add("hidden");
      await copyTopFive("wording");
    });

    el.copyTop5Full.addEventListener("click", async () => {
      el.top5Menu.classList.add("hidden");
      await copyTopFive("full");
    });

    document.addEventListener("click", (event) => {
      if (
        el.top5Menu &&
        el.copyTop5Button &&
        !el.top5Menu.contains(event.target) &&
        !el.copyTop5Button.contains(event.target)
      ) {
        el.top5Menu.classList.add("hidden");
      }
    });

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
          valid_flag,
          wording,
          guidelines,
          explanation,
          application,
          element_explanation
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
    state.lastSearchUsedAI = false;
    showLoading();
    setAiSearchStatus("working");

    try {
      if (!el.includeInvalid.checked) {
        const exactModule = await findExactModule(query);

        if (exactModule && exactModule.valid_flag === "N") {
          state.rawResults = [];
          state.displayedResults = [];
          setAiSearchStatus("ready");

          showEmpty(
            `Exact module ${query} was found, but it is currently marked invalid / obsolete. ` +
            `Enable "Include invalid / obsolete" to view it.`
          );
          return;
        }
      }

      const keywordPromise = db.rpc("search_modules", {
        search_query: query,
        include_invalid: el.includeInvalid.checked,
        result_limit: 100
      });

      const semanticPromise = runSemanticSearch(query);

      const [keywordResult, semanticResult] = await Promise.allSettled([
        keywordPromise,
        semanticPromise
      ]);

      let keywordRows = [];
      let semanticRows = [];

      if (keywordResult.status === "fulfilled") {
        const result = keywordResult.value;
        if (result.error) throw result.error;
        keywordRows = result.data || [];
      } else {
        throw keywordResult.reason;
      }

      if (semanticResult.status === "fulfilled") {
        semanticRows = semanticResult.value || [];
        state.aiSearchAvailable = true;
        state.lastSearchUsedAI = true;
        setAiSearchStatus("ready");
      } else {
        console.warn("AI semantic search unavailable:", semanticResult.reason);
        state.aiSearchAvailable = false;
        state.lastSearchUsedAI = false;
        setAiSearchStatus("fallback");
      }

      state.rawResults = mergeHybridResults(
        keywordRows,
        semanticRows,
        query
      );

      applyFiltersAndSort();
    } catch (error) {
      console.error(error);
      setAiSearchStatus("fallback");
      showError(error.message || "Search could not be completed.");
    }
  }

  async function runSemanticSearch(query) {
    const { data, error } = await db.functions.invoke(
      "amf-ai-search",
      {
        body: {
          query,
          include_invalid: el.includeInvalid.checked,
          match_count: 20
        }
      }
    );

    if (error) throw error;

    if (!data || !Array.isArray(data.results)) {
      throw new Error("AI search returned an invalid response.");
    }

    return data.results
      .filter(row => Number(row.similarity || 0) >= 0.40)
      .map((row, index) => ({
        ...row,
        semantic_similarity: Number(row.similarity || 0),
        semantic_rank: index + 1
      }));
  }

  function mergeHybridResults(keywordRows, semanticRows, query) {
    const merged = new Map();

    keywordRows.forEach((row, index) => {
      const key = String(row.id);

      merged.set(key, {
        ...row,
        keyword_rank: index + 1,
        keyword_match: true,
        semantic_match: false,
        semantic_similarity: null,
        semantic_rank: null
      });
    });

    semanticRows.forEach((row, index) => {
      const key = String(row.id);
      const existing = merged.get(key);

      if (existing) {
        merged.set(key, {
          ...existing,
          semantic_match: true,
          semantic_similarity: Number(row.semantic_similarity || row.similarity || 0),
          semantic_rank: row.semantic_rank || index + 1
        });
      } else {
        merged.set(key, {
          ...row,
          search_score: 0,
          keyword_rank: null,
          keyword_match: false,
          semantic_match: true,
          semantic_similarity: Number(row.semantic_similarity || row.similarity || 0),
          semantic_rank: row.semantic_rank || index + 1
        });
      }
    });

    return Array.from(merged.values()).map(row => ({
      ...row,
      client_priority_score: calculateHybridPriorityScore(row, query)
    }));
  }

  function calculateHybridPriorityScore(module, query) {
    const q = String(query || "").trim().toLowerCase();
    const moduleId = String(module.module || "").toLowerCase();

    if (moduleId === q) return 1000000;
    if (moduleId.startsWith(q)) return 900000;

    const meaningfulTokens = tokenizeQuery(query);
    const naturalLanguageQuery = meaningfulTokens.length >= 4;

    const keywordScore = calculateClientPriorityScore(module, query);
    const similarity = Number(module.semantic_similarity || 0);
    const semanticRank = Number(module.semantic_rank || 20);
    const rankBoost = Math.max(0, 25000 - semanticRank * 750);

    /*
      Natural-language searches should be driven primarily by meaning.
      Short searches such as "CRM", "China" or "Dutch law" still retain
      stronger keyword influence.
    */
    if (naturalLanguageQuery) {
      if (module.semantic_match && module.keyword_match) {
        return 800000 +
          Math.round(similarity * 120000) +
          rankBoost;
      }

      if (module.semantic_match) {
        return 760000 +
          Math.round(similarity * 120000) +
          rankBoost;
      }

      if (module.keyword_match) {
        return 500000 +
          Math.min(keywordScore, 180000);
      }

      return keywordScore;
    }

    if (module.keyword_match) {
      const semanticBoost = module.semantic_match
        ? Math.round(similarity * 50000)
        : 0;

      return keywordScore + semanticBoost;
    }

    if (module.semantic_match) {
      return 300000 +
        Math.round(similarity * 100000) +
        rankBoost;
    }

    return keywordScore;
  }

  function setAiSearchStatus(mode) {
    if (!el.aiSearchStatus) return;

    el.aiSearchStatus.classList.remove(
      "ai-ready",
      "ai-working",
      "ai-fallback"
    );

    if (mode === "working") {
      el.aiSearchStatus.classList.add("ai-working");
      el.aiSearchStatus.textContent = "AI Search…";
      el.aiSearchStatus.title = "Hybrid keyword + semantic search is running";
      return;
    }

    if (mode === "fallback") {
      el.aiSearchStatus.classList.add("ai-fallback");
      el.aiSearchStatus.textContent = "Keyword Search";
      el.aiSearchStatus.title = "AI semantic search unavailable - keyword search remains active";
      return;
    }

    el.aiSearchStatus.classList.add("ai-ready");
    el.aiSearchStatus.textContent = "AI Search";
    el.aiSearchStatus.title = "Hybrid keyword + semantic search";
  }

  async function findExactModule(query) {
    const { data, error } = await db
      .from("modules")
      .select("id,module,valid_flag")
      .eq("module", query)
      .limit(1);

    if (error) {
      console.warn(error);
      return null;
    }

    return data && data.length ? data[0] : null;
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
    const hasWording = el.hasWording.checked;
    const hasGuidelines = el.hasGuidelines.checked;
    const hasExplanation = el.hasExplanation.checked;

    if (!includeInvalid) results = results.filter(row => row.valid_flag === "Y");
    if (elementType) results = results.filter(row => row.element_type === elementType);
    if (element) results = results.filter(row => row.element === element);
    if (component) results = results.filter(row => row.component === component);
    if (csm) results = results.filter(row => row.csm === csm);
    if (reuse) results = results.filter(row => row.reuse_ind === reuse);
    if (hasWording) results = results.filter(row => hasText(row.wording));
    if (hasGuidelines) results = results.filter(row => hasText(row.guidelines));
    if (hasExplanation) results = results.filter(row => hasText(row.explanation));

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
      results.sort((a, b) => {
        const aPriority = Number(
          a.client_priority_score ??
          calculateClientPriorityScore(a, state.currentQuery)
        );

        const bPriority = Number(
          b.client_priority_score ??
          calculateClientPriorityScore(b, state.currentQuery)
        );

        if (bPriority !== aPriority) {
          return bPriority - aPriority;
        }

        return Number(b.search_score || 0) - Number(a.search_score || 0);
      });
    }

    state.displayedResults = results;
    renderResults();
    updateTop5ButtonState();
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
      (state.currentQuery ? ` found for "${state.currentQuery}"` : " shown") +
      (
        state.currentQuery && state.lastSearchUsedAI
          ? " · Hybrid keyword + AI semantic search"
          : state.currentQuery
            ? " · Keyword search"
            : ""
      );

    state.displayedResults.forEach(module => {
      el.resultsGrid.appendChild(createModuleCard(module));
    });
  }

  function createModuleCard(module) {
    const card = document.createElement("article");
    const exactMatch =
      state.currentQuery &&
      String(module.module || "").toLowerCase() === state.currentQuery.toLowerCase();

    card.className =
      "module-card" +
      (module.valid_flag === "N" ? " module-card-invalid" : "") +
      (exactMatch ? " module-card-exact" : "");

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

    if (module.semantic_match) {
      const semanticBadge = document.createElement("span");
      semanticBadge.className = "semantic-badge";
      semanticBadge.textContent =
        module.keyword_match ? "AI boosted" : "Semantic match";
      semanticBadge.title = module.keyword_match
        ? "This result matched both the normal search and the AI semantic search."
        : "This result was found through semantic similarity.";
      numberLine.appendChild(semanticBadge);
    }

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
      ["Module number", module.module, 100],
      ["Module description", module.module_description, 90],
      ["Guidelines", module.guidelines, 80],
      ["Element description", module.element_description, 75],
      ["Explanation", module.explanation, 70],
      ["Wording", module.wording, 60],
      ["Application", module.application, 50],
      ["Element explanation", module.element_explanation, 40]
    ];

    if (!query) {
      for (const [label, value] of fields) {
        if (hasText(value)) return { label, text: value };
      }
      return { label: "", text: "" };
    }

    const phrase = query.trim().toLowerCase();
    const tokens = tokenizeQuery(query);

    const candidates = fields
      .filter(([, value]) => hasText(value))
      .map(([label, value, weight]) => {
        const lower = String(value).toLowerCase();
        const phraseMatch = phrase && lower.includes(phrase);
        const tokenMatches = tokens.filter(token => lower.includes(token)).length;
        const allTokens = tokens.length > 0 && tokenMatches === tokens.length;

        let score = weight;

        if (phraseMatch) score += 1000;
        else if (allTokens) score += 700;
        else score += tokenMatches * 100;

        return {
          label,
          text: value,
          score,
          phraseMatch,
          tokenMatches
        };
      })
      .sort((a, b) => b.score - a.score);

    const best = candidates[0];

    if (!best || (best.tokenMatches === 0 && !best.phraseMatch)) {
      if (module.semantic_match) {
        const semanticPreferredFields = [
          ["Explanation", module.explanation],
          ["Guidelines", module.guidelines],
          ["Module description", module.module_description],
          ["Element description", module.element_description],
          ["Wording", module.wording]
        ];

        for (const [label, value] of semanticPreferredFields) {
          if (hasText(value)) {
            return {
              label: `AI context · ${label}`,
              text: value
            };
          }
        }
      }

      for (const [label, value] of fields) {
        if (hasText(value)) return { label, text: value };
      }

      return { label: "", text: "" };
    }

    return {
      label: best.label,
      text: best.text
    };
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
    const tokens = tokenizeQuery(query);

    if (!tokens.length) {
      container.textContent = text;
      return;
    }

    const escapedTokens = tokens
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp);

    const pattern = new RegExp(`(${escapedTokens.join("|")})`, "gi");

    let cursor = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      container.appendChild(
        document.createTextNode(text.slice(cursor, match.index))
      );

      const mark = document.createElement("mark");
      mark.textContent = match[0];
      container.appendChild(mark);

      cursor = match.index + match[0].length;
    }

    container.appendChild(
      document.createTextNode(text.slice(cursor))
    );
  }

  function calculateClientPriorityScore(module, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return Number(module.search_score || 0);

    const moduleId = String(module.module || "").toLowerCase();
    const description = String(module.module_description || "").toLowerCase();
    const tokens = tokenizeQuery(q);

    if (moduleId === q) return 1000000;
    if (moduleId.startsWith(q)) return 900000;

    if (description.includes(q)) {
      return 800000 + weightedFieldMatchScore(module, tokens);
    }

    const searchable = [
      module.module,
      module.module_description,
      module.guidelines,
      module.element_description,
      module.explanation,
      module.wording,
      module.application,
      module.element_explanation
    ]
      .filter(hasText)
      .join(" ")
      .toLowerCase();

    const allTokensMatch =
      tokens.length > 0 &&
      tokens.every(token => searchable.includes(token));

    if (allTokensMatch) {
      return 700000 + weightedFieldMatchScore(module, tokens);
    }

    const matchedTokens = tokens.filter(token => searchable.includes(token)).length;

    if (matchedTokens > 0) {
      return 600000 +
        matchedTokens * 1000 +
        weightedFieldMatchScore(module, tokens);
    }

    return Number(module.search_score || 0);
  }

  function weightedFieldMatchScore(module, tokens) {
    if (!tokens.length) return 0;

    const fields = [
      [module.module, 100],
      [module.module_description, 90],
      [module.guidelines, 80],
      [module.element_description, 75],
      [module.explanation, 70],
      [module.wording, 60],
      [module.application, 50],
      [module.element_explanation, 40]
    ];

    let total = 0;

    fields.forEach(([value, weight]) => {
      if (!hasText(value)) return;

      const lower = String(value).toLowerCase();

      tokens.forEach(token => {
        if (lower.includes(token)) total += weight;
      });
    });

    return total;
  }

  function tokenizeQuery(query) {
    const rawTokens = String(query || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map(token => token.trim())
      .filter(Boolean);

    const meaningfulTokens = rawTokens.filter(
      token => token.length > 1 && !SEARCH_STOP_WORDS.has(token)
    );

    return Array.from(
      new Set(
        meaningfulTokens.length ? meaningfulTokens : rawTokens
      )
    );
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function hasText(value) {
    return value !== null &&
      value !== undefined &&
      String(value).trim() !== "";
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
    el.hasWording.checked = false;
    el.hasGuidelines.checked = false;
    el.hasExplanation.checked = false;

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
    if (el.hasWording.checked) count++;
    if (el.hasGuidelines.checked) count++;
    if (el.hasExplanation.checked) count++;

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


  function updateTop5ButtonState() {
    if (!el.copyTop5Button) return;

    const count = Math.min(
      5,
      Array.isArray(state.displayedResults)
        ? state.displayedResults.length
        : 0
    );

    el.copyTop5Button.disabled = count === 0;
    el.copyTop5Button.textContent =
      count === 0 ? "Copy Top 5" : `Copy Top ${count}`;
  }

  async function copyTopFive(mode) {
    const topRows = (state.displayedResults || []).slice(0, 5);
    if (!topRows.length) return;

    try {
      const modules = await Promise.all(
        topRows.map(row => fetchFullModule(row.id))
      );

      const validModules = modules.filter(Boolean);

      if (!validModules.length) {
        throw new Error("No modules could be loaded.");
      }

      const richHtml = buildTopFiveHtml(validModules, mode);
      const plainText = buildTopFivePlainText(validModules, mode);

      await copyRichText(richHtml, plainText);

      showCopyConfirmation(
        mode === "full"
          ? `Copied Top ${validModules.length} with full details`
          : `Copied Top ${validModules.length} wording`
      );
    } catch (error) {
      console.error("Top 5 copy failed:", error);
      showCopyConfirmation("Could not copy Top 5");
    }
  }

  function buildTopFivePlainText(modules, mode) {
    return modules
      .map((module, index) => {
        const title =
          module.element_description ||
          module.module_description ||
          "Module";

        const moduleNumber = module.module || "";
        const parts = [
          `${index + 1}. ${title} (${moduleNumber})`
        ];

        if (hasText(module.wording)) {
          parts.push("", readableText(module.wording));
        }

        if (mode === "full") {
          appendPlainSection(parts, "Guidelines", module.guidelines);
          appendPlainSection(parts, "Explanation", module.explanation);
          appendPlainSection(parts, "Application", module.application);
          appendPlainSection(
            parts,
            "Element Explanation",
            module.element_explanation
          );
        }

        return parts.join("\\n");
      })
      .join("\\n\\n----------------------------------------\\n\\n");
  }

  function buildTopFiveHtml(modules, mode) {
    return modules
      .map((module, index) => {
        const title =
          module.element_description ||
          module.module_description ||
          "Module";

        const moduleNumber = module.module || "";

        const sections = [
          `<div><strong>${escapeHtml(
            `${index + 1}. ${title} (${moduleNumber})`
          )}</strong></div>`
        ];

        if (hasText(module.wording)) {
          sections.push(
            `<div style="margin-top:10px;">${formatHtmlText(
              readableText(module.wording)
            )}</div>`
          );
        }

        if (mode === "full") {
          appendHtmlSection(sections, "Guidelines", module.guidelines);
          appendHtmlSection(sections, "Explanation", module.explanation);
          appendHtmlSection(sections, "Application", module.application);
          appendHtmlSection(
            sections,
            "Element Explanation",
            module.element_explanation
          );
        }

        return `<div style="margin-bottom:22px;">${sections.join("")}</div>`;
      })
      .join('<hr style="border:0;border-top:1px solid #ccc;margin:18px 0;">');
  }

  function appendPlainSection(parts, label, value) {
    if (!hasText(value)) return;

    parts.push(
      "",
      `${label}:`,
      readableText(value)
    );
  }

  function appendHtmlSection(parts, label, value) {
    if (!hasText(value)) return;

    parts.push(
      `<div style="margin-top:12px;"><strong>${escapeHtml(label)}:</strong><br>${formatHtmlText(
        readableText(value)
      )}</div>`
    );
  }

  function formatHtmlText(value) {
    return escapeHtml(String(value || ""))
      .replace(/\r\n|\r|\n/g, "<br>");
  }

  async function copyRichText(html, plainText) {
    if (
      navigator.clipboard &&
      window.ClipboardItem &&
      navigator.clipboard.write
    ) {
      try {
        const item = new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" })
        });

        await navigator.clipboard.write([item]);
        return;
      } catch (error) {
        console.warn(
          "Rich clipboard unavailable, falling back to plain text:",
          error
        );
      }
    }

    await navigator.clipboard.writeText(plainText);
  }

  function showCopyConfirmation(message) {
    const existing = document.querySelector(".copy-confirmation");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "copy-confirmation";
    toast.textContent = message;
    document.body.appendChild(toast);

    window.setTimeout(() => {
      toast.remove();
    }, 2200);
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
