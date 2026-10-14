import { Button } from '@coworker/ui/components/button';
import { Checkbox } from '@coworker/ui/components/checkbox';
import { Input } from '@coworker/ui/components/input';
import { Label } from '@coworker/ui/components/label';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { build_resolved_curl_example } from '@/components/credentials/resolved_curl_example';
import {
  empty_sign_in_recipe,
  generate_sign_in_recipe,
  type SignInRecipeDraft,
  SignInRecipeFields,
} from '@/components/credentials/sign_in_recipe_fields';
import { ApiError } from '@/lib/api/client';
import {
  type CredentialExchangeReport,
  type CredentialTypeChoice,
  create_workspace_credential,
  disable_workspace_credential,
  exchange_workspace_credential,
  list_credential_types,
} from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import { create_random_id } from '@/lib/random_id';

const error_sentences: Record<string, string> = {
  display_name_required: 'Give this app a name.',
  allowed_hosts_required: 'Add at least one website this key may be sent to.',
  wildcard_host_not_supported:
    'List the exact hostnames — a wildcard like *.example.com cannot be used here.',
  secret_value_required: 'Enter the credential.',
  host_not_allowed: 'A header points at a site that is not in the list above.',
};

function read_error_sentence(error: unknown): string {
  const sentence =
    error instanceof ApiError && error.code ? error_sentences[error.code] : undefined;
  return sentence ?? 'We could not save that. Please try again.';
}

function split_hosts(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((host) => host.trim())
    .filter(Boolean);
}

type CustomHeaderRow = { row_id: string; name: string; prefix: string; value: string };

