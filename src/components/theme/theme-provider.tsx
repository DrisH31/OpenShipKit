"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"

/*
 * Light / dark / system, set as a class on <html> before first paint (no flash).
 * `nonce` is the request's CSP nonce (the root layout passes it): the inline
 * theme script runs only with it.
 */
export function ThemeProvider({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
      {children}
    </NextThemesProvider>
  )
}
