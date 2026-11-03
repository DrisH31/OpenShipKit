"use client";

//
// The submit button inside CheckoutButton / PortalButton. Server-rendered as a
// plain <button type="submit">, so the form works before (or without) JavaScript.
// Once hydrated it shows a spinner while the browser is on its way to
// Polar, so a second click can't open a second checkout.
//
// Why not useFormStatus: it only tracks forms whose action is a function. These
// forms post to a URL (a real navigation), so we listen for the native submit
// event — and reset on `pageshow`, because Back from Polar can restore
// this page from the back/forward cache with the spinner still on.
//

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type ButtonProps = ComponentProps<typeof Button>;

export interface SubmitButtonProps {
  children: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  /** An accessible name when the visible label is ambiguous ("Subscribe" next to three plans). */
  "aria-label"?: string;
}

/** A design-system Button that submits its form and shows a pending state until the page unloads. */
export function SubmitButton({ children, variant, size, className, ...rest }: SubmitButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onSubmit = (event: SubmitEvent) => {
      if (!event.defaultPrevented) setPending(true);
    };
    const onPageShow = () => setPending(false);
    form.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      form.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return (
    <Button ref={ref} type="submit" variant={variant} size={size} className={className} loading={pending} {...rest}>
      {children}
    </Button>
  );
}
