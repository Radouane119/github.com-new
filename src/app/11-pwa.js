// ---- Phase 5.4: PWA install and update prompt ----
// The worker no longer calls skipWaiting() during install, so a deploy cannot
// swap the cached app out from under an open tab. Instead the new worker waits
// and this module offers a reload button. The page posts SKIP_WAITING when the
// visitor accepts; controllerchange then reloads once.
let updatePromptShown = false;
let reloadOnControllerChange = false;

function showUpdatePrompt(registration, win) {
  if (updatePromptShown) return;
  updatePromptShown = true;
  try {
    let el = document.getElementById("update-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "update-toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.style.cssText = "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:8px;background:#1f2a36;color:#fff;font-size:.8rem;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.4);max-width:90vw";

      const text = document.createElement("span");
      text.textContent = "A new version is available.";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Reload";
      button.style.cssText = "padding:6px 12px;border-radius:6px;border:0;background:#3fb950;color:#0b1117;font-weight:700;cursor:pointer";
      button.addEventListener("click", () => {
        if (registration && registration.waiting) {
          reloadOnControllerChange = true;
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
          // If the worker never takes control, reload anyway rather than
          // leaving the visitor stuck on the old version.
          setTimeout(() => {
            if (!reloadOnControllerChange) return;
            reloadOnControllerChange = false;
            if (win && win.location) win.location.reload();
          }, 3000);
        } else if (win && win.location) {
          win.location.reload();
        }
      });

      el.appendChild(text);
      el.appendChild(button);
      document.body.appendChild(el);
    }
    el.style.display = "flex";
  } catch {}
}

function bindServiceWorker(registration, serviceWorker, win) {
  if (!registration) return;
  if (registration.waiting && serviceWorker && serviceWorker.controller) showUpdatePrompt(registration, win);
  if (typeof registration.addEventListener !== "function") return;
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker || typeof worker.addEventListener !== "function") return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && serviceWorker && serviceWorker.controller) {
        showUpdatePrompt(registration, win);
      }
    });
  });
}

function setupServiceWorker(nav, win) {
  if (!nav || !("serviceWorker" in nav)) return;
  const serviceWorker = nav.serviceWorker;
  serviceWorker.register("sw.js")
    .then((registration) => bindServiceWorker(registration, serviceWorker, win))
    .catch(() => {});
  if (typeof serviceWorker.addEventListener === "function") {
    serviceWorker.addEventListener("controllerchange", () => {
      if (!reloadOnControllerChange) return;
      reloadOnControllerChange = false;
      if (win && win.location && typeof win.location.reload === "function") win.location.reload();
    });
  }
}

setupServiceWorker(navigator, window);
