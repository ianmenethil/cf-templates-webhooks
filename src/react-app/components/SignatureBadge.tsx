import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Props for {@link SignatureBadge}. */
type SignatureBadgeProps = {
  /** `true` when the endpoint checked the webhook's signature and it was valid. */
  verified: boolean;
};

/** Says whether a webhook's signature was checked: "verified", or "unsigned" for an endpoint with format none. */
export const SignatureBadge = ({ verified }: SignatureBadgeProps) =>
  verified ? (
    <Badge variant="secondary">
      <ShieldCheck aria-hidden="true" />
      verified
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      unsigned
    </Badge>
  );
