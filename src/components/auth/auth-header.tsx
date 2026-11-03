//
// The heading block at the top of every auth card. Server-safe (no hooks).
//

export function AuthHeader({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      <h1 data-rank="1" className="font-display text-h3 font-bold text-ink text-balance">{title}</h1>
      {description ? <p className="text-small text-ink-2 text-pretty">{description}</p> : null}
    </header>
  );
}

/** The small line under a form: "New here? Create an account". */
export function AuthFooter({ children }: { children: React.ReactNode }) {
  return <p className="text-center text-small text-ink-2">{children}</p>;
}

/** An inline text link with a visible focus ring and a 44px touch target. */
export const authLinkClass =
  "font-semibold text-ink underline decoration-ink-faint underline-offset-4 hover:decoration-ink rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus pointer-coarse:inline-block pointer-coarse:py-2.5";
