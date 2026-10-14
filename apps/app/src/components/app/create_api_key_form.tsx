import {
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@coworker/ui/components/alert-dialog';
import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { Label } from '@coworker/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@coworker/ui/components/radio-group';
import { LoaderCircle } from 'lucide-react';
import {
  type ApiKeyAccess,
  api_key_access_choices,
  api_key_accesses,
} from '@/components/app/api_key_scopes';

export type ApiKeyDraft = {
  key_name: string;
  access: ApiKeyAccess;
};

export const empty_api_key_draft: ApiKeyDraft = {
  key_name: '',
  access: 'full',
};

export function CreateApiKeyForm({
  draft,
  pending,
  on_change,
  on_cancel,
  on_submit,
}: {
  draft: ApiKeyDraft;
  pending: boolean;
  on_change: (draft: ApiKeyDraft) => void;
  on_cancel: () => void;
  on_submit: () => void;
}) {
  const can_submit = draft.key_name.trim().length > 0 && !pending;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (can_submit) on_submit();
      }}
    >
      <AlertDialogHeader>
        <AlertDialogTitle>Create a key</AlertDialogTitle>
        <AlertDialogDescription>
          A key lets your own code or an AI assistant like Claude use this workspace.
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div className="mt-5 flex flex-col gap-5">
        <KeyNameField
          key_name={draft.key_name}
          on_change={(key_name) => on_change({ ...draft, key_name })}
        />

        <AccessChoice
          access={draft.access}
          on_change={(access) => on_change({ ...draft, access })}
        />
      </div>

      <CreateKeyFooter pending={pending} can_submit={can_submit} on_cancel={on_cancel} />
    </form>
  );
}

function CreateKeyFooter({
  pending,
  can_submit,
  on_cancel,
}: {
  pending: boolean;
  can_submit: boolean;
  on_cancel: () => void;
}) {
  return (
    <AlertDialogFooter>
      <Button type="button" size="sm" variant="outline" onClick={on_cancel}>
        Cancel
      </Button>
      <Button type="submit" size="sm" disabled={!can_submit}>
        {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
        Create key
      </Button>
    </AlertDialogFooter>
  );
}

function KeyNameField({
  key_name,
  on_change,
}: {
  key_name: string;
  on_change: (key_name: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="api-key-name">Name</Label>
      <Input
        id="api-key-name"
        placeholder="My support bot"
        value={key_name}
        onChange={(event) => on_change(event.target.value)}
      />
    </div>
  );
}

function AccessChoice({
  access,
  on_change,
}: {
  access: ApiKeyAccess;
  on_change: (access: ApiKeyAccess) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2.5 text-sm font-medium">What it can do</legend>
      <RadioGroup
        value={access}
        onValueChange={(value) =>
          on_change(api_key_accesses.find((choice) => choice === value) ?? 'full')
        }
      >
        {api_key_accesses.map((choice) => (
          <div key={choice} className="flex items-start gap-2.5">
            <RadioGroupItem id={`api-key-access-${choice}`} value={choice} className="mt-0.5" />
            <Label
              htmlFor={`api-key-access-${choice}`}
              className="flex flex-col items-start gap-0.5"
            >
              {api_key_access_choices[choice].label}
              <span className="text-xs font-normal text-muted-foreground">
                {api_key_access_choices[choice].description}
              </span>
            </Label>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
