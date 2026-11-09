import { useEffect, useState } from "react";
import type { WebhookSummary } from "../../shared/types";
import { getWebhooks } from "@/lib/api";

/** What one fetch of the list produced; `webhooks` is `null` when the fetch failed. */
type Result = {
  /** The filters and refresh count the fetch was made for. */
  key: string;
  webhooks: WebhookSummary[] | null;
  nextBefore: string | null;
};

/** The webhook list as {@link useWebhooks} keeps it. */
export type WebhookFeed = {
  /** Webhooks loaded so far, newest first. */
  webhooks: WebhookSummary[];
  /** `loading` before the first answer, then `ready`, or `error` when the latest fetch failed. */
  status: "loading" | "ready" | "error";
  /** `true` while the list on screen is being replaced after a filter change or refresh. */
  busy: boolean;
  /** Whether more webhooks are waiting behind the ones loaded. */
  hasMore: boolean;
  /** `true` while {@link WebhookFeed.loadMore} is fetching. */
  loadingMore: boolean;
  /** Fetches the list again from the first page. */
  reload: () => void;
  /** Appends the next page; rejects when the fetch fails. */
  loadMore: () => Promise<void>;
  /** Drops one webhook from the list without fetching, after it has been deleted. */
  remove: (id: string) => void;
};

/**
 * Loads webhooks newest first, a page at a time, and fetches again whenever a filter changes.
 * The previous list stays on screen until the new one arrives.
 * @param endpoint - Only webhooks received by this endpoint; `undefined` for all of them.
 * @param q - Only webhooks whose event ID or body contains this text; empty for all of them.
 */
export const useWebhooks = (
  endpoint: string | undefined,
  q: string,
): WebhookFeed => {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const key = JSON.stringify([endpoint, q, version]);

  useEffect(() => {
    let current = true;
    getWebhooks({ endpoint, q }).then(
      (page) => {
        if (current) {
          setResult({ key, webhooks: page.webhooks, nextBefore: page.nextBefore });
        }
      },
      () => {
        if (current) {
          setResult({ key, webhooks: null, nextBefore: null });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [endpoint, q, key]);

  const loadMore = async () => {
    if (!result?.webhooks || result.nextBefore === null || result.key !== key) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await getWebhooks({ endpoint, q, before: result.nextBefore });
      setResult((latest) =>
        latest?.webhooks && latest.key === key
          ? {
              ...latest,
              webhooks: [...latest.webhooks, ...page.webhooks],
              nextBefore: page.nextBefore,
            }
          : latest,
      );
    } finally {
      setLoadingMore(false);
    }
  };

  const remove = (id: string) =>
    setResult((latest) =>
      latest?.webhooks
        ? { ...latest, webhooks: latest.webhooks.filter((item) => item.id !== id) }
        : latest,
    );

  return {
    webhooks: result?.webhooks ?? [],
    status: result === null ? "loading" : result.webhooks ? "ready" : "error",
    busy: result !== null && result.key !== key,
    hasMore: result?.nextBefore != null && result.key === key,
    loadingMore,
    reload: () => setVersion((count) => count + 1),
    loadMore,
    remove,
  };
};
