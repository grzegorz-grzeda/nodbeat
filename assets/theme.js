// Saves the nav theme switch without a reload: posts the same form as JSON-accepting fetch, then flips
// <html data-theme> and the pressed button. If saving fails it falls back to the plain form post.
(() => {
  const form = document.querySelector("form.theme-switch");
  if (!form) return;

  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    for (const b of form.querySelectorAll("button[name=theme]")) {
      b.setAttribute("aria-pressed", String(b.value === theme));
    }
  };

  const fallback = (theme) => {
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = "theme";
    field.value = theme;
    form.append(field);
    form.submit();
  };

  form.addEventListener("submit", async (event) => {
    const theme = event.submitter?.value;
    if (!theme) return;
    event.preventDefault();
    const data = new URLSearchParams(new FormData(form));
    data.set("theme", theme);
    try {
      const res = await fetch(form.action, {
        method: "POST",
        headers: { accept: "application/json" },
        body: data,
      });
      if (!res.ok) return fallback(theme);
      apply((await res.json()).theme);
    } catch {
      fallback(theme);
    }
  });
})();
