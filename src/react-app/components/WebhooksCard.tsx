import { Eye, RefreshCw, Search, Trash2 } from "lucide-react";
import type { Endpoint, WebhookSummary } from "../../shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { WebhookFeed } from "@/hooks/use-webhooks";
import { countOf, formatSize } from "../lib/format";
import { absoluteTime, formatAge } from "../lib/format-age";
import { TABLE_HEAD } from "../lib/styles";
import { IconButton } from "./IconButton";
import { SignatureBadge } from "./SignatureBadge";

const ALL_ENDPOINTS = "all";

/** Props for {@link WebhooksCard}. */
type WebhooksCardProps = {
  /** The endpoints to offer in the filter. */
  endpoints: Endpoint[];
  /** The endpoint the list is limited to; `undefined` for all of them. */
  endpointFilter: string | undefined;
  /** Called with the endpoint the person picked, or `undefined` for all of them. */
  onEndpointFilterChange: (endpoint: string | undefined) => void;
  /** The text in the search box. */
  search: string;
  /** Called with the new text as the person types. */
  onSearchChange: (search: string) => void;
  /** The loaded webhooks and how to load more. */
  feed: WebhookFeed;
  /** Fetches the list again. */
  onRefresh: () => void;
  /** Called with a webhook the person wants to read in full. */
  onView: (webhook: WebhookSummary) => void;
  /** Asks to delete a webhook; the person confirms before it goes. */
  onDelete: (webhook: WebhookSummary) => void;
  /** Called when the person asks for the next page. */
  onLoadMore: () => void;
};

/** The webhooks that arrived, newest first, filtered by endpoint and text, with a view and a delete button on each row. */
export const WebhooksCard = ({
  endpoints,
  endpointFilter,
  onEndpointFilterChange,
  search,
  onSearchChange,
  feed,
  onRefresh,
  onView,
  onDelete,
  onLoadMore,
}: WebhooksCardProps) => {
  const filtered = endpointFilter !== undefined || search.trim() !== "";
  const message =
    feed.status === "loading"
      ? "Loading…"
      : feed.status === "error"
        ? "Could not load webhooks. Try the refresh button."
        : feed.webhooks.length === 0
          ? filtered
            ? "No webhooks match your filters."
            : "No webhooks yet. They appear here as soon as a sender posts to an endpoint URL."
          : null;

  return (
    <Card role="region" aria-labelledby="webhooks-heading">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>
          <h2 id="webhooks-heading">Webhooks</h2>
        </CardTitle>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <label className="sr-only" htmlFor="endpoint-filter">
            Filter by endpoint
          </label>
          <Select
            value={endpointFilter ?? ALL_ENDPOINTS}
            onValueChange={(value) =>
              onEndpointFilterChange(value === ALL_ENDPOINTS ? undefined : value)
            }
          >
            <SelectTrigger id="endpoint-filter" className="max-sm:w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ENDPOINTS}>All endpoints</SelectItem>
              {endpoints.map((endpoint) => (
                <SelectItem key={endpoint.id} value={endpoint.id}>
                  {endpoint.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="sr-only" htmlFor="webhook-search">
            Search webhooks
          </label>
          <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="webhook-search"
              className="pl-8"
              type="search"
              placeholder="Search event ID or body"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </div>
          <IconButton label="Refresh webhooks" onClick={onRefresh}>
            <RefreshCw />
          </IconButton>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {message && (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            {message}
          </p>
        )}
        {!message && (
          <Table
            className="max-sm:block"
            aria-busy={feed.busy}
          >
            <TableHeader className="bg-muted/60 max-sm:hidden">
              <TableRow className="hover:bg-transparent">
                <TableHead className={`${TABLE_HEAD} rounded-l-md pl-3`}>Endpoint</TableHead>
                <TableHead className={TABLE_HEAD}>Event ID</TableHead>
                <TableHead className={TABLE_HEAD}>Received</TableHead>
                <TableHead className={TABLE_HEAD}>Signature</TableHead>
                <TableHead className={TABLE_HEAD}>Size</TableHead>
                <TableHead className="h-9 rounded-r-md pr-3 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody
              className={`max-sm:block ${feed.busy ? "opacity-60 transition-opacity" : ""}`}
            >
              {feed.webhooks.map((webhook) => {
                const name = webhook.eventId ?? "with no ID";
                return (
                  <TableRow
                    key={webhook.id}
                    className="max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-1 max-sm:py-3"
                  >
                    <TableCell className="pl-3 font-mono font-semibold max-sm:order-1 max-sm:min-w-0 max-sm:flex-1 max-sm:p-0">
                      {webhook.endpointName}
                    </TableCell>
                    <TableCell
                      className="w-[28%] max-w-0 font-mono text-xs max-sm:order-3 max-sm:w-full max-sm:max-w-full max-sm:basis-full max-sm:p-0"
                      title={webhook.eventId ?? undefined}
                    >
                      <span className="block truncate">
                        {webhook.eventId ?? (
                          <span className="font-sans text-sm text-muted-foreground">
                            no ID
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="max-sm:order-4 max-sm:p-0 max-sm:text-sm">
                      <time
                        dateTime={webhook.receivedAt}
                        title={absoluteTime.format(new Date(webhook.receivedAt))}
                      >
                        {formatAge(webhook.receivedAt)}
                      </time>
                      {webhook.deliveries > 1 && (
                        <Badge variant="outline" className="ml-2 tabular-nums">
                          {countOf(webhook.deliveries, "delivery", "deliveries")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-sm:order-4 max-sm:p-0">
                      <SignatureBadge verified={webhook.verified} />
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums max-sm:order-4 max-sm:p-0 max-sm:text-sm">
                      {formatSize(webhook.size)}
                    </TableCell>
                    <TableCell className="w-px pr-3 text-right whitespace-nowrap max-sm:order-2 max-sm:w-auto max-sm:p-0">
                      <div className="flex justify-end gap-1">
                        <IconButton
                          label={`View webhook ${name}`}
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => onView(webhook)}
                        >
                          <Eye />
                        </IconButton>
                        <IconButton
                          label={`Delete webhook ${name}`}
                          variant="ghost"
                          size="icon-sm"
                          className="hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => onDelete(webhook)}
                        >
                          <Trash2 />
                        </IconButton>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {!message && feed.hasMore && (
          <Button
            variant="outline"
            className="justify-self-center"
            disabled={feed.loadingMore}
            onClick={onLoadMore}
          >
            {feed.loadingMore ? "Loading…" : "Load more"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
