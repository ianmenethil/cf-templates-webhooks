import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Props for {@link ConfirmDeleteDialog}. */
type ConfirmDeleteDialogProps = {
  /** The question; kept while the dialog is closed so its text does not blank out. */
  title: string;
  /** What the delete takes with it; kept while the dialog is closed. */
  description: string;
  /** Whether the dialog is showing. */
  open: boolean;
  /** Called with the new state when the person cancels, confirms or presses Escape. */
  onOpenChange: (open: boolean) => void;
  /** Called when the person confirms the delete. */
  onConfirm: () => void;
};

/** Asks the person to confirm before something is deleted; Cancel has focus and Escape cancels. */
export const ConfirmDeleteDialog = ({
  title,
  description,
  open,
  onOpenChange,
  onConfirm,
}: ConfirmDeleteDialogProps) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction variant="destructive" onClick={onConfirm}>
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