export function ConnectAppDialog({
  onConnected,
  starts_with_sign_in = false,
}: {
  onConnected: () => void;
  starts_with_sign_in?: boolean;
}) {
  const name_id = useId();
  const type_id = useId();
  const hosts_id = useId();

  const [display_name, set_display_name] = useState('');
  const [credential_type_key, set_credential_type_key] = useState('bearer');
  const [allowed_hosts_text, set_allowed_hosts_text] = useState('');
  const [secret_values, set_secret_values] = useState<Record<string, string>>({});
  const [custom_headers, set_custom_headers] = useState<CustomHeaderRow[]>([]);
  const [curl_open, set_curl_open] = useState(false);
  const sign_in_id = useId();
  const [needs_sign_in, set_needs_sign_in] = useState(starts_with_sign_in);
  const [sign_in_recipe, set_sign_in_recipe] = useState<SignInRecipeDraft>(empty_sign_in_recipe);
  const [sign_in_report, set_sign_in_report] = useState<CredentialExchangeReport | null>(null);

  const credential_types_query = useQuery({
    queryKey: query_keys.credential_types(),
    queryFn: list_credential_types,
  });
  const credential_types = credential_types_query.data ?? [];
  const selected_type: CredentialTypeChoice | undefined =
    credential_types.find((choice) => choice.credential_type_key === credential_type_key) ??
    credential_types[0];

  const allowed_hosts = useMemo(() => split_hosts(allowed_hosts_text), [allowed_hosts_text]);

  const curl_example = useMemo(
    () =>
      build_resolved_curl_example({
        allowed_hosts,
        headers: [
          ...(selected_type?.goes.startsWith('header ')
            ? [{ name: selected_type.goes.slice(7).split(':')[0] ?? '', prefix: '' }]
            : []),
          ...custom_headers.map((row) => ({ name: row.name, prefix: row.prefix })),
        ],
      }),
    [allowed_hosts, custom_headers, selected_type],
  );

  // Headers the app needs are needed at sign-in too — Acme Planner answers 404,
  // not 401, to a request missing its version header — so with a recipe they ride
  // along on the login itself rather than becoming separate delivery rules.
  const always_send_headers = useMemo(
    () =>
      Object.fromEntries(
        custom_headers
          .filter((row) => row.name.trim() && row.value.trim())
          .map((row) => [row.name.trim(), row.value.trim()]),
      ),
    [custom_headers],
  );

  const save = useMutation({
    mutationFn: async () => {
      const exchange = needs_sign_in
        ? generate_sign_in_recipe(sign_in_recipe, always_send_headers)
        : null;
      const created = await create_workspace_credential({
        display_name: display_name.trim(),
        allowed_hosts,
        secret_values,
        ...(selected_type ? { credential_type_key: selected_type.credential_type_key } : {}),
        custom_headers: custom_headers
          .filter((row) => row.name.trim() && row.value.trim())
          .map((row) => ({ name: row.name.trim(), prefix: row.prefix, value: row.value.trim() })),
        ...(exchange ? { exchange_the_credential_by: exchange } : {}),
      });

      if (!exchange) return null;
      const report = await exchange_workspace_credential(created.connection_id);
      if (!report.exchanged) await disable_workspace_credential(created.connection_id);
      return report;
    },
    onSuccess: (report) => {
      if (report && !report.exchanged) {
        set_sign_in_report(report);
        return;
      }
      onConnected();
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={name_id}>Name</Label>
          <Input
            id={name_id}
            placeholder="e.g. Internal billing API"
            value={display_name}
            onChange={(event) => set_display_name(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={type_id}>Credential type</Label>
          <select
            id={type_id}
            className="h-9 rounded-2xl border border-input bg-transparent px-3 text-sm"
            value={credential_type_key}
            onChange={(event) => {
              set_credential_type_key(event.target.value);
              set_secret_values({});
            }}
          >
            {credential_types.map((choice) => (
              <option key={choice.credential_type_key} value={choice.credential_type_key}>
                {choice.label}
              </option>
            ))}
          </select>
          {selected_type ? (
            <p className="text-xs text-muted-foreground">{selected_type.standard}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={hosts_id}>Allowed websites</Label>
        <Input
          id={hosts_id}
          placeholder="api.example.com"
          value={allowed_hosts_text}
          onChange={(event) => set_allowed_hosts_text(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Your agent will only send this app&apos;s keys to these websites. Separate several with
          commas.
        </p>
      </div>

      {selected_type ? (
        <CredentialFields
          choice={selected_type}
          values={secret_values}
          onChange={(field_name, value) =>
            set_secret_values((current) => ({ ...current, [field_name]: value }))
          }
        />
      ) : null}

      <CustomHeaderRows rows={custom_headers} onChange={set_custom_headers} />

      <div className="flex w-fit items-center gap-2">
        <Checkbox
          id={sign_in_id}
          checked={needs_sign_in}
          onCheckedChange={(checked) => set_needs_sign_in(checked === true)}
        />
        <Label htmlFor={sign_in_id} className="font-normal">
          This app makes me sign in with a username and password
        </Label>
      </div>

      {needs_sign_in ? (
        <SignInRecipeFields draft={sign_in_recipe} onChange={set_sign_in_recipe} />
      ) : null}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => set_curl_open((open) => !open)}
        >
          {curl_open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          See resolved curl example
        </button>
        {curl_open ? (
          <pre className="overflow-x-auto rounded-2xl bg-muted p-3 text-xs">
            {curl_example || 'Add an allowed website to see the request.'}
          </pre>
        ) : null}
      </div>

      {save.isError ? (
        <p className="text-sm text-destructive">{read_error_sentence(save.error)}</p>
      ) : null}

      {sign_in_report && !sign_in_report.exchanged ? (
        <div className="flex flex-col gap-1 rounded-2xl border border-destructive/40 p-3">
          <p className="text-sm text-destructive">{sign_in_report.message}</p>
          {sign_in_report.retry_allowed_after_time ? (
            <p className="text-xs text-muted-foreground">
              That site asked us to wait. We will not try again before{' '}
              {new Date(sign_in_report.retry_allowed_after_time).toLocaleTimeString()}.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              The credential is saved but not signed in. Remove it and add it again once the details
              are corrected.
            </p>
          )}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onConnected()}>
          Cancel
        </Button>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? (needs_sign_in ? 'Signing in…' : 'Connecting…') : 'Connect'}
        </Button>
      </div>
    </div>
  );
}

function CredentialFields({
  choice,
  values,
  onChange,
}: {
  choice: CredentialTypeChoice;
  values: Record<string, string>;
  onChange: (field_name: string, value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {choice.fields.map((field) =>
        field.is_secret ? (
          <div key={field.field_name} className="flex flex-col gap-1.5">
            <Label htmlFor={`credential-${field.field_name}`}>{field.label}</Label>
            <Input
              id={`credential-${field.field_name}`}
              type="password"
              autoComplete="off"
              value={values[field.field_name] ?? ''}
              onChange={(event) => onChange(field.field_name, event.target.value)}
            />
          </div>
        ) : (
          <div key={field.field_name} className="flex flex-col gap-0.5">
            <span className="text-sm">{field.label}</span>
            <span className="text-xs text-muted-foreground">
              {field.prefilled_value} — from the API&apos;s own specification
            </span>
          </div>
        ),
      )}
    </div>
  );
}

function CustomHeaderRows({
  rows,
  onChange,
}: {
  rows: CustomHeaderRow[];
  onChange: (rows: CustomHeaderRow[]) => void;
}) {
  const update = (index: number, patch: Partial<CustomHeaderRow>) =>
    onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));

  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-medium">Custom headers</p>
        <p className="text-xs text-muted-foreground">
          Added to every request your agent sends to the allowed websites — and sent when we sign
          in, which some sites require. Copy any header the site&apos;s own sign-in request carries,
          such as an API version.
        </p>
      </div>
      {rows.map((row, index) => (
        <div key={row.row_id} className="flex items-center gap-2">
          <Input
            placeholder="Name"
            value={row.name}
            onChange={(event) => update(index, { name: event.target.value })}
          />
          <Input
            placeholder="Prefix"
            value={row.prefix}
            onChange={(event) => update(index, { prefix: event.target.value })}
          />
          <Input
            type="password"
            placeholder="Value"
            autoComplete="off"
            value={row.value}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove header"
            onClick={() => onChange(rows.filter((_, position) => position !== index))}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        className="w-fit"
        onClick={() =>
          onChange([...rows, { row_id: create_random_id(), name: '', prefix: '', value: '' }])
        }
      >
        <Plus className="size-4" /> Add header
      </Button>
    </div>
  );
}
