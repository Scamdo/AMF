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
    lastSearchUsedAI: false,
    feedbackMemoryAvailable: true,
    currentFeedbackTarget: null,
    isFeedbackApprover: false
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


  function installFeedbackUi() {
    const versionBadge = document.querySelector(".version-badge");
    if (versionBadge) versionBadge.textContent = "v2.3";

    if (!document.getElementById("feedbackAdminButton")) {
      const logoutButton = document.getElementById("logoutButton");
      const button = document.createElement("button");
      button.id = "feedbackAdminButton";
      button.className = "logout-button";
      button.type = "button";
      button.textContent = "Feedback";
      button.hidden = true;
      logoutButton.parentNode.insertBefore(button, logoutButton);
    }

    document.body.insertAdjacentHTML("beforeend", `
      <div id="feedbackModalBackdrop" class="feedback-modal-backdrop" hidden></div>
      <section id="feedbackModal" class="feedback-modal" hidden aria-modal="true" role="dialog">
        <div class="feedback-modal-header">
          <div>
            <h2 id="feedbackModalTitle">Expert feedback</h2>
            <p id="feedbackModalSubtitle">Help improve future module ranking.</p>
          </div>
          <button id="feedbackModalClose" class="drawer-close-button" type="button" aria-label="Close feedback">×</button>
        </div>

        <div id="feedbackEntryView" class="feedback-modal-body">
          <div class="feedback-query-box">
            <span>Search query</span>
            <strong id="feedbackQueryText">-</strong>
          </div>

          <div class="feedback-field">
            <label for="feedbackSuggestedModule">Result being corrected</label>
            <input id="feedbackSuggestedModule" type="text" readonly>
          </div>

          <div class="feedback-field">
            <label for="feedbackBetterModule">Better module</label>
            <input id="feedbackBetterModule" type="text" placeholder="e.g. 43100.00" autocomplete="off">
            <div id="feedbackBetterModuleHint" class="feedback-hint"></div>
          </div>

          <div class="feedback-field">
            <label for="feedbackComment">Expert comment <span>(optional)</span></label>
            <textarea id="feedbackComment" rows="4" placeholder="Why is this module a better answer?"></textarea>
          </div>

          <div class="feedback-modal-actions">
            <button id="feedbackCancelButton" class="secondary-button" type="button">Cancel</button>
            <button id="feedbackSubmitButton" class="primary-button compact-button" type="button">Save feedback</button>
          </div>
        </div>

        <div id="feedbackAdminView" class="feedback-modal-body" hidden>
          <div class="feedback-admin-toolbar">
            <div>
              <strong>Pending expert feedback</strong>
              <p>Only approved feedback can influence ranking.</p>
            </div>
            <button id="feedbackRefreshButton" class="secondary-button" type="button">Refresh</button>
          </div>
          <div id="feedbackAdminList" class="feedback-admin-list"></div>
        </div>
      </section>`);

    const style = document.createElement("style");
    style.textContent = `
      .feedback-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border-soft)}
      .feedback-good-button,.feedback-better-button{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);padding:7px 10px;font-size:12px;font-weight:700}
      .feedback-good-button:hover{border-color:#2e8b57;color:#1f6b43}
      .feedback-better-button:hover{border-color:var(--red);color:var(--red)}
      .feedback-memory-badge{display:inline-flex;align-items:center;min-height:24px;padding:2px 8px;border-radius:999px;border:1px solid rgba(46,139,87,.22);background:rgba(46,139,87,.07);color:#1f6b43;font-size:11px;font-weight:800;white-space:nowrap}
      .feedback-modal-backdrop{position:fixed;inset:0;z-index:290;background:rgba(0,0,0,.32)}
      .feedback-modal{position:fixed;left:50%;top:50%;z-index:300;width:min(760px,calc(100vw - 32px));max-height:min(820px,calc(100vh - 40px));transform:translate(-50%,-50%);overflow:hidden;border:1px solid var(--border-soft);border-top:5px solid var(--red);border-radius:var(--radius-lg);background:var(--surface);box-shadow:0 22px 60px rgba(0,0,0,.20)}
      .feedback-modal-header{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;padding:22px 24px 18px;border-bottom:1px solid var(--border-soft)}
      .feedback-modal-header h2{margin:0;color:var(--text-dark);font-size:20px}
      .feedback-modal-header p{margin:4px 0 0;color:var(--text-soft);font-size:12px}
      .feedback-modal-body{padding:22px 24px 24px;overflow:auto;max-height:calc(100vh - 150px)}
      .feedback-query-box{padding:12px 14px;margin-bottom:18px;border-radius:var(--radius-sm);background:var(--surface-soft)}
      .feedback-query-box span{display:block;color:var(--text-soft);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
      .feedback-query-box strong{color:var(--text-dark);font-size:13px}
      .feedback-field{margin-bottom:16px}
      .feedback-field label{display:block;margin-bottom:6px;color:var(--text);font-size:12px;font-weight:700}
      .feedback-field label span{color:var(--text-soft);font-weight:400}
      .feedback-field input,.feedback-field textarea{width:100%;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text-dark);padding:10px 11px;outline:none}
      .feedback-field input:focus,.feedback-field textarea:focus{border-color:var(--red);box-shadow:0 0 0 3px rgba(220,0,40,.08)}
      .feedback-field input[readonly]{background:var(--surface-soft);color:var(--text-soft)}
      .feedback-hint{min-height:18px;margin-top:5px;color:var(--text-soft);font-size:11px}
      .feedback-hint-ok{color:var(--success-text)}
      .feedback-hint-error{color:var(--danger-text)}
      .feedback-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
      .feedback-admin-toolbar{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:14px}
      .feedback-admin-toolbar p{margin:3px 0 0;color:var(--text-soft);font-size:12px}
      .feedback-admin-list{display:grid;gap:10px}
      .feedback-admin-card{border:1px solid var(--border-soft);border-radius:var(--radius-md);padding:14px;background:var(--surface-soft)}
      .feedback-admin-card h3{margin:0 0 7px;color:var(--text-dark);font-size:14px}
      .feedback-admin-card p{margin:5px 0;font-size:12px}
      .feedback-admin-meta{color:var(--text-soft);font-size:11px}
      .feedback-admin-actions{display:flex;gap:8px;margin-top:12px}
      .feedback-admin-empty{padding:22px;text-align:center;color:var(--text-soft);border:1px dashed var(--border);border-radius:var(--radius-md);font-size:13px}
      @media(max-width:620px){
        .feedback-modal-header,.feedback-modal-body{padding-left:18px;padding-right:18px}
        .feedback-admin-toolbar{flex-direction:column}
      }`;
    document.head.appendChild(style);

    Object.assign(el, {
      feedbackAdminButton: document.getElementById("feedbackAdminButton"),
      feedbackModalBackdrop: document.getElementById("feedbackModalBackdrop"),
      feedbackModal: document.getElementById("feedbackModal"),
      feedbackModalTitle: document.getElementById("feedbackModalTitle"),
      feedbackModalSubtitle: document.getElementById("feedbackModalSubtitle"),
      feedbackModalClose: document.getElementById("feedbackModalClose"),
      feedbackEntryView: document.getElementById("feedbackEntryView"),
      feedbackAdminView: document.getElementById("feedbackAdminView"),
      feedbackQueryText: document.getElementById("feedbackQueryText"),
      feedbackSuggestedModule: document.getElementById("feedbackSuggestedModule"),
      feedbackBetterModule: document.getElementById("feedbackBetterModule"),
      feedbackBetterModuleHint: document.getElementById("feedbackBetterModuleHint"),
      feedbackComment: document.getElementById("feedbackComment"),
      feedbackCancelButton: document.getElementById("feedbackCancelButton"),
      feedbackSubmitButton: document.getElementById("feedbackSubmitButton"),
      feedbackRefreshButton: document.getElementById("feedbackRefreshButton"),
      feedbackAdminList: document.getElementById("feedbackAdminList")
    });

    el.feedbackModalClose.addEventListener("click", closeFeedbackModal);
    el.feedbackModalBackdrop.addEventListener("click", closeFeedbackModal);
    el.feedbackCancelButton.addEventListener("click", closeFeedbackModal);
    el.feedbackSubmitButton.addEventListener("click", submitBetterModuleFeedback);
    el.feedbackBetterModule.addEventListener("input", validateBetterModuleInput);
    el.feedbackAdminButton.addEventListener("click", openFeedbackAdmin);
    el.feedbackRefreshButton.addEventListener("click", loadPendingFeedback);
  }

  async function init() {
    installFeedbackUi();
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
      await checkFeedbackApprover();
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
      const feedbackMemoryPromise = runFeedbackMemorySearch(query);

      const [keywordResult, semanticResult, feedbackMemoryResult] = await Promise.allSettled([
        keywordPromise,
        semanticPromise,
        feedbackMemoryPromise
      ]);

      let keywordRows = [];
      let semanticRows = [];
      let feedbackMemoryRows = [];

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

      if (feedbackMemoryResult.status === "fulfilled") {
        feedbackMemoryRows = feedbackMemoryResult.value || [];
        state.feedbackMemoryAvailable = true;
      } else {
        console.warn("Feedback memory unavailable:", feedbackMemoryResult.reason);
        state.feedbackMemoryAvailable = false;
      }

      state.rawResults = mergeHybridResults(keywordRows, semanticRows, query, feedbackMemoryRows);

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

  function mergeHybridResults(keywordRows, semanticRows, query, feedbackMemoryRows = []) {
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

    const feedbackByModule = new Map();

    feedbackMemoryRows.forEach(memory => {
      const moduleId = String(memory.preferred_module_id || "");
      if (!moduleId) return;

      const existing = feedbackByModule.get(moduleId);
      if (
        !existing ||
        Number(memory.feedback_similarity || 0) > Number(existing.feedback_similarity || 0)
      ) {
        feedbackByModule.set(moduleId, memory);
      }
    });

    feedbackByModule.forEach((memory, moduleId) => {
      const memorySimilarity = Number(memory.feedback_similarity || 0);
      const existing = merged.get(moduleId);

      if (existing) {
        merged.set(moduleId, {
          ...existing,
          feedback_memory_match: true,
          feedback_memory_similarity: memorySimilarity,
          feedback_module_similarity: Number(memory.module_similarity || 0),
          feedback_candidate_injected: false
        });
        return;
      }

      const metadataRow = state.allMetadata.find(
        row => String(row.id) === moduleId
      );

      if (!metadataRow) return;

      merged.set(moduleId, {
        ...metadataRow,
        search_score: 0,
        keyword_rank: null,
        keyword_match: false,
        semantic_match: false,
        semantic_similarity: null,
        semantic_rank: null,
        feedback_memory_match: true,
        feedback_memory_similarity: memorySimilarity,
        feedback_module_similarity: Number(memory.module_similarity || 0),
        feedback_candidate_injected: true
      });
    });

    return Array.from(merged.values()).map(row => ({
      ...row,
      client_priority_score: calculateHybridPriorityScore(row, query)
    }));
  }

  function calculateHybridPriorityScore(module, query) {
    const q = String(query || "").trim().toLowerCase();
    const moduleId = String(module.module || "").toLowerCase();

    // Exact module navigation always wins.
    if (moduleId === q) return 1000000;
    if (moduleId.startsWith(q)) return 900000;

    const meaningfulTokens = tokenizeQuery(query);
    const naturalLanguageQuery = meaningfulTokens.length >= 4;

    const keywordScore = calculateClientPriorityScore(module, query);
    const similarity = Number(module.semantic_similarity || 0);
    const semanticRank = Number(module.semantic_rank || 50);

    /*
      v1.8:
      Natural-language searches are ranked by semantic similarity.
      The semantic score is deliberately scaled so that a 1 percentage-point
      similarity difference is worth more than any keyword tie-breaker.
      Keyword matching therefore cannot reverse a genuine semantic advantage.
    */
    if (naturalLanguageQuery) {
      /*
        v2.3:
        Expert Memory is driven primarily by similarity to the approved expert
        CASE, not by the preferred module's generic semantic profile.

        This is deliberate: module embeddings can contain broad insurance
        language and are therefore only a secondary safety check.
      */
      if (module.feedback_memory_match) {
        const feedbackSimilarity =
          Number(module.feedback_memory_similarity || 0);
        const moduleSimilarity =
          Number(module.feedback_module_similarity || 0);

        if (
          feedbackSimilarity >= 0.84 &&
          moduleSimilarity >= 0.30
        ) {
          const caseStrength =
            Math.max(0, Math.min(1, (feedbackSimilarity - 0.84) / 0.16));

          const expertBoost =
            70000 + Math.round(caseStrength * 70000);

          const baseSemantic =
            module.semantic_match
              ? similarity
              : moduleSimilarity;

          const memoryScore =
            600000 +
            Math.round(baseSemantic * 300000) +
            expertBoost;

          if (!module.semantic_match) {
            return memoryScore;
          }

          const semanticScoreForComparison =
            600000 + Math.round(similarity * 300000);

          if (memoryScore > semanticScoreForComparison) {
            return memoryScore;
          }
        }
      }

      if (module.semantic_match) {
        const semanticScore =
          600000 + Math.round(similarity * 300000);

        // Maximum 1,000 points. A 1% semantic difference is worth ~3,000.
        const keywordTieBreaker = module.keyword_match
          ? Math.min(
              1000,
              Math.max(0, Math.round(keywordScore / 300))
            )
          : 0;

        // Only resolves extremely close scores.
        const semanticRankTieBreaker =
          Math.max(0, 100 - semanticRank);

        return semanticScore +
          keywordTieBreaker +
          semanticRankTieBreaker;
      }

      // Keyword-only results remain available below semantic matches.
      if (module.keyword_match) {
        return 350000 +
          Math.min(keywordScore, 120000);
      }

      return keywordScore;
    }

    /*
      Short / structured searches keep keyword-first behaviour:
      module IDs, CRM, China, Dutch law, etc.
    */
    if (module.keyword_match) {
      const semanticBoost = module.semantic_match
        ? Math.round(similarity * 40000)
        : 0;

      return keywordScore + semanticBoost;
    }

    if (module.semantic_match) {
      return 300000 +
        Math.round(similarity * 100000) +
        Math.max(0, 1000 - semanticRank * 20);
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

      const similarityBadge = document.createElement("span");
      similarityBadge.className = "ai-similarity-badge";
      similarityBadge.textContent =
        `AI match: ${formatSimilarityPercent(module.semantic_similarity)}`;
      similarityBadge.title =
        "Diagnostic semantic similarity score used for ranking.";
      numberLine.appendChild(similarityBadge);
    }

    if (module.feedback_memory_match) {
      const memoryBadge = document.createElement("span");
      memoryBadge.className = "feedback-memory-badge";
      memoryBadge.textContent = module.feedback_candidate_injected
        ? "Expert candidate"
        : "Expert learned";
      const feedbackPct = Math.round(
        Number(module.feedback_memory_similarity || 0) * 100
      );
      const modulePct = Math.round(
        Number(module.feedback_module_similarity || 0) * 100
      );

      memoryBadge.title = module.feedback_candidate_injected
        ? `Expert candidate - previous case ${feedbackPct}% · module relevance ${modulePct}%`
        : `Expert learned - previous case ${feedbackPct}% · module relevance ${modulePct}%`;
      numberLine.appendChild(memoryBadge);
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

    if (state.currentQuery) {
      const feedbackActions = document.createElement("div");
      feedbackActions.className = "feedback-actions";

      const goodButton = document.createElement("button");
      goodButton.type = "button";
      goodButton.className = "feedback-good-button";
      goodButton.textContent = "👍 Good match";
      goodButton.addEventListener("click", async event => {
        event.stopPropagation();
        await submitGoodMatchFeedback(module);
      });

      const betterButton = document.createElement("button");
      betterButton.type = "button";
      betterButton.className = "feedback-better-button";
      betterButton.textContent = "🎯 Better module";
      betterButton.addEventListener("click", event => {
        event.stopPropagation();
        openBetterModuleFeedback(module);
      });

      feedbackActions.append(goodButton, betterButton);
      card.appendChild(feedbackActions);
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

  function formatSimilarityPercent(value) {
    const similarity = Number(value || 0);

    if (!Number.isFinite(similarity)) {
      return "0%";
    }

    return `${Math.round(similarity * 100)}%`;
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
        const blocks = [
          `${index + 1}. ${title} (${moduleNumber})`
        ];

        if (hasText(module.wording)) {
          blocks.push(readableText(module.wording).trim());
        }

        if (mode === "full") {
          appendPlainSection(blocks, "Guidelines", module.guidelines);
          appendPlainSection(blocks, "Explanation", module.explanation);
          appendPlainSection(blocks, "Application", module.application);
          appendPlainSection(
            blocks,
            "Element Explanation",
            module.element_explanation
          );
        }

        return blocks.join("\n\n");
      })
      .join("\n\n\n----------------------------------------\n\n\n");
  }

  function buildTopFiveHtml(modules, mode) {
    return modules
      .map((module, index) => {
        const title =
          module.element_description ||
          module.module_description ||
          "Module";

        const moduleNumber = module.module || "";
        const sections = [];

        sections.push(
          `<strong>${escapeHtml(
            `${index + 1}. ${title} (${moduleNumber})`
          )}</strong>`
        );

        if (hasText(module.wording)) {
          sections.push(
            formatHtmlText(readableText(module.wording).trim())
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

        /*
          Use explicit <br><br> rather than relying on CSS margins.
          Word / Outlook / Teams can strip or collapse clipboard CSS.
        */
        return sections.join("<br><br>");
      })
      .join("<br><br><hr><br><br>");
  }

  function appendPlainSection(blocks, label, value) {
    if (!hasText(value)) return;

    blocks.push(
      `${label}:\n\n${readableText(value).trim()}`
    );
  }

  function appendHtmlSection(blocks, label, value) {
    if (!hasText(value)) return;

    blocks.push(
      `<strong>${escapeHtml(label)}:</strong><br><br>${formatHtmlText(
        readableText(value).trim()
      )}`
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


  async function checkFeedbackApprover() {
    try {
      const { data, error } = await db
        .from("feedback_approvers")
        .select("user_id")
        .eq("user_id", state.currentUser.id)
        .maybeSingle();

      if (error) throw error;
      state.isFeedbackApprover = Boolean(data);
      el.feedbackAdminButton.hidden = !state.isFeedbackApprover;
    } catch (error) {
      console.warn("Feedback approver check unavailable:", error);
      state.isFeedbackApprover = false;
      el.feedbackAdminButton.hidden = true;
    }
  }

  async function runFeedbackMemorySearch(query) {
    const { data, error } = await db.functions.invoke("amf-feedback", {
      body: { action: "match", query, match_count: 10 }
    });

    if (error) throw error;
    if (!data || !Array.isArray(data.results)) return [];

    /*
      v2.3:
      Previous-case similarity is now calculated correctly by the backend.
      Expert Memory only enters the candidate set when the CURRENT query is
      genuinely close to the approved expert case.

      Module relevance is retained as a secondary diagnostic / safety signal.
    */
    return data.results.filter(row => {
      const feedbackSimilarity = Number(row.feedback_similarity || 0);
      const moduleSimilarity = Number(row.module_similarity || 0);

      return (
        feedbackSimilarity >= 0.84 &&
        moduleSimilarity >= 0.30
      );
    });
  }

  function buildSearchSnapshot() {
    return (state.displayedResults || []).slice(0, 5).map((row, index) => ({
      rank: index + 1,
      id: row.id,
      module: row.module || "",
      module_description: row.module_description || "",
      semantic_similarity: Number(row.semantic_similarity || 0),
      client_priority_score: Number(row.client_priority_score || 0)
    }));
  }

  async function submitGoodMatchFeedback(module) {
    try {
      const { data, error } = await db.functions.invoke("amf-feedback", {
        body: {
          action: "submit",
          feedback_type: "good_match",
          query: state.currentQuery,
          shown_module_id: module.id,
          preferred_module_id: module.id,
          comment: "",
          results_snapshot: buildSearchSnapshot()
        }
      });
      if (error) throw error;
      if (!data || !data.success) throw new Error("Feedback was not saved.");
      showToast("Feedback saved for review");
    } catch (error) {
      console.error(error);
      showToast("Could not save feedback");
    }
  }

  function openBetterModuleFeedback(module) {
    state.currentFeedbackTarget = module;
    el.feedbackModalTitle.textContent = "Better module";
    el.feedbackModalSubtitle.textContent = "Suggest a better result. It will not influence ranking until approved.";
    el.feedbackEntryView.hidden = false;
    el.feedbackAdminView.hidden = true;
    el.feedbackQueryText.textContent = state.currentQuery || "-";
    el.feedbackSuggestedModule.value = module.module || "";
    el.feedbackBetterModule.value = "";
    el.feedbackComment.value = "";
    el.feedbackBetterModuleHint.textContent = "";
    el.feedbackBetterModuleHint.className = "feedback-hint";
    openFeedbackModal();
    window.setTimeout(() => el.feedbackBetterModule.focus(), 80);
  }

  async function validateBetterModuleInput() {
    const value = el.feedbackBetterModule.value.trim();
    el.feedbackBetterModuleHint.className = "feedback-hint";

    if (!value) {
      el.feedbackBetterModuleHint.textContent = "";
      return null;
    }

    const module = state.allMetadata.find(
      row => String(row.module || "").toLowerCase() === value.toLowerCase()
    );

    if (!module) {
      el.feedbackBetterModuleHint.textContent = "Module not found.";
      el.feedbackBetterModuleHint.classList.add("feedback-hint-error");
      return null;
    }

    if (module.valid_flag !== "Y") {
      el.feedbackBetterModuleHint.textContent = "Module is invalid / obsolete.";
      el.feedbackBetterModuleHint.classList.add("feedback-hint-error");
      return null;
    }

    el.feedbackBetterModuleHint.textContent =
      module.module_description || "Valid module found.";
    el.feedbackBetterModuleHint.classList.add("feedback-hint-ok");
    return module;
  }

  async function submitBetterModuleFeedback() {
    if (!state.currentFeedbackTarget || !state.currentQuery) return;
    const preferred = await validateBetterModuleInput();
    if (!preferred) {
      showToast("Choose a valid module");
      return;
    }

    el.feedbackSubmitButton.disabled = true;
    el.feedbackSubmitButton.textContent = "Saving...";

    try {
      const { data, error } = await db.functions.invoke("amf-feedback", {
        body: {
          action: "submit",
          feedback_type: "better_module",
          query: state.currentQuery,
          shown_module_id: state.currentFeedbackTarget.id,
          preferred_module_id: preferred.id,
          comment: el.feedbackComment.value.trim(),
          results_snapshot: buildSearchSnapshot()
        }
      });
      if (error) throw error;
      if (!data || !data.success) throw new Error("Feedback was not saved.");
      closeFeedbackModal();
      showToast("Feedback saved for review");
    } catch (error) {
      console.error(error);
      showToast("Could not save feedback");
    } finally {
      el.feedbackSubmitButton.disabled = false;
      el.feedbackSubmitButton.textContent = "Save feedback";
    }
  }

  function openFeedbackModal() {
    el.feedbackModalBackdrop.hidden = false;
    el.feedbackModal.hidden = false;
  }

  function closeFeedbackModal() {
    el.feedbackModalBackdrop.hidden = true;
    el.feedbackModal.hidden = true;
    state.currentFeedbackTarget = null;
  }

  async function openFeedbackAdmin() {
    if (!state.isFeedbackApprover) return;
    el.feedbackModalTitle.textContent = "Feedback review";
    el.feedbackModalSubtitle.textContent = "Approve only feedback that should influence future ranking.";
    el.feedbackEntryView.hidden = true;
    el.feedbackAdminView.hidden = false;
    openFeedbackModal();
    await loadPendingFeedback();
  }

  async function loadPendingFeedback() {
    el.feedbackAdminList.innerHTML = '<div class="feedback-admin-empty">Loading...</div>';

    try {
      const { data, error } = await db
        .from("module_feedback")
        .select("id,query_text,comment,created_at,created_by_email,shown_module_id,preferred_module_id")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      const ids = Array.from(new Set(
        (data || []).flatMap(row => [row.shown_module_id, row.preferred_module_id]).filter(Boolean)
      ));
      const modulesById = new Map();

      if (ids.length) {
        const { data: modules, error: modulesError } = await db
          .from("modules")
          .select("id,module,module_description")
          .in("id", ids);

        if (modulesError) throw modulesError;
        (modules || []).forEach(module => modulesById.set(String(module.id), module));
      }

      renderPendingFeedback(data || [], modulesById);
    } catch (error) {
      console.error(error);
      el.feedbackAdminList.innerHTML =
        '<div class="feedback-admin-empty">Could not load feedback.</div>';
    }
  }

  function renderPendingFeedback(rows, modulesById) {
    el.feedbackAdminList.innerHTML = "";

    if (!rows.length) {
      el.feedbackAdminList.innerHTML =
        '<div class="feedback-admin-empty">No pending feedback.</div>';
      return;
    }

    rows.forEach(row => {
      const shownModule = modulesById.get(String(row.shown_module_id));
      const preferredModule = modulesById.get(String(row.preferred_module_id));
      const shown = shownModule
        ? `${shownModule.module} - ${shownModule.module_description || ""}`
        : "-";
      const preferred = preferredModule
        ? `${preferredModule.module} - ${preferredModule.module_description || ""}`
        : "-";

      const card = document.createElement("article");
      card.className = "feedback-admin-card";

      const title = document.createElement("h3");
      title.textContent = row.query_text || "Search feedback";

      const details = document.createElement("div");
      details.innerHTML =
        `<p><strong>Shown:</strong> ${escapeHtml(shown)}</p>` +
        `<p><strong>Preferred:</strong> ${escapeHtml(preferred)}</p>` +
        (row.comment
          ? `<p><strong>Comment:</strong> ${escapeHtml(row.comment)}</p>`
          : "") +
        `<p class="feedback-admin-meta">${escapeHtml(row.created_by_email || "")} · ${escapeHtml(new Date(row.created_at).toLocaleString())}</p>`;

      const actions = document.createElement("div");
      actions.className = "feedback-admin-actions";

      [["approved", "Approve"], ["rejected", "Reject"]].forEach(([decision, label]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className =
          decision === "approved"
            ? "primary-button compact-button"
            : "secondary-button";
        button.textContent = label;
        button.addEventListener("click", () => reviewFeedback(row.id, decision));
        actions.appendChild(button);
      });

      card.append(title, details, actions);
      el.feedbackAdminList.appendChild(card);
    });
  }

  async function reviewFeedback(feedbackId, decision) {
    try {
      const { data, error } = await db.functions.invoke("amf-feedback", {
        body: { action: "review", feedback_id: feedbackId, decision }
      });
      if (error) throw error;
      if (!data || !data.success) throw new Error("Review failed.");

      showToast(decision === "approved" ? "Feedback approved" : "Feedback rejected");
      await loadPendingFeedback();
    } catch (error) {
      console.error(error);
      showToast("Could not review feedback");
    }
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