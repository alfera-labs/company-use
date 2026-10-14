'use client';

import { DeployScreen } from '@coworker/ui/components/company_use_deploy/deploy_screen';
import { use_deploy_look } from '@coworker/ui/lib/company_use_deploy/deploy_look';
import type { DeployChoices } from '@coworker/ui/lib/company_use_deploy/deploy_session';
import {
  type CloudName,
  choose_words,
  cloud_names,
  cloud_words,
} from '@coworker/ui/lib/company_use_deploy/deploy_words';
import { cn } from '@coworker/ui/lib/utils';
import { type FormEvent, useState } from 'react';

const name_pattern = /^[a-z0-9]{0,20}$/;

export type CloudAvailability = Record<CloudName, boolean>;

function CloudOption({
  cloud,
  picked,
  is_available,
  on_pick,
}: {
  cloud: CloudName;
  picked: boolean;
  is_available: boolean;
  on_pick: () => void;
}) {
  const words = cloud_words[cloud];
  const look = use_deploy_look();
  const option_class = cn(
    look.cloud,
    picked && look.cloud_picked,
    !is_available && look.cloud_unavailable,
  );
  return (
    <label className={option_class}>
      <input
        type="radio"
        name="cloud"
        value={cloud}
        checked={picked}
        disabled={!is_available}
        onChange={on_pick}
      />
      <span className={look.cloud_text}>
        <span className={look.cloud_name}>
          {words.label}
          {cloud === 'digitalocean' ? (
            <span className={look.chip}>{choose_words.recommended}</span>
          ) : null}
        </span>
        <span className={look.cloud_note}>
          {is_available ? words.note : choose_words.not_available}
        </span>
        <span className={look.cloud_note}>{words.cost}</span>
      </span>
    </label>
  );
}

function NameField({ name, on_change }: { name: string; on_change: (name: string) => void }) {
  const is_valid = name_pattern.test(name);
  const look = use_deploy_look();
  return (
    <div className={look.field}>
      <label htmlFor="deploy-name" className={look.label}>
        {choose_words.name_label}{' '}
        <span className={look.optional}>{choose_words.name_optional}</span>
      </label>
      <input
        id="deploy-name"
        className={look.input}
        value={name}
        maxLength={20}
        autoComplete="off"
        spellCheck={false}
        placeholder="acme"
        aria-invalid={!is_valid}
        aria-describedby="deploy-name-hint"
        onChange={(event) => on_change(event.target.value.toLowerCase().trim())}
      />
      <p id="deploy-name-hint" className={cn(look.hint, !is_valid && look.hint_wrong)}>
        {is_valid ? (
          <>
            {choose_words.address_lead}{' '}
            <span className={look.address}>{choose_words.address_of(name)}</span>
          </>
        ) : (
          choose_words.name_rule
        )}
      </p>
    </div>
  );
}

function CloudPicker({
  picked,
  available,
  on_pick,
}: {
  picked: CloudName;
  available: CloudAvailability;
  on_pick: (cloud: CloudName) => void;
}) {
  const look = use_deploy_look();
  return (
    <fieldset className={look.clouds}>
      <legend className={look.visually_hidden}>Cloud</legend>
      {cloud_names.map((cloud) => (
        <CloudOption
          key={cloud}
          cloud={cloud}
          picked={picked === cloud}
          is_available={available[cloud]}
          on_pick={() => on_pick(cloud)}
        />
      ))}
    </fieldset>
  );
}

function BackupsCheck({
  checked,
  on_change,
}: {
  checked: boolean;
  on_change: (checked: boolean) => void;
}) {
  const look = use_deploy_look();
  return (
    <label className={look.check}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => on_change(event.target.checked)}
      />
      {choose_words.backups}
    </label>
  );
}

const first_available_cloud = (initial: CloudName, available: CloudAvailability) =>
  available[initial] ? initial : (cloud_names.find((cloud) => available[cloud]) ?? initial);

export function ChooseCloudScreen({
  initial,
  available,
  on_start,
}: {
  initial: DeployChoices;
  available: CloudAvailability;
  on_start: (choices: DeployChoices) => Promise<void>;
}) {
  const [choices, set_choices] = useState({
    ...initial,
    cloud: first_available_cloud(initial.cloud, available),
  });
  const [is_busy, set_busy] = useState(false);
  const look = use_deploy_look();
  if (!cloud_names.some((cloud) => available[cloud])) {
    return <DeployScreen title={choose_words.title} lead={choose_words.none_available} />;
  }
  const can_start = name_pattern.test(choices.name) && available[choices.cloud] && !is_busy;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!can_start) return;
    set_busy(true);
    on_start({ ...choices, backups: choices.cloud === 'digitalocean' && choices.backups }).finally(
      () => set_busy(false),
    );
  };
  return (
    <DeployScreen title={choose_words.title} lead={choose_words.lead}>
      <form className={look.form} onSubmit={submit}>
        <CloudPicker
          picked={choices.cloud}
          available={available}
          on_pick={(cloud) => set_choices({ ...choices, cloud })}
        />
        <NameField name={choices.name} on_change={(name) => set_choices({ ...choices, name })} />
        {choices.cloud === 'digitalocean' ? (
          <BackupsCheck
            checked={choices.backups}
            on_change={(backups) => set_choices({ ...choices, backups })}
          />
        ) : null}
        <button type="submit" className={look.main_button} disabled={!can_start}>
          {choose_words.start}
        </button>
        <p className={look.privacy}>{choose_words.privacy}</p>
      </form>
    </DeployScreen>
  );
}
