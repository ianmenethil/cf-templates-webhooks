import { Copy, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { WebhookDetail } from "../../shared/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getWebhook } from "../lib/api";
import { countOf, formatSize } from "../lib/format";
import { absoluteTime, formatAge } from "../lib/format-age";
import { TABLE_HEAD } from "../lib/styles";
import { IconButton } from "./IconButton";
import { SignatureBadge } from "./SignatureBadge";

/** The answer for one webhook ID; `webhook` is `null` when the fetch failed. */
type Loaded = { id: string; webhook: WebhookDetail | null };

/**
 * Indents a JSON object or array so it can be read; any other body comes back as it arrived.
 * @param body - The request body as text.
 */
const prettyBody = (body: string): string => {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null
      ? JSON.stringify(parsed, null, 2)
      : body;
  } catch {
    return body;
  }
};

/** One labelled fact in the summary grid. */
const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid gap-0.5">
    <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {label}
    </dt>
    <dd className="flex min-w-0 items-center gap-1 break-words">{children}</dd>
  </div>
);

/** Props for {@link WebhookDialog}. */
type WebhookDialogProps = {
  /** The webhook to show; kept while the dialog is closed so its text does not blank out. */
  id: string | null;
  /** Whether the dialog is showing. */
  open: boolean;
  /** Called with the new state when the person closes the dialog. */
  onOpenChange: (open: boolean) => void;
  /** Copies text to the clipboard. */
  onCopy: (text: string) => void;
  /** Asks to delete the webhook; the person confirms before it goes. */
  onDelete: (webhook: WebhookDetail) => void;
};

/** Everything one webhook arrived with: times, headers and the body, with the body indented when it is JSON. */
export const WebhookDialog = ({
  id,
  open,
  onOpenChange,
  onCopy,
  onDelete,
}: WebhookDialogProps) => {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!open || id === null) {
      return;
    }
    let current = true;
    getWebhook(id).then(
      (webhook) => {
        if (current) setLoaded({ id, webhook });
      },
      () => {
        if (current) setLoaded({ id, webhook: null });
      },
    );
    return () => {
      current = false;
    };
  }, [id, open]);

  const answer = loaded?.id === id ? loaded : null;
  const webhook = answer?.webhook ?? null;
  const body = useMemo(() => (webhook ? prettyBody(webhook.body) : ""), [webhook]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Webhook</DialogTitle>
          <DialogDescription>
            {webhook
              ? `Received by ${webhook.endpointName}.`
              : answer
                ? "Could not load this webhook. It may have been deleted."
                : "Loading…"}
          </DialogDescription>
        </DialogHeader>
        {webhook && (
          <>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Fact label="Received">
                <time
                  dateTime={webhook.receivedAt}
                  title={formatAge(webhook.receivedAt)}
                >
                  {absoluteTime.format(new Date(webhook.receivedAt))}
                </time>
              </Fact>
              <Fact label="Deliveries">
                {countOf(webhook.deliveries, "delivery", "deliveries")}
                {webhook.deliveries > 1 && (
                  <span className="text-muted-foreground">
                    , latest{" "}
                    <time
                      dateTime={webhook.lastReceivedAt}
                      title={formatAge(webhook.lastReceivedAt)}
                    >
                      {absoluteTime.format(new Date(webhook.lastReceivedAt))}
                    </time>
                  </span>
                )}
              </Fact>
              <Fact label="Event ID">
                {webhook.eventId ? (
                  <>
                    <span className="min-w-0 truncate font-mono text-xs">
                      {webhook.eventId}
                    </span>
                    <IconButton
                      label="Copy event ID"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onCopy(webhook.eventId ?? "")}
                    >
                      <Copy />
                    </IconButton>
                  </>
                ) : (
                  <span className="text-muted-foreground">no ID</span>
                )}
              </Fact>
              <Fact label="Signature">
                <SignatureBadge verified={webhook.verified} />
              </Fact>
              <Fact label="Content type">
                {webhook.contentType ?? (
                  <span className="text-muted-foreground">none</span>
                )}
              </Fact>
              <Fact label="Size">{formatSize(webhook.size)}</Fact>
            </dl>
            <section className="grid gap-2" aria-labelledby="headers-heading">
              <h3 id="headers-heading" className="font-medium">
                Headers
              </h3>
              <Table>
                <TableHeader className="bg-muted/60">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className={`${TABLE_HEAD} rounded-l-md pl-3`}>
                      Name
                    </TableHead>
                    <TableHead className={`${TABLE_HEAD} rounded-r-md`}>
                      Value
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(webhook.headers).map(([name, value]) => (
                    <TableRow key={name}>
                      <TableCell className="pl-3 align-top font-mono text-xs font-semibold">
                        {name}
                      </TableCell>
                      <TableCell className="font-mono text-xs break-all whitespace-normal">
                        {value}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
            <section className="grid gap-2" aria-labelledby="body-heading">
              <div className="flex items-center justify-between gap-2">
                <h3 id="body-heading" className="font-medium">
                  Body
                </h3>
                {body && (
                  <IconButton
                    label="Copy body"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onCopy(body)}
                  >
                    <Copy />
                  </IconButton>
                )}
              </div>
              {body ? (
                <pre
                  className="max-h-80 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all"
                  tabIndex={0}
                  aria-labelledby="body-heading"
                >
                  {body}
                </pre>
              ) : (
                <p className="text-muted-foreground">The body was empty.</p>
              )}
            </section>
            <DialogFooter>
              <Button variant="destructive" onClick={() => onDelete(webhook)}>
                <Trash2 />
                Delete
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
