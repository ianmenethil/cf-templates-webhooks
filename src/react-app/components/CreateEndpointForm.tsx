import { Copy } from "lucide-react";
import { type FormEvent, useState } from "react";
import {
  ENDPOINT_NAME_PATTERN,
  type Endpoint,
  type SignatureFormat,
  SIGNATURE_FORMATS,
} from "../../shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createEndpoint } from "../lib/api";
import { FORMATS } from "../lib/signature-formats";
import { IconButton } from "./IconButton";

/** Props for {@link CreateEndpointForm}. */
type CreateEndpointFormProps = {
  /** The endpoint created most recently, whose URL is shown under the form. */
  latest: Endpoint | null;
  /** Called with the new endpoint once the API has saved it. */
  onCreated: (endpoint: Endpoint) => void;
  /** Copies text to the clipboard. */
  onCopy: (text: string) => void;
};

/** The form that makes a named endpoint, and the URL of the endpoint it just made. */
export const CreateEndpointForm = ({
  latest,
  onCreated,
  onCopy,
}: CreateEndpointFormProps) => {
  const [name, setName] = useState("");
  const [format, setFormat] = useState<SignatureFormat>("none");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedSecret = secret.trim();
    if (!ENDPOINT_NAME_PATTERN.test(trimmedName)) {
      setError("Name it with 1 to 40 lower-case letters, digits or dashes.");
      return;
    }
    if (format !== "none" && !trimmedSecret) {
      setError("Enter the signing secret, or choose None.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const created = await createEndpoint({
        name: trimmedName,
        format,
        ...(format === "none" ? {} : { secret: trimmedSecret }),
      });
      onCreated(created.endpoint);
      setName("");
      setSecret("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create the endpoint.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit} noValidate>
        <div className="grid content-start gap-1.5">
          <label className="text-sm font-medium" htmlFor="name-input">
            Name
          </label>
          <Input
            id="name-input"
            name="name"
            required
            maxLength={40}
            placeholder="stripe"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="grid content-start gap-1.5">
          <label className="text-sm font-medium" htmlFor="format-select">
            Signature format
          </label>
          <Select
            value={format}
            onValueChange={(value) => {
              const next = SIGNATURE_FORMATS.find((item) => item === value);
              if (next) setFormat(next);
            }}
          >
            <SelectTrigger
              id="format-select"
              className="w-full"
              aria-describedby="format-hint"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIGNATURE_FORMATS.map((item) => (
                <SelectItem key={item} value={item}>
                  {FORMATS[item].option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id="format-hint" className="text-xs text-muted-foreground">
            {FORMATS[format].hint}
          </p>
        </div>
        {format !== "none" && (
          <div className="grid gap-1.5 sm:col-span-2">
            <label className="text-sm font-medium" htmlFor="secret-input">
              Signing secret
            </label>
            <Input
              id="secret-input"
              name="secret"
              type="password"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder={format === "standard" ? "whsec_…" : undefined}
              aria-describedby="format-hint"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" className="max-sm:w-full sm:px-5" disabled={pending}>
            Create endpoint
          </Button>
        </div>
      </form>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {latest && (
        <div className="grid gap-2">
          <div className="flex items-center gap-3 rounded-lg border border-primary/25 bg-primary/5 py-2 pr-2 pl-3.5">
            <span className="shrink-0 text-sm font-medium text-muted-foreground">
              URL
            </span>
            <span className="min-w-0 flex-1 truncate font-mono font-semibold text-primary select-all">
              {latest.url}
            </span>
            <IconButton
              label="Copy endpoint URL"
              onClick={() => onCopy(latest.url)}
            >
              <Copy />
            </IconButton>
          </div>
          <p className="text-sm text-muted-foreground" role="status">
            Created {latest.name}. Give this URL to the sender.
            {latest.format !== "none" && " The secret is not shown again."}
          </p>
        </div>
      )}
    </div>
  );
};
