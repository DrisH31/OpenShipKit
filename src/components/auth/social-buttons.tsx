"use client";

//
// "Continue with GitHub / Google". One plain form posting to a server action,
// each button carrying its provider — works with JavaScript off. Only the
// providers whose keys are set are passed in (decided on the server).
//

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { RedirectInput } from "./form-parts";

export interface SocialProvider {
  id: string;
  label: string;
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="currentColor">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.92l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.29 14.28A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.28v-3.1H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.38l4.01-3.1Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.28 6.62l4.01 3.1C6.23 6.88 8.88 4.77 12 4.77Z" />
    </svg>
  );
}

const MARKS: Record<string, () => React.ReactElement> = { github: GitHubMark, google: GoogleMark };

function ProviderButton({ provider }: { provider: SocialProvider }) {
  const { pending, data } = useFormStatus();
  const Mark = MARKS[provider.id];
  return (
    <Button
      type="submit"
      name="provider"
      value={provider.id}
      variant="outline"
      size="lg"
      className="w-full"
      loading={pending && data?.get("provider") === provider.id}
    >
      {Mark ? <Mark /> : null}
      Continue with {provider.label}
    </Button>
  );
}

export function SocialButtons({
  providers,
  action,
  redirectTo,
}: {
  providers: SocialProvider[];
  action: (formData: FormData) => Promise<void>;
  redirectTo: string;
}) {
  if (providers.length === 0) return null;
  return (
    <form action={action} className="flex flex-col gap-3">
      <RedirectInput value={redirectTo} />
      {providers.map((p) => (
        <ProviderButton key={p.id} provider={p} />
      ))}
    </form>
  );
}

/** The "or" rule between social buttons and the email form. */
export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-caption text-ink-3" role="separator" aria-label="or">
      <span className="h-px flex-1 bg-line" aria-hidden />
      <span aria-hidden>or</span>
      <span className="h-px flex-1 bg-line" aria-hidden />
    </div>
  );
}
