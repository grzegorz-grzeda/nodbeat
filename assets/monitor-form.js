// The Monitor form: shows only the Interval or the Schedule fields, as chosen, and the next scheduled times of the
// Schedule as the User types, from /monitors/schedule-preview (the same markup monitor-form.ts `schedulePreviewBody`
// renders). Without JS both sets of fields stay visible and the preview shows after saving.
(() => {
  const DEBOUNCE_MS = 300;
  const cron = document.getElementById("schedule-cron");
  const timeZone = document.getElementById("schedule-time-zone");
  const preview = document.getElementById("schedule-preview");
  if (!cron || !timeZone || !preview) return;
  const form = cron.form;

  const showChosen = () => {
    const chosen = form.querySelector('input[name="timing"]:checked');
    for (const detail of form.querySelectorAll("[data-timing]")) {
      detail.hidden = chosen !== null && detail.dataset.timing !== chosen.value;
    }
  };
  for (const radio of form.querySelectorAll('input[name="timing"]')) {
    radio.addEventListener("change", showChosen);
  }
  showChosen();

  const render = (result) => {
    preview.replaceChildren();
    if (result.errors) {
      for (const error of result.errors) {
        const p = document.createElement("p");
        p.className = "error";
        p.textContent = error;
        preview.append(p);
      }
      return;
    }
    const intro = document.createElement("p");
    intro.textContent = "Next scheduled times:";
    const list = document.createElement("ul");
    list.className = "plain";
    for (const time of result.times) {
      const li = document.createElement("li");
      li.textContent = time;
      list.append(li);
    }
    preview.append(intro, list);
  };

  let timer;
  // Only the newest request's answer is shown.
  let latest = 0;
  const update = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (cron.value.trim() === "") {
        preview.replaceChildren();
        return;
      }
      const id = ++latest;
      const query = new URLSearchParams({
        cron: cron.value,
        timeZone: timeZone.value,
      });
      try {
        const res = await fetch("/monitors/schedule-preview?" + query, {
          headers: { accept: "application/json" },
        });
        if (!res.ok || id !== latest) return;
        render(await res.json());
      } catch {
        // Offline or logged out: the preview stays as it was; saving still checks the Schedule.
      }
    }, DEBOUNCE_MS);
  };
  cron.addEventListener("input", update);
  timeZone.addEventListener("change", update);
})();
