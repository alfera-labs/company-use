import { is_blank, type SetupField } from '@/components/app/automations/trigger_setup_fields';

export function chip_word_for(field: SetupField): string {
  return field.chip_word ?? field.label.toLowerCase();
}

export function chip_value_for(field: SetupField, value: unknown): string {
  if (!is_blank(value)) return describe_value(field, value);
  if (field.required && !field.has_default) return 'required';
  return describe_default(field);
}

export function chip_is_hidden(field: SetupField, value: unknown): boolean {
  if (!field.hidden_at_default) return false;
  return is_blank(value) || String(value) === String(field.default_value ?? '');
}

function describe_default(field: SetupField): string {
  const fallback = field.default_value;
  if (fallback === null) return field.has_default ? 'default' : 'any';
  if (fallback === '') return field.empty_means ?? 'any';
  return describe_value(field, fallback);
}

function describe_value(field: SetupField, value: unknown): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (field.unit) return `${value} ${field.unit}`;
  return format_shouted_word(String(value));
}

function format_shouted_word(text: string): string {
  if (!/^[A-Z]{2,}$/.test(text)) return text;
  return text.charAt(0) + text.slice(1).toLowerCase();
}
