"use client";

//
// The error boundary for every route under the root layout. A client
// component (Next requires it), so it can't read content or the session: it
// says what happened in plain words, offers "Try again" (retry() re-fetches and
// re-renders the segment) and the way home. The digest lets an operator find
// the error in the server log; the message itself is never shown in production.
//

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcwIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="mx-auto flex min-h-[70vh] w-full max-w-content flex-col justify-center px-gutter py-section">
      <p className="mb-6 font-sans text-eyebrow font-semibold tracking-[0.08em] text-ink-3 uppercase">Something went wrong</p>
      <h1 data-rank="1" className="max-w-[18ch] font-display text-display font-bold text-ink">
        This page didn’t load
      </h1>
      <p className="mt-8 max-w-measure text-lead text-ink-2">
        The problem is on our side, not yours. Try again; if it keeps happening, tell us what you were doing
        and we’ll look into it.
      </p>
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Button size="lg" data-rank="2" onClick={() => retry()} className="w-full sm:w-auto">
          <RotateCcwIcon aria-hidden data-icon="inline-start" />
          Try again
        </Button>
        <Link href="/" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full sm:w-auto")}>
          Go to the home page
        </Link>
        <Link href="/contact" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "w-full sm:w-auto")}>
          Report it
        </Link>
      </div>
      {error.digest && (
        <p className="mt-8 text-caption text-ink-3">
          Reference: <span className="font-mono">{error.digest}</span>
        </p>
      )}
    </main>
  );
}
