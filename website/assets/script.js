/* ============================================================================
   BIOLOG — marketing site behaviour
   ----------------------------------------------------------------------------
   Plain ES2018, no dependencies, no build step. Everything is guarded so a
   missing element on a given page never throws — index.html has the demo, the
   other four pages do not, and all five share this file.

   FOUR BEHAVIOURS
     1. Mobile nav drawer
     2. Demo modal + step carousel
     3. Contact form — validated client-side, POSTED to the app
     4. Footer year + stat counters

    });
  }

  /* ==========================================================================
     WHY THE MODAL IS HAND-ROLLED RATHER THAN <dialog>
   <dialog> support is now good, but showModal() has a long tail of differences
   around the backdrop and focus trapping, and it silently does nothing when
   opened from a link's default action in older engines. The manual version is
   ~40 lines, works everywhere, and the focus handling is explicit — which
   matters more here than the elegance, because a modal a keyboard user can
   tab out of is worse than no modal.
   ========================================================================== */

(function () {
  "use strict";

  /* ── Small helpers ──────────────────────────────────────────────────────── */

  var $ = function (sel, root) {
    return (root || document).querySelector(sel);
  };

  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  /* Honour the OS "reduce motion" setting for anything we would otherwise
     animate on a timer. Auto-advance is exactly the kind of thing that setting
     exists for. */
  var prefersReducedMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

  /* A named no-op beats a chain of `if (fn)` guards at every call site. */
  function noop() {}

  /* Focusable descendants, for the modal focus trap. */
  var FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /* ==========================================================================
     1 · MOBILE NAV DRAWER
     ========================================================================== */

  function initNav() {
    var toggle = $("[data-nav-toggle]");
    var links = $("[data-nav-links]");
    var scrim = $("[data-nav-scrim]");
    if (!toggle || !links) return;

    function open() {
      links.classList.add("is-open");
      if (scrim) scrim.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
    }

    function close() {
      links.classList.remove("is-open");
      if (scrim) scrim.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
    }

    toggle.addEventListener("click", function () {
      var isOpen = links.classList.contains("is-open");
      if (isOpen) {
        close();
      } else {
        open();
      }
    });

    if (scrim) scrim.addEventListener("click", close);

    /* Tapping a link navigates away, so the drawer state is moot — but closing
       first prevents a visible flash of the overlay during the page unload on
       slower mobile connections. */
    $$("a", links).forEach(function (a) {
      a.addEventListener("click", close);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && links.classList.contains("is-open")) close();
    });

    /* Rotating a phone to landscape while the drawer is open leaves a
       full-height panel over a landscape layout. Close it. */
    window.addEventListener("resize", function () {
      if (window.innerWidth > 880 && links.classList.contains("is-open")) close();
    });
  }

  /* ==========================================================================
     2 · DEMO MODAL + CAROUSEL
     ========================================================================== */

  function initDemo() {
    var modal = $("[data-demo-modal]");
    if (!modal) return; // not on this page — expected

    var dialog = $("[data-demo-dialog]", modal);
    var steps = $$("[data-demo-step]", modal);
    var dots = $$("[data-demo-dot]", modal);
    var prevBtn = $("[data-demo-prev]", modal);
    var nextBtn = $("[data-demo-next]", modal);
    var finishBtn = $("[data-demo-finish]", modal);
    var autoplayBtn = $("[data-demo-autoplay]", modal);
    var counter = $("[data-demo-counter]", modal);
    var openers = $$("[data-demo-open]");

    var current = 0;
    var lastFocused = null; /* where focus came from, so it can be restored */
    var timer = null;

    var AUTOPLAY_MS = 4000;

    /* Auto-advance is ON by default, as specified. It stops permanently the
       moment the visitor touches Next, Back, or a dot — someone who is
       deliberately driving the carousel should not have it yanked out from
       under them mid-step. */
    var autoplayEnabled = !prefersReducedMotion.matches;
    var userHasInteracted = false;

    function reduced() {
      return prefersReducedMotion.matches;
    }

    function stopTimer() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function startTimer() {
      stopTimer();
      if (!autoplayEnabled || userHasInteracted || reduced()) return;
      if (current >= steps.length - 1) return; /* don't roll past the end */
      timer = setInterval(function () {
        if (current < steps.length - 1) goTo(current + 1);
      }, AUTOPLAY_MS);
    }

    function updateDots() {
      dots.forEach(function (d, i) {
        var on = i === current;
        d.classList.toggle("is-active", on);
        d.setAttribute("aria-current", on ? "step" : "false");
      });
    }

    function updateButtons() {
      var isFirst = current === 0;
      var isLast = current === steps.length - 1;

      /* Disabled at the ends, per the brief. */
      if (prevBtn) prevBtn.disabled = isFirst;
      if (nextBtn) nextBtn.disabled = isLast;

      /* On the last step the primary action becomes Close Demo. It is hidden
         (not just disabled) on every other step so the footer does not show a
         dead button for two thirds of the carousel. */
      if (finishBtn) finishBtn.hidden = !isLast;

      if (counter) {
        counter.textContent = "Step " + (current + 1) + " of " + steps.length;
      }
    }

    function goTo(i) {
      if (i < 0 || i >= steps.length || i === current) return;
      steps[current].classList.remove("is-active");
      steps[current].setAttribute("aria-hidden", "true");
      current = i;
      steps[current].classList.add("is-active");
      steps[current].setAttribute("aria-hidden", "false");

      updateDots();
      updateButtons();
      startTimer();

      /* Keep the focused control visible. Without this, pressing Next near the
         bottom of a tall step scrolls the page behind the modal. */
      var body = $("[data-demo-body]", modal);
      if (body) body.scrollTop = 0;
    }

    function next() {
      userHasInteracted = true;
      stopTimer();
      goTo(current + 1);
      if (autoplayEnabled) syncAutoplayLabel();
    }

    function prev() {
      userHasInteracted = true;
      stopTimer();
      goTo(current - 1);
      if (autoplayEnabled) syncAutoplayLabel();
    }

    function syncAutoplayLabel() {
      if (!autoplayBtn) return;
      autoplayBtn.setAttribute("aria-pressed", autoplayEnabled ? "true" : "false");
      autoplayBtn.innerHTML =
        '<i class="ri-' +
        (autoplayEnabled ? "pause" : "play") +
        '-fill" aria-hidden="true"></i><span class="sr-only-toggle">' +
        (autoplayEnabled ? "Pause" : "Play") +
        "</span>";
      /* The visible label is the icon; the accessible name comes from the
         visually-hidden span so a screen reader says "Pause", not "pause icon". */
    }

    function open() {
      lastFocused = document.activeElement;
      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");
      document.body.classList.add("demo-open");

      /* Move focus into the dialog so the keyboard user is not left behind on
         the page underneath.

         The target is the DIALOG, not the close button. Inside a container that
         was visibility:hidden until this exact frame, a child button can still
         be un-focusable when focus() is called synchronously — and a focus
         call that lands on an invisible element throws its result away
         silently, which is exactly the bug this comment exists to prevent.
         The dialog is given tabindex="-1" in the HTML for this purpose: it is
         guaranteed to accept focus as soon as it is visible. */
      var target = dialog || $("[data-demo-close]", modal);
      if (target) {
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus();
      }

      startTimer();
    }

    function close() {
      stopTimer();
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("demo-open");

      if (lastFocused && typeof lastFocused.focus === "function") {
        lastFocused.focus();
      }
    }

    /* ── Wiring ── */

    openers.forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        open();
      });
    });

    $$("[data-demo-close]", modal).forEach(function (b) {
      b.addEventListener("click", close);
    });

    /* Click outside the dialog closes it. The check is on `e.target === modal`
       rather than a bounding-box test, so a click that lands on the backdrop
       but not on the panel's own padding still closes — the behaviour people
       expect from every modal they have ever used. Clicks inside the panel
       bubble up to modal but do not match, so they are ignored. */
    modal.addEventListener("click", function (e) {
      if (e.target === modal) close();
    });

    if (nextBtn) nextBtn.addEventListener("click", next);
    if (prevBtn) prevBtn.addEventListener("click", prev);
    if (finishBtn) finishBtn.addEventListener("click", close);

    dots.forEach(function (d, i) {
      d.addEventListener("click", function () {
        userHasInteracted = true;
        stopTimer();
        goTo(i);
        if (autoplayEnabled) syncAutoplayLabel();
      });
    });

    if (autoplayBtn) {
      syncAutoplayLabel();
      autoplayBtn.addEventListener("click", function () {
        autoplayEnabled = !autoplayEnabled;
        autoplayBtn.setAttribute("aria-pressed", autoplayEnabled ? "true" : "false");
        var icon = $("i", autoplayBtn);
        var sr = $(".sr-only-toggle", autoplayBtn);
        if (icon) icon.className = "ri-" + (autoplayEnabled ? "pause" : "play") + "-fill";
        if (sr) sr.textContent = autoplayEnabled ? "Pause" : "Play";

        /* Turning Play back on must CLEAR the "the visitor is driving this"
           latch. Without this the button becomes a lie: it reads "Play", it
           accepts the click, and the carousel never moves — because
           startTimer() still sees userHasInteracted and bails. Pressing Play is
           itself an explicit instruction to resume, so it has to win. */
        if (autoplayEnabled) userHasInteracted = false;

        stopTimer();
        startTimer();
      });
    }

    /* ── Keyboard ── */

    document.addEventListener("keydown", function (e) {
      if (!modal.classList.contains("is-open")) return;

      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }

      if (e.key === "ArrowRight") {
        /* Only hijack the arrow key when focus is inside the dialog, otherwise
           it would eat arrow keys used by the page behind. */
        if (!dialog.contains(document.activeElement)) return;
        e.preventDefault();
        next();
        return;
      }

      if (e.key === "ArrowLeft") {
        if (!dialog.contains(document.activeElement)) return;
        e.preventDefault();
        prev();
        return;
      }

      if (e.key === "Tab") {
        /* Focus trap. Without this, Tab walks out of the modal and into the
           page underneath, which is disorienting and — for a keyboard or
           screen-reader user — leaves no visual sign they have left the dialog. */
        var focusables = $$(FOCUSABLE, dialog).filter(function (el) {
          return el.offsetParent !== null || el === document.activeElement;
        });
        if (!focusables.length) return;

        var first = focusables[0];
        var last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    /* Opening the modal before the fonts load would flash the wrong metrics,
       but more importantly a visitor who lands on /index.html#demo should get
       the demo rather than a hash jump to a section heading. */
    function openFromHash() {
      if (window.location.hash === "#demo") {
        open();
        /* Replace rather than push, so Back does not re-trigger the modal
           immediately after leaving it. */
        if (window.history && history.replaceState) {
          history.replaceState(null, "", window.location.pathname + window.location.search);
        }
      }
    }

    window.addEventListener("hashchange", function () {
      if (window.location.hash === "#demo") open();
    });

    /* Initial paint. */
    steps.forEach(function (s, i) {
      s.classList.toggle("is-active", i === 0);
      s.setAttribute("aria-hidden", i === 0 ? "false" : "true");
    });
    updateDots();
    updateButtons();
    openFromHash();

    /* A tab left open in the background throttles setInterval to ~1/min in
       most browsers, so the carousel would appear to stall and then jump.
       Resuming on visibilitychange keeps it honest. */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        stopTimer();
      } else if (modal.classList.contains("is-open")) {
        startTimer();
      }
    });

    /* Exposed for the verification step in the build notes. Not a public API. */
    window.__biologDemo = {
      open: open,
      close: close,
      next: next,
      prev: prev,
      goTo: goTo,
      get step() {
        return current;
      },
      get steps() {
        return steps.length;
      },
      get autoplay() {
        return autoplayEnabled;
      }
    };
  }

  /* ==========================================================================
     3 · CONTACT FORM — real submission
     ==========================================================================
     Posts to the app's public endpoint, which stores the row in
     website_inquiries. The URL is read from a data attribute on the form so
     this stays a static site: set
     data-endpoint="/api/public/website-inquiry" on the <form> and nothing here
     needs editing. Served from the app's own origin, a relative URL is enough.

     FAILURE IS HANDLED HONESTLY. A demo request is the last step before a sales
     call, so the visitor never sees a stack trace or a raw status code: network
     failure and a 429 both resolve to a warm, readable message with a mailto
     fallback, because a person who cannot submit can still send an email. Only
     a genuine field-validation rejection shows its own messages, and those are
     placed under the right input.

     stored:false from the server means the row had nowhere to land (the
     migration has not been run). The visitor still sees the success screen —
     there is nothing they can do about our database, and a working contact form
     must not depend on the database being deployed first.
     ========================================================================== */

  function initContactForm() {
    var form = $("[data-contact-form]");
    if (!form) return;

    var success = $("[data-form-success]");
    var successDetail = $("[data-form-success-detail]");
    var statusEl = $("[data-form-status]");
    var endpoint = form.getAttribute("data-endpoint") || "/api/public/website-inquiry";
    var btn = form.querySelector('button[type="submit"]');
    var btnLabel = btn ? btn.innerHTML : null;

    function fieldOf(input) {
      return input.closest(".field");
    }

    function validateInput(input) {
      var wrap = fieldOf(input);
      var err = wrap ? $(".field__error", wrap) : null;
      var value = (input.value || "").trim();
      var message = "";

      if (input.hasAttribute("required") && !value) {
        message = input.dataset.errorRequired || "This field is required.";
      } else if (input.type === "email" && value) {
        /* Deliberately permissive: one @, something either side, a dot in the
           domain. Over-strict email regexes reject valid addresses, and the
           only real test of an email is delivering to it. */
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
          message = input.dataset.errorEmail || "Enter a valid email address.";
        }
      }

      if (wrap) wrap.classList.toggle("has-error", Boolean(message));
      if (err) err.textContent = message;
      return !message;
    }

    /* The honeypot is excluded: it is never filled by a human, so validating
       it would flag the form as broken for everyone. */
    var inputs = $$("input, select, textarea", form).filter(function (el) {
      return el.type !== "hidden" && el.name !== "website_url";
    });

    inputs.forEach(function (input) {
      /* Validate on blur, then live-correct once the field is already marked
         wrong. Validating from the first keystroke flags a half-typed email as
         invalid while the visitor is still typing it. */
      input.addEventListener("blur", function () {
        validateInput(input);
      });
      input.addEventListener("input", function () {
        var wrap = fieldOf(input);
        if (wrap && wrap.classList.contains("has-error")) validateInput(input);
      });
    });

    function sayFailure(message) {
      if (!statusEl) return;
      statusEl.textContent = message;
      statusEl.hidden = false;
      /* Focus it, so a keyboard or screen-reader user is told rather than only
         the sighted one. */
      statusEl.setAttribute("tabindex", "-1");
      statusEl.focus();
    }

    function saySuccess(name) {
      var first = (name || "").trim().split(/\s+/)[0];
      if (successDetail) {
        successDetail.textContent = first ? "Thanks, " + first + "." : "Thanks.";
      }
      form.style.display = "none";
      if (statusEl) statusEl.hidden = true;
      if (success) {
        success.classList.add("is-visible");
        success.setAttribute("tabindex", "-1");
        success.focus();
      }
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var firstBad = null;
      var allValid = true;
      inputs.forEach(function (input) {
        if (!validateInput(input)) {
          allValid = false;
          if (!firstBad) firstBad = input;
        }
      });
      if (!allValid) {
        if (firstBad) firstBad.focus();
        return;
      }

      var payload = {};
      $$("input, select, textarea", form).forEach(function (el) {
        if (el.name) payload[el.name] = el.value;
      });
      /* Which page they came from. A pricing-page enquiry is warmer than a
         footer one, and this is the only place that fact is recoverable. */
      payload.source_page = location.pathname.split("/").pop() || "index.html";

      if (btn) {
        btn.disabled = true;
        btn.textContent = "Sending…";
      }
      if (statusEl) statusEl.hidden = true;

      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (json) {
              return { status: res.status, ok: res.ok, json: json };
            });
        })
        .then(function (r) {
          if (r.ok && r.json.ok) {
            saySuccess(payload.name);
            return;
          }

          /* A field-level rejection from OUR validation: put each message under
             its own input, which beats one banner. */
          if (r.status === 400 && r.json && r.json.errors) {
            var mapped = 0;
            Object.keys(r.json.errors).forEach(function (k) {
              var input = form.querySelector('[name="' + k + '"]');
              if (!input) return;
              var wrap = fieldOf(input);
              if (wrap) wrap.classList.add("has-error");
              var err = wrap ? $(".field__error", wrap) : null;
              if (err) err.textContent = r.json.errors[k];
              mapped += 1;
            });
            if (mapped) {
              sayFailure("Please check the highlighted fields.");
              return;
            }
          }

          if (r.status === 429) {
            sayFailure(
              "Too many submissions from this connection. Please try again in a few minutes, or email hello@biolog.ph."
            );
            return;
          }

          sayFailure(
            "We couldn't send that just now. Please email hello@biolog.ph and we'll pick it up from there."
          );
        })
        .catch(function () {
          /* Offline, DNS failure, CORS blocked — indistinguishable here, and
             all equally "the request never arrived". */
          sayFailure(
            "We couldn't reach our server — you may be offline. Please email hello@biolog.ph instead."
          );
        })
        .then(function () {
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = btnLabel;
          }
        });
    });
  }

  /* ==========================================================================
     4 · MISC (year + counters)
     ========================================================================== */

  function initYear() {
    $$("[data-year]").forEach(function (el) {
      el.textContent = String(new Date().getFullYear());
    });
  }

  /* Count numbers up when the stats band scrolls into view. Skipped entirely
     for reduced-motion visitors, who get the final value immediately rather
     than an animation they did not ask for. */
  function initCountUp() {
    var targets = $$("[data-count-to]");
    if (!targets.length) return;

    if (prefersReducedMotion.matches) {
      targets.forEach(function (el) {
        el.textContent = el.dataset.countTo + (el.dataset.countSuffix || "");
      });
      return;
    }

    var observer = null;
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            animate(entry.target);
            observer.unobserve(entry.target);
          });
        },
        { threshold: 0.4 }
      );
      targets.forEach(function (el) {
        observer.observe(el);
      });
    } else {
      targets.forEach(animate);
    }

    function animate(el) {
      var to = Number(el.dataset.countTo);
      var suffix = el.dataset.countSuffix || "";
      var duration = 1100;
      var start = null;

      function frame(ts) {
        if (start === null) start = ts;
        var p = Math.min((ts - start) / duration, 1);
        /* easeOutCubic — fast start, gentle landing. Linear feels mechanical. */
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(to * eased) + suffix;
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }
  }

  /* ── Boot ───────────────────────────────────────────────────────────────── */

  function boot() {
    initNav();
    initDemo();
    initContactForm();
    initYear();
    initCountUp();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
