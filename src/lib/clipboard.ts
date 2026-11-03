//
// Put text on the clipboard, for the copy buttons (CopyButton, CopyLineButton).
// The async Clipboard API needs a secure context, so on plain http at a LAN
// address it throws; then this falls back to selecting a hidden textarea and
// execCommand("copy"). Resolves false when both fail, so the button can say
// "copy by hand" — the text is always on the page to select. Browser only:
// call it from an event handler.
//

export async function writeClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
