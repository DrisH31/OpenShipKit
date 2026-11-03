"use client";

//
// Copy buttons for the code blocks in a rendered doc. The code is already in
// the server HTML (sanitised, highlighted: renderMarkdownHighlighted), each
// block framed as <figure class="code-block"><figcaption>Shell</figcaption>
// <pre class="code-tokens">…; after hydration this adds the shared CopyButton
// to each caption bar, through a portal, copying the block's own text. The
// bar's height is reserved in prose.css, so the button arriving moves nothing.
// Without JavaScript the code is there to select by hand.
//
// It also makes a block that scrolls sideways focusable (tabindex 0, named by
// its language), so a keyboard can scroll it in every browser; a block that
// fits stays out of the tab order.
//

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CopyButton } from "@/components/product/copy-button";

interface Slot {
  mount: HTMLElement;
  value: string;
  label: string;
}

export function DocsCodeCopy({ containerId }: { containerId: string }) {
  const [slots, setSlots] = useState<Slot[]>([]);

  useEffect(() => {
    const root = document.getElementById(containerId);
    if (!root) return;
    const found: Slot[] = [];
    for (const figure of root.querySelectorAll<HTMLElement>("figure.code-block")) {
      const caption = figure.querySelector<HTMLElement>(":scope > figcaption");
      const pre = figure.querySelector<HTMLElement>(":scope > pre");
      if (!caption || !pre) continue;
      const label = caption.textContent?.trim() || "code";
      if (pre.scrollWidth > pre.clientWidth) {
        pre.tabIndex = 0;
        pre.setAttribute("aria-label", `${label} code`);
      }
      let mount = caption.querySelector<HTMLElement>(":scope > [data-copy-slot]");
      if (!mount) {
        mount = document.createElement("span");
        mount.dataset.copySlot = "";
        caption.append(mount);
      }
      found.push({ mount, value: (pre.textContent ?? "").replace(/\n$/, ""), label });
    }
    // One render after the scan: the DOM is the source here, not React state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlots(found);
    return () => {
      for (const slot of found) slot.mount.remove();
    };
  }, [containerId]);

  return (
    <>
      {slots.map((slot, i) =>
        createPortal(
          <CopyButton value={slot.value} size="xs" variant="ghost" srLabel={`Copy the ${slot.label} code`} className="shrink-0" />,
          slot.mount,
          `copy-${i}`,
        ),
      )}
    </>
  );
}
