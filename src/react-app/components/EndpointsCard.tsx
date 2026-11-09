import { Copy, Trash2 } from "lucide-react";
import type { Endpoint } from "../../shared/types";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { absoluteTime, formatAge } from "../lib/format-age";
import { countOf } from "../lib/format";
import { TABLE_HEAD } from "../lib/styles";
import { FORMATS } from "../lib/signature-formats";
import { CreateEndpointForm } from "./CreateEndpointForm";
import { IconButton } from "./IconButton";

/** Props for {@link EndpointsCard}. */
type EndpointsCardProps = {
  /** Every endpoint. */
  endpoints: Endpoint[];
  /** What to say instead of the table: loading, an error, or `null` once the endpoints are in. */
  status: string | null;
  /** The endpoint created most recently, whose URL is shown under the form. */
  latest: Endpoint | null;
  /** Called with the new endpoint once the API has saved it. */
  onCreated: (endpoint: Endpoint) => void;
  /** Copies text to the clipboard. */
  onCopy: (text: string) => void;
  /** Asks to delete an endpoint; the person confirms before it goes. */
  onDelete: (endpoint: Endpoint) => void;
};

/** The form that makes endpoints and the table of them, with a copy and a delete button on each row. */
export const EndpointsCard = ({
  endpoints,
  status,
  latest,
  onCreated,
  onCopy,
  onDelete,
}: EndpointsCardProps) => {
  const message =
    status ??
    (endpoints.length === 0
      ? "Create an endpoint to get a URL for your sender."
      : null);

  return (
    <Card role="region" aria-labelledby="endpoints-heading">
      <CardHeader>
        <CardTitle>
          <h1 id="endpoints-heading" className="flex items-center gap-2">
            Endpoints
            {endpoints.length > 0 && (
              <Badge variant="secondary" className="tabular-nums">
                {endpoints.length}
              </Badge>
            )}
          </h1>
        </CardTitle>
        <CardDescription>
          Each endpoint is a URL that one sender posts webhooks to.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <CreateEndpointForm latest={latest} onCreated={onCreated} onCopy={onCopy} />
        {message && (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            {message}
          </p>
        )}
        {!message && (
          <Table className="max-sm:block">
            <TableHeader className="bg-muted/60 max-sm:hidden">
              <TableRow className="hover:bg-transparent">
                <TableHead className={`${TABLE_HEAD} rounded-l-md pl-3`}>Name</TableHead>
                <TableHead className={TABLE_HEAD}>URL</TableHead>
                <TableHead className={TABLE_HEAD}>Webhooks</TableHead>
                <TableHead className={TABLE_HEAD}>Last received</TableHead>
                <TableHead className="h-9 rounded-r-md pr-3 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="max-sm:block">
              {endpoints.map((endpoint) => (
                <TableRow
                  key={endpoint.id}
                  className="max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-x-3 max-sm:py-3"
                >
                  <TableCell className="pl-3 max-sm:col-start-1 max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-2 max-sm:whitespace-normal max-sm:p-0">
                    <span className="font-mono font-semibold">{endpoint.name}</span>
                    <Badge variant="outline" className="ml-2 max-sm:ml-0">
                      {FORMATS[endpoint.format].label}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className="w-[38%] max-w-0 font-mono text-xs text-muted-foreground max-sm:col-span-2 max-sm:row-start-2 max-sm:w-full max-sm:max-w-none max-sm:p-0 max-sm:pt-1"
                    title={endpoint.url}
                  >
                    <span className="block truncate">{endpoint.url}</span>
                  </TableCell>
                  <TableCell className="tabular-nums max-sm:col-start-1 max-sm:row-start-3 max-sm:p-0 max-sm:pt-1 max-sm:text-sm">
                    {countOf(endpoint.webhookCount, "webhook")}
                  </TableCell>
                  <TableCell className="max-sm:col-start-2 max-sm:row-start-3 max-sm:p-0 max-sm:pt-1 max-sm:text-right max-sm:text-sm">
                    {endpoint.lastReceivedAt ? (
                      <time
                        dateTime={endpoint.lastReceivedAt}
                        title={absoluteTime.format(new Date(endpoint.lastReceivedAt))}
                      >
                        {formatAge(endpoint.lastReceivedAt)}
                      </time>
                    ) : (
                      <span className="text-muted-foreground">Never</span>
                    )}
                  </TableCell>
                  <TableCell className="w-px pr-3 text-right whitespace-nowrap max-sm:col-start-2 max-sm:row-start-1 max-sm:w-auto max-sm:p-0">
                    <div className="flex justify-end gap-1">
                      <IconButton
                        label={`Copy URL of ${endpoint.name}`}
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onCopy(endpoint.url)}
                      >
                        <Copy />
                      </IconButton>
                      <IconButton
                        label={`Delete ${endpoint.name}`}
                        variant="ghost"
                        size="icon-sm"
                        className="hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onDelete(endpoint)}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};
