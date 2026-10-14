"use strict";
// Progressive enhancement only: ordering works without JavaScript.
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) {
    event.preventDefault();
    return;
  }
  if (form.classList.contains("submit-once")) {
    if (form.classList.contains("is-submitting")) { event.preventDefault(); return; }
    form.classList.add("is-submitting");
    form.setAttribute("aria-busy", "true");
  }
});
window.addEventListener("pageshow", () => {
  document.querySelectorAll(".is-submitting").forEach((form) => {
    form.classList.remove("is-submitting");
    form.removeAttribute("aria-busy");
  });
});
