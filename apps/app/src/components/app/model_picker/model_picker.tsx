import {
  Combobox,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxTrigger,
} from '@coworker/ui/components/combobox';
import { Search } from 'lucide-react';
import { type ComponentProps, type ReactNode, useEffect, useMemo, useState } from 'react';
import { BillingSourceRow } from '@/components/app/model_picker/billing_source_row';
import {
  find_chosen_model,
  let_alfera_recommend,
  type ModelChoice,
} from '@/components/app/model_picker/model_choice';
import {
  ModelDetailCard,
  useSideWithRoomForCard,
} from '@/components/app/model_picker/model_detail_card';
import {
  describe_model_choice,
  describe_model_choice_briefly,
} from '@/components/app/model_picker/model_display';
import {
  PickerRowContent,
  ProviderRow,
} from '@/components/app/model_picker/model_picker_row_views';
import {
  build_model_picker_rows,
  find_row_choice,
  find_row_model,
  group_model_picker_rows,
  list_selectable_option_keys,
  selected_option_key,
  show_chosen_model_provider,
  toggle_provider,
} from '@/components/app/model_picker/model_picker_rows';
import { ModelPickerTriggerContent } from '@/components/app/model_picker/model_picker_trigger';
import { find_inherited_model } from '@/components/app/model_picker/model_presets';
import { PickerNote, usePickerNote } from '@/components/app/model_picker/picker_note';
import { useModelAccess } from '@/components/app/model_picker/use_model_access';
import { useModelOptions } from '@/components/app/model_picker/use_model_options';
import type { ModelCatalogEntry } from '@/lib/api';

export const model_trigger_class_names = {
  field:
    'field flex h-8 w-full items-center justify-between gap-2 px-2.5 text-sm [&>svg]:text-muted-foreground',
  inline:
    'flex h-11 items-center gap-1 rounded-full px-2 text-[13px] text-muted-foreground transition-colors duration-150 hover:bg-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground sm:h-8',
} as const;

export function ModelPicker(
  props: Omit<ComponentProps<typeof ModelPickerView>, 'model_access' | 'billing_source'>,
) {
  const model_access = useModelAccess();
  const { models_that_need_a_key } = useModelOptions();
  const models = useMemo(
    () => [...props.models, ...models_that_need_a_key],
    [props.models, models_that_need_a_key],
  );
  return (
    <ModelPickerView
      {...props}
      models={models}
      model_access={model_access}
      billing_source={<BillingSourceRow />}
    />
  );
}

export function ModelPickerView({
  disabled,
  inheritedChoice = let_alfera_recommend,
  models,
  onChange,
  size = 'field',
  value,
  model_access,
  billing_source,
  default_open = false,
}: {
  disabled?: boolean | undefined;
  inheritedChoice?: ModelChoice;
  models: ModelCatalogEntry[];
  onChange: (choice: ModelChoice) => void;
  size?: keyof typeof model_trigger_class_names;
  value: ModelChoice;
  model_access: ReturnType<typeof useModelAccess>;
  billing_source?: ReactNode;
  default_open?: boolean;
}) {
  const [query, set_query] = useState('');
  const [expanded_providers, set_expanded_providers] = useState<ReadonlySet<string>>(() =>
    show_chosen_model_provider(new Set(), value),
  );
  const [highlighted_model, set_highlighted_model] = useState<ModelCatalogEntry | null>(null);
  const [card_side, measure_room_beside_popup] = useSideWithRoomForCard();
  const picker_note = usePickerNote();
  useEffect(() => {
    set_expanded_providers((current) => show_chosen_model_provider(current, value));
  }, [value]);
  const inherited_model = useMemo(
    () => find_inherited_model(models, inheritedChoice),
    [models, inheritedChoice],
  );
  const rows = useMemo(
    () =>
      build_model_picker_rows({
        models,
        query,
        expanded_providers,
        inherited_model,
        inherited_choice: inheritedChoice,
        model_access,
      }),
    [models, query, expanded_providers, inherited_model, inheritedChoice, model_access],
  );
  const option_keys = useMemo(() => list_selectable_option_keys(rows), [rows]);
  const row_groups = useMemo(() => group_model_picker_rows(rows), [rows]);
  const selected_key = selected_option_key(rows, value);
  const chosen_model = find_chosen_model(models, value);

  return (
    <Combobox
      defaultOpen={default_open}
      disabled={disabled}
      filter={null}
      inputValue={query}
      items={option_keys}
      value={selected_key ?? null}
      onInputValueChange={(next_query: string) => set_query(next_query)}
      onItemHighlighted={(option_key: string | undefined) => {
        set_highlighted_model(find_row_model(rows, option_key));
        picker_note.show_for(rows, option_key);
      }}
      onOpenChange={(is_open: boolean) => {
        if (is_open) return;
        set_query('');
        set_highlighted_model(null);
        picker_note.clear();
      }}
      onValueChange={(option_key: string | null) => {
        const choice = option_key ? find_row_choice(rows, option_key) : null;
        if (choice) return onChange(choice);
        picker_note.show_for(rows, option_key);
      }}
    >
      <ComboboxTrigger
        aria-label="Model"
        className={model_trigger_class_names[size]}
        {...(size === 'inline' ? { 'data-tour': 'model-picker' } : {})}
      >
        <ModelPickerTriggerContent
          model={chosen_model}
          label={
            size === 'inline'
              ? describe_model_choice_briefly(models, value)
              : describe_model_choice(models, value, inherited_model, inheritedChoice)
          }
        />
      </ComboboxTrigger>

      <ComboboxPortal>
        <ComboboxPositioner align={size === 'inline' ? 'end' : 'start'} sideOffset={6}>
          <ComboboxPopup
            className="relative flex max-h-[26rem] w-[calc(100vw-2rem)] flex-col sm:w-[26rem]"
            ref={measure_room_beside_popup}
          >
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <ComboboxInput aria-label="Search models" placeholder="Search models..." />
            </div>
            <ComboboxEmpty>No models match that search.</ComboboxEmpty>
            <ComboboxList className="min-h-0 flex-1 rounded-b-xl p-1">
              {row_groups.map((group) => (
                <ComboboxGroup key={group.group_key}>
                  {group.provider_row ? (
                    <ProviderRow
                      row={group.provider_row}
                      onToggle={() =>
                        set_expanded_providers((current) =>
                          toggle_provider(current, group.provider_row?.model_provider ?? ''),
                        )
                      }
                    />
                  ) : (
                    <ComboboxGroupLabel className="sr-only">Model shortcuts</ComboboxGroupLabel>
                  )}
                  {group.rows.map((row) => (
                    <ComboboxItem
                      className={row.row_kind === 'model' ? 'ps-9' : 'items-start py-2.5'}
                      key={row.row_key}
                      value={row.row_key}
                    >
                      <PickerRowContent isChosen={row.row_key === selected_key} row={row} />
                    </ComboboxItem>
                  ))}
                </ComboboxGroup>
              ))}
            </ComboboxList>
            <PickerNote note={picker_note.note} />
            {billing_source}
            <ModelDetailCard model={highlighted_model ?? chosen_model} side={card_side} />
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxPortal>
    </Combobox>
  );
}
