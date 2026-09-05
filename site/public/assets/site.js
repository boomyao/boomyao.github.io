const feedback = document.getElementById("share-feedback");
const dialog = document.getElementById("share-dialog");
const field = document.getElementById("share-url");
let dismiss;

document.querySelectorAll("[data-share]").forEach((button) => {
  button.addEventListener("click", async () => {
    const url = button.dataset.share;
    try {
      await navigator.clipboard.writeText(url);
      feedback.textContent = `已复制「${button.dataset.name}」的链接`;
      feedback.hidden = false;
      clearTimeout(dismiss);
      dismiss = setTimeout(() => {
        feedback.hidden = true;
      }, 3200);
    } catch {
      field.value = url;
      dialog.showModal();
      field.focus();
      field.select();
    }
  });
});

document.querySelector(".dialog-select").addEventListener("click", () => {
  field.focus();
  field.select();
});
