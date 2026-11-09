import { Webhook } from "lucide-react";
import type { AdminProfile } from "../../shared/types";
import { ThemeToggle } from "./ThemeToggle";

/** Props for {@link Topbar}. */
type TopbarProps = {
  /** Signed-in user and brand; `null` until `/admin/api/me` answers. */
  profile: AdminProfile | null;
};

/** The bar across the top: brand on the left, signed-in user and theme toggle on the right, lined up with the page content. */
export const Topbar = ({ profile }: TopbarProps) => (
  <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-md">
    <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
      <div className="flex shrink-0 items-center gap-2.5 font-semibold whitespace-nowrap">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Webhook className="size-4" aria-hidden="true" />
        </span>
        <span>
          {profile?.brand} <span className="font-normal text-muted-foreground">Webhooks</span>
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="truncate text-sm text-muted-foreground"
          title="Signed in with Cloudflare Access"
        >
          {profile?.email}
        </span>
        <ThemeToggle />
      </div>
    </div>
  </header>
);
