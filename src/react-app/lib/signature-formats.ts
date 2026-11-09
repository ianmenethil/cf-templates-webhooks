import type { SignatureFormat } from "../../shared/types";

/** How the panel names each signature format, and what to tell the person entering its secret. */
export const FORMATS: Record<
  SignatureFormat,
  { label: string; option: string; hint: string }
> = {
  none: {
    label: "Secret URL",
    option: "None — secret URL only",
    hint: "No signature check: anyone who has the URL can post to it, so keep it private.",
  },
  standard: {
    label: "Standard Webhooks",
    option: "Standard Webhooks",
    hint: "Use the whsec_ signing secret your sender gives you; the spec does not say where, so check its webhook settings.",
  },
  stripe: {
    label: "Stripe",
    option: "Stripe",
    hint: "In the Stripe Dashboard, open Workbench, Webhooks, select your endpoint and reveal its signing secret (whsec_).",
  },
  github: {
    label: "GitHub",
    option: "GitHub",
    hint: "Use the random string you typed in the webhook's Secret field (Settings, Webhooks); set the content type to application/json.",
  },
};
