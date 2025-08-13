(() => {
  const state = {
    enabled: false,
    observer: null,
    seen: new WeakSet(),
    inDialog: false,
  };

  const qsa = (root, sel) => Array.from(root.querySelectorAll(sel));
  const on = (el, ev, cb, opts) => el.addEventListener(ev, cb, opts || false);
  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  const placeholders = (s) =>
    Array.from(new Set((s || "").match(/\{\d+\}/g) || [])).sort();
  const samePlaceholders = (a, b) =>
    placeholders(a).join("|") === placeholders(b).join("|");

  const getLang = () =>
    (frappe.boot && (frappe.boot.lang || frappe.boot.lang_code)) ||
    (frappe.boot?.user && frappe.boot.user.language) ||
    "en";

  const currentRoute = () => {
    try {
      return (frappe.get_route && frappe.get_route().join("/")) || "";
    } catch {
      return "";
    }
  };

  function looksEnglish(s) {
    const str = (s || "").trim();
    if (!str) return false;
    const hasLatin = /[A-Za-z]/.test(str);
    const hasNonASCII = /[^\x00-\x7F]/.test(str);
    return hasLatin && !hasNonASCII;
  }

  const ALLOWED = [
    ".page-title",
    ".form-section .section-head",
    ".form-tabs .nav-link",
    ".modal-title",

    ".frappe-control .label-area .label",
    ".frappe-control .control-label",
    ".frappe-control label",
    ".control-label",
    ".checkbox label",
    ".checkbox .label-area .label",

    ".page-actions .btn",
    ".form-actions .btn",
    ".std-form-actions .btn",
    ".modal .modal-footer .btn",

    ".layout-side-section .sidebar-item-label",
    ".layout-side-section .sidebar-label",
    '.layout-side-section a:not(.btn):not([role="img"])',
    ".layout-side-section .btn-link",
    ".form-sidebar-items .add-assignment-label .ellipsis",
    ".form-sidebar-items .add-assignment-label",
    ".form-sidebar-items .tags-label.ellipsis",
    ".form-sidebar-items .tags-label",
    ".form-sidebar-items .share-label .ellipsis",
    ".form-sidebar-items .share-label",

    ".desk-page .ce-header .h4 b",
    ".desk-page .shortcut-widget-box .widget-title",
    ".desk-page .shortcut-widget-box .widget-title .ellipsis",
    ".desk-page .shortcut-widget-box [aria-label]",
    ".desk-page .shortcut-widget-box [aria-label] .ellipsis",
    ".desk-page .links-widget-box .link-item .link-text",
    ".desk-page .links-widget .link-item .link-text",
    ".desk-page .link-item .link-content .link-text",
  ].join(",");

  const EXCLUDE_CONTAINERS = [
    ".result",
    ".list-row",
    ".list-row-container",
    ".list-view-container",
    ".datatable",
    ".dt",
    ".grid-body",
    ".grid-row",
    ".grid-heading-row",
    ".timeline",
    ".comment-box",
    ".comment",
    ".activity-row",
    ".awesomplete",
    ".ql-editor",
    ".ql-toolbar",
    ".control-input",
    ".control-value",
    ".filter-selector",
    ".tag-pill",
    ".avatar-group",
    ".image-view",
    ".btn-group",
    ".dropdown-menu",
    ".modal.inctx-dialog",
    ".modal.inctx-dialog *",
    ".inctx-wrap",
    ".inctx-pencil",
  ].join(",");

  const isInsideExcludedContainer = (el) => !!el.closest(EXCLUDE_CONTAINERS);

  const isUsableText = (txt) => {
    const s = (txt || "").trim();
    if (!s) return false;
    if (s === "..." || s === "…") return false;
    if (s.length <= 1 && /[^\w\u0600-\u06FF]/.test(s)) return false;
    return true;
  };

  const hasTranslatableChild = (el) => !!el.querySelector(ALLOWED);

  const isTranslatable = (el) => {
    if (!el) return false;
    if (!el.matches(ALLOWED)) return false;
    if (isInsideExcludedContainer(el)) return false;
    if (el.classList.contains("inctx-has-pencil")) return false;
    if (hasTranslatableChild(el)) return false;
    return isUsableText(el.innerText);
  };

  function extractContext(el) {
    const ctrl = el.closest(".frappe-control");
    let doctype = "";
    let fieldname = "";

    if (ctrl) {
      doctype = ctrl.getAttribute("data-doctype") || "";
      fieldname = ctrl.getAttribute("data-fieldname") || "";
    }
    if (!doctype) {
      const formEl =
        el.closest("form[doctype]") || document.querySelector("form[doctype]");
      if (formEl) doctype = formEl.getAttribute("doctype") || "";
    }
    if (!fieldname) {
      const withField = el.closest("[data-fieldname]");
      if (withField) fieldname = withField.getAttribute("data-fieldname") || "";
    }
    return { route: currentRoute(), doctype, fieldname };
  }

  function attachPencil(el) {
    const wrap = document.createElement("span");
    wrap.className = "inctx-wrap";
    const pencil = document.createElement("span");
    pencil.className = "inctx-pencil";
    pencil.title = __("Translate this text");
    pencil.textContent = "✏️";
    on(pencil, "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDialogFor(el);
    });
    el.classList.add("inctx-has-pencil");
    el.after(wrap);
    wrap.appendChild(pencil);
    state.seen.add(el);
  }

  function removeAllPencils() {
    qsa(document, ".inctx-pencil").forEach((n) => n.remove());
    qsa(document, ".inctx-has-pencil").forEach((n) =>
      n.classList.remove("inctx-has-pencil")
    );
    state.seen = new WeakSet();
  }

  const doScan = () => {
    if (!state.enabled || state.inDialog) return;
    qsa(document, ALLOWED).forEach((el) => {
      if (!state.seen.has(el) && isTranslatable(el)) attachPencil(el);
    });
  };
  const queueScan = debounce(doScan, 60);

  function observeDOM() {
    if (state.observer) state.observer.disconnect();
    state.observer = new MutationObserver((muts) => {
      if (!state.enabled || state.inDialog) return;
      for (const m of muts) {
        if ((m.addedNodes && m.addedNodes.length) || m.type === "attributes") {
          queueScan();
          break;
        }
      }
    });
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  }

  async function openDialogFor(el) {
    const displayed = (el.innerText || "").trim();
    const context = extractContext(el);
    const targetLang = getLang();

    let resolved = {};
    try {
      const resp = await frappe.call({
        method: "incontext_translation.api.resolve_source_and_existing",
        args: { displayed, context, target_lang: targetLang },
      });
      resolved = resp?.message || {};
    } catch (e) {
      console.error("[inctx] resolve_source_and_existing failed", e);
      resolved = { source: "", candidates: [], existing: "", lang: targetLang };
    }

    let sourceResolved = resolved.source || "";
    const candidates = Array.isArray(resolved.candidates)
      ? resolved.candidates
      : [];
    if (!sourceResolved && candidates.length) sourceResolved = candidates[0];

    const existing = resolved.existing || "";
    const lang = resolved.lang || targetLang;

    let defaultSource = sourceResolved || "";
    let defaultTranslated = existing || "";
    if (!defaultTranslated) {
      if (!defaultSource && looksEnglish(displayed)) {
        defaultSource = displayed;
        defaultTranslated = "";
      } else {
        defaultTranslated = displayed;
      }
    }

    state.inDialog = true;

    const d = new frappe.ui.Dialog({
      title: __("Add / Update Translation"),
      fields: [
        {
          fieldname: "language",
          label: __("Language"),
          fieldtype: "Link",
          options: "Language",
          default: lang,
          reqd: 1,
        },
        {
          fieldname: "source_text",
          label: __("Source Text"),
          fieldtype: "Small Text",
          read_only: 0,
          default: defaultSource,
          reqd: 1,
        },

        {
          fieldname: "translated_text",
          label: __("Translated Text"),
          fieldtype: "Small Text",
          default: defaultTranslated,
          reqd: 1,
        },
        {
          fieldname: "use_context",
          label: __("Use Context"),
          fieldtype: "Check",
          default: 0,
        },
        {
          fieldname: "context",
          label: __("Context (optional)"),
          fieldtype: "Data",
          default: context.route,
          read_only: 1,
        },
      ],
      primary_action_label: __("Save"),
      primary_action: async (vals) => {
        const src = (vals.source_text || "").trim();
        const dst = (vals.translated_text || "").trim();
        const lng = vals.language || lang;
        const ctx = vals.use_context ? (vals.context || "").trim() : "";

        if (!src || !dst) {
          frappe.msgprint(__("Source and translation are required."));
          return;
        }
        if (!samePlaceholders(src, dst)) {
          frappe.msgprint(
            __(
              "Placeholders in source and translation must match, e.g. {0}, {1}."
            )
          );
          return;
        }

        try {
          await frappe.call({
            method: "incontext_translation.api.save_custom_translation",
            args: {
              language: lng,
              source_text: src,
              translated_text: dst,
              context: ctx,
            },
          });
          d.hide();
          frappe.show_alert({
            message: __("Saved translation."),
            indicator: "green",
          });
          el.innerText = dst;
        } catch (e) {
          console.error("[inctx] save_custom_translation failed", e);
          frappe.msgprint(
            __("Could not save translation. Check permissions and try again.")
          );
        }
      },
    });

    d.$wrapper.addClass("inctx-dialog");
    d.$wrapper.on("shown.bs.modal", () => {
      const useField = d.get_field("use_context");
      const ctxField = d.get_field("context");
      const translatedTextField = d.get_field("translated_text");
      const labelContainer = translatedTextField.label_area;
      const parintEl = labelContainer.parentElement;
      const suggestionIcon = $(`<span class="inctx-suggest-icon" title="${__(
        "Suggest Translation"
      )}">
          <i class="fa fa-magic"></i>
      </span>`).appendTo(parintEl);

      suggestionIcon.tooltip({
        placement: "top",
        delay: { show: 600, hide: 100 },
      });
      on(suggestionIcon[0], "click", async () => {
        const sourceText = d.get_value("source_text");
        const targetLang = d.get_value("language");

        if (!sourceText) {
          frappe.msgprint(__("Please enter the source text first."));
          return;
        }

        const translatedTextField = d.get_field("translated_text");
        const inputArea = translatedTextField.input_area;
        const loader = $('<div class="inctx-loader"></div>').appendTo(
          inputArea
        );

        const showErrorEffect = () => {
          const input = translatedTextField.input_area;
          input.classList.add("inctx-shake");
          setTimeout(() => input.classList.remove("inctx-shake"), 820);
        };

        try {
          const response = await frappe.call({
            method: "incontext_translation.api.suggest_translation",
            args: {
              source_text: sourceText,
              target_lang: targetLang,
            },
          });

          if (response.message) {
            d.set_value("translated_text", response.message);
          } else {
            showErrorEffect();
            frappe.show_alert({
              message: __("Could not get a suggestion."),
              indicator: "orange",
            });
          }
        } catch (e) {
          console.error("suggest translation failed", e);
          showErrorEffect();
          frappe.show_alert({
            message: __(
              "An error occurred. Please check your connection and try again."
            ),

            indicator: "red",
          });
        } finally {
          loader.remove();
        }
      });
      const apply = () => {
        const on = !!d.get_value("use_context");
        d.set_df_property("context", "read_only", !on);
        if (ctxField?.refresh) ctxField.refresh();
        if (ctxField?.$input) ctxField.$input.prop("disabled", !on);
      };

      if (useField?.$input) useField.$input.on("click change input", apply);
      apply();
    });

    d.onhide = () => {
      state.inDialog = false;
      queueScan();
    };
    d.show();
  }

  function toggleMode(on) {
    state.enabled = on;
    document.documentElement.toggleAttribute("data-inctx", on);

    frappe.show_alert({
      message: on ? __("Translation Mode ON") : __("Translation Mode OFF"),
      indicator: on ? "green" : "orange",
    });

    qsa(document, ".inctx-menu-item").forEach((a) => {
      a.textContent = on
        ? __("Disable Translation Mode")
        : __("Enable Translation Mode");
    });

    if (on) {
      queueScan();
      observeDOM();
    } else {
      if (state.observer) state.observer.disconnect();
      removeAllPencils();
    }
  }

  function tryInjectInTopbarDropdowns() {
    qsa(document, ".navbar .dropdown-menu.show").forEach((menuEl) => {
      if (menuEl.querySelector(".inctx-menu-item")) return;

      const item = document.createElement("a");
      item.href = "#";
      item.className = "dropdown-item inctx-menu-item";
      item.textContent = state.enabled
        ? __("Disable Translation Mode")
        : __("Enable Translation Mode");
      on(item, "click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMode(!state.enabled);
        document.body.click();
      });

      const normalize = (s) => (s || "").replace(/\s+/g, " ").trim();
      const afterTarget = Array.from(
        menuEl.querySelectorAll(".dropdown-item, a, button")
      ).find((a) => {
        const t = normalize(a.textContent);
        return /تبديل\s*النمط/i.test(t) || /Toggle\s*Theme/i.test(t);
      });

      if (afterTarget) {
        afterTarget.after(item);
      } else {
        menuEl.append(item);
      }
    });
  }

  function observeTopbarDropdowns() {
    const topbar =
      document.querySelector(".navbar, .navbar-container, .navbar-nav") ||
      document.body;
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (
          m.type === "childList" ||
          (m.type === "attributes" &&
            m.target.classList?.contains("dropdown-menu"))
        ) {
          tryInjectInTopbarDropdowns();
        }
      }
    });
    obs.observe(topbar, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    tryInjectInTopbarDropdowns();
  }

  function init() {
    on(document, "keydown", (ev) => {
      if (ev.ctrlKey && ev.altKey && ev.key.toLowerCase() === "t") {
        toggleMode(!state.enabled);
      }
    });

    if (window.frappe?.router?.on) {
      frappe.router.on("change", () => {
        if (state.enabled && !state.inDialog) queueScan();
      });
    }

    if (frappe.realtime?.on) {
      frappe.realtime.on("translation_updated", (d) => {
        if (d?.lang)
          frappe.show_alert({
            message: __("Translations updated for {0}", [d.lang]),
            indicator: "green",
          });
      });
    }

    observeTopbarDropdowns();
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();

  window.inctx = Object.assign(window.inctx || {}, { toggle: toggleMode });
})();
