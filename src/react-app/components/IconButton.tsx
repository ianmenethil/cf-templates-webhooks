import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Props for {@link IconButton}. */
type IconButtonProps = Omit<ComponentProps<typeof Button>, "aria-label"> & {
  /** Accessible name and tooltip text; the button shows only an icon. */
  label: string;
};

/** A square button that shows only an icon: named for screen readers by `label`, which a tooltip also shows. */
export const IconButton = ({
  label,
  variant = "outline",
  size = "icon",
  ...props
}: IconButtonProps) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant={variant} size={size} aria-label={label} {...props} />
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);
