// Reveals the copy buttons (`data-copy` = id of the element to copy) and copies that element's value or text.
// Without JS or the Clipboard API they stay hidden: the text is still there to select by hand.
(() => {
  if (!navigator.clipboard) return;
  const FEEDBACK_MS = 1500;

  for (const button of document.querySelectorAll("button[data-copy]")) {
    const target = document.getElementById(button.dataset.copy);
    if (!target) continue;
    const label = button.textContent.trim();
    button.hidden = false;
    button.addEventListener("click", async () => {
      const text = "value" in target ? target.value : target.textContent;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Copy failed";
      }
      setTimeout(() => {
        button.textContent = label;
      }, FEEDBACK_MS);
    });
  }
})();
