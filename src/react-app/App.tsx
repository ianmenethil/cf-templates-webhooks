import { useEffect, useState } from "react";
import { toast } from "sonner";
import type {
  AdminProfile,
  Endpoint,
  WebhookSummary,
} from "../shared/types";
import { ConfirmDeleteDialog } from "./components/ConfirmDeleteDialog";
import { EndpointsCard } from "./components/EndpointsCard";
import { Topbar } from "./components/Topbar";
import { WebhookDialog } from "./components/WebhookDialog";
import { WebhooksCard } from "./components/WebhooksCard";
import { Toaster } from "./components/ui/sonner";
import { useDebouncedValue } from "./hooks/use-debounced-value";
import { useWebhooks } from "./hooks/use-webhooks";
import {
  deleteEndpoint,
  deleteWebhook,
  getEndpoints,
  getProfile,
} from "./lib/api";
import { countOf } from "./lib/format";

/** A delete waiting for the person's yes, with the words to ask it in. */
type PendingDelete = {
  title: string;
  description: string;
  run: () => Promise<void>;
};

/**
 * Copies text to the clipboard and says whether it worked.
 * @param text - The text to copy.
 */
const copy = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  } catch {
    toast.error("Could not copy; select the text and copy it manually");
  }
};

/** The admin panel: create endpoints, then see, search, read and delete the webhooks that arrive. */
export const App = () => {
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [status, setStatus] = useState<string | null>("Loading…");
  const [latest, setLatest] = useState<Endpoint | null>(null);
  const [endpointFilter, setEndpointFilter] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const query = useDebouncedValue(search.trim(), 300);
  const feed = useWebhooks(endpointFilter, query);

  useEffect(() => {
    Promise.all([getProfile(), getEndpoints()]).then(
      ([me, saved]) => {
        setProfile(me);
        setEndpoints(saved);
        setStatus(null);
      },
      () => setStatus("Could not load endpoints. Refresh the page to try again."),
    );
  }, []);

  useEffect(() => {
    if (profile) {
      document.title = `${profile.brand} Webhooks`;
    }
  }, [profile]);

  const refreshEndpoints = () =>
    getEndpoints().then(setEndpoints, () =>
      toast.error("Could not refresh the endpoints"),
    );

  const refresh = () => {
    feed.reload();
    refreshEndpoints();
  };

  const loadMore = () =>
    feed.loadMore().catch(() => toast.error("Could not load more webhooks"));

  const created = (endpoint: Endpoint) => {
    setEndpoints((current) => [endpoint, ...current]);
    setLatest(endpoint);
  };

  const view = (webhook: WebhookSummary) => {
    setViewing(webhook.id);
    setViewOpen(true);
  };

  const askToDelete = (next: PendingDelete) => {
    setPending(next);
    setConfirmOpen(true);
  };

  const removeEndpoint = async (endpoint: Endpoint) => {
    try {
      await deleteEndpoint(endpoint.id);
    } catch {
      toast.error("Could not delete the endpoint");
      return;
    }
    setEndpoints((current) => current.filter((item) => item.id !== endpoint.id));
    setLatest((current) => (current?.id === endpoint.id ? null : current));
    if (endpointFilter === endpoint.id) {
      setEndpointFilter(undefined);
    } else {
      feed.reload();
    }
    toast(`Deleted ${endpoint.name}`);
  };

  const removeWebhook = async (webhook: WebhookSummary) => {
    try {
      await deleteWebhook(webhook.id);
    } catch {
      toast.error("Could not delete the webhook");
      return;
    }
    feed.remove(webhook.id);
    refreshEndpoints();
    toast("Deleted the webhook");
  };

  const askToDeleteEndpoint = (endpoint: Endpoint) =>
    askToDelete({
      title: `Delete ${endpoint.name}?`,
      description: `Its URL stops accepting webhooks${
        endpoint.webhookCount > 0
          ? `, and its ${countOf(endpoint.webhookCount, "webhook")} ${
              endpoint.webhookCount === 1 ? "is" : "are"
            } deleted too`
          : ""
      }. This cannot be undone.`,
      run: () => removeEndpoint(endpoint),
    });

  const askToDeleteWebhook = (webhook: WebhookSummary) => {
    setViewOpen(false);
    askToDelete({
      title: "Delete this webhook?",
      description: `The webhook ${webhook.eventId ?? "with no ID"} received by ${webhook.endpointName} will be deleted. This cannot be undone.`,
      run: () => removeWebhook(webhook),
    });
  };

  return (
    <>
      <Topbar profile={profile} />
      <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 pt-8 pb-16 sm:px-6">
        <EndpointsCard
          endpoints={endpoints}
          status={status}
          latest={latest}
          onCreated={created}
          onCopy={copy}
          onDelete={askToDeleteEndpoint}
        />
        <WebhooksCard
          endpoints={endpoints}
          endpointFilter={endpointFilter}
          onEndpointFilterChange={setEndpointFilter}
          search={search}
          onSearchChange={setSearch}
          feed={feed}
          onRefresh={refresh}
          onView={view}
          onDelete={askToDeleteWebhook}
          onLoadMore={loadMore}
        />
      </main>
      <WebhookDialog
        id={viewing}
        open={viewOpen}
        onOpenChange={setViewOpen}
        onCopy={copy}
        onDelete={askToDeleteWebhook}
      />
      <ConfirmDeleteDialog
        title={pending?.title ?? ""}
        description={pending?.description ?? ""}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={() => pending?.run()}
      />
      <Toaster position="bottom-center" duration={2500} />
    </>
  );
};
