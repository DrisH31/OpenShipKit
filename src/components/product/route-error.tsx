"use client";

//
// What a dashboard or admin page shows when its server render failed (an
// outage, not a validation error). It offers a retry (Next 16’s `retry`
// re-fetches and re-renders the segment) and a way out. The digest is the id
// of the real error in the server log.
//
//   audience="customer"  the dashboard: the problem is ours; contact us and
//                        quote the reference (the customer has no server log)
//   audience="admin"     the admin: check the server log for the digest
//
// Neither claims more than it knows: a render failure loses nothing already
// saved, but this page can't know whether a save in flight went through.
//

import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ErrorState } from "@/components/product/states";

export function RouteError({
  error,
  retry,
  home,
  audience,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  home: { label: string; href: string };
  audience: "customer" | "admin";
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error.digest ? <code className="font-mono text-caption">{error.digest}</code> : null;
  return (
    <ErrorState
      title="This page didn’t load"
      body={
        audience === "customer" ? (
          <>
            Something went wrong on our side, not yours. Changes you’d already saved are safe. Try again; if it keeps happening, contact us
            {digest ? <> and quote reference {digest}</> : null}.
          </>
        ) : (
          <>
            The server failed to render this page; changes already saved are safe. Try again; if it keeps happening, check the server log
            {digest ? <> for {digest}</> : null}.
          </>
        )
      }
      action={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={retry}>
            Try again
          </Button>
          {audience === "customer" ? (
            <Link href="/contact?topic=support" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Contact us
            </Link>
          ) : null}
          <Link href={home.href} className={buttonVariants({ variant: audience === "customer" ? "ghost" : "outline", size: "sm" })}>
            {home.label}
          </Link>
        </div>
      }
    />
  );
}
