//
// The public forms' honeypot (contact, newsletter): one text field a person
// never sees or reaches, so anything in it came from a bot. Server-safe (no
// hooks), so client and server forms render the same markup.
//
// Kept off-screen, not display:none (naive bots skip hidden fields), out of
// the tab order and the accessibility tree. Its name and label are meaningless
// to autofill heuristics, and the data-* hints tell 1Password, LastPass and
// Bitwarden to leave it alone (see HONEYPOT in form-fields.ts).
//

import { HONEYPOT } from "./form-fields";

export function HoneypotField() {
  return (
    <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
      <label>
        Leave this empty
        <input
          type="text"
          name={HONEYPOT}
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore=""
          data-form-type="other"
        />
      </label>
    </div>
  );
}
