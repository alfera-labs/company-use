import type { DeployLook } from '@coworker/ui/lib/company_use_deploy/deploy_look';
import { cn } from '@coworker/ui/lib/utils';
import { auth_button_classes, auth_input_classes } from '@/components/auth/auth_form_classes';

const small_choice_input = '[&_input]:mt-[3px] [&_input]:size-4 [&_input]:accent-[#131110]';
const round_mark = 'size-2.5 shrink-0 rounded-full';

export const app_deploy_look: DeployLook = {
  screen: 'flex flex-col',
  title: 'mt-9 text-[33px] font-semibold leading-tight tracking-[-0.022em]',
  lead: 'mt-3 text-[15px] leading-relaxed text-[#7a736c]',
  form: 'mt-8 flex flex-col gap-5',
  clouds: 'm-0 flex flex-col gap-2.5 border-0 p-0',
  cloud: cn(
    'flex cursor-pointer items-start gap-3.5 rounded-[16px] border border-[#e2ded9] bg-white px-5 py-4 transition-colors hover:border-[#c9c2ba]',
    small_choice_input,
  ),
  cloud_picked: 'border-[#131110] shadow-[0_0_0_1px_#131110] hover:border-[#131110]',
  cloud_unavailable: 'cursor-default bg-[#f3f1ee] hover:border-[#e2ded9]',
  cloud_text: 'grid gap-0.5',
  cloud_name: 'flex items-center gap-2 text-[16px] font-semibold',
  cloud_note: 'text-[14px] leading-snug text-[#7a736c]',
  chip: 'rounded-full border border-[#e2ded9] bg-[#f3f1ee] px-2 py-0.5 text-[12px] font-medium text-[#7a736c]',
  field: 'flex flex-col gap-2',
  label: 'px-1 text-[14px] font-medium',
  optional: 'font-normal text-[#a8a29b]',
  input: cn(auth_input_classes, 'aria-[invalid=true]:border-[#d03500]'),
  hint: 'px-1 text-[13.5px] text-[#7a736c]',
  hint_wrong: 'text-[#d03500]',
  address: 'whitespace-nowrap font-medium text-[#131110]',
  check: cn('flex cursor-pointer items-start gap-2.5 px-1 text-[15px]', small_choice_input),
  main_button: cn(auth_button_classes, 'mt-8 flex items-center justify-center'),
  second_button:
    'mt-4 flex h-[62px] w-full items-center justify-center rounded-full border border-[#e2ded9] bg-white text-[16.5px] font-semibold text-[#131110] transition-colors hover:border-[#c9c2ba]',
  privacy: 'px-1 text-[13px] leading-relaxed text-[#a8a29b]',
  rows: 'mt-8 flex flex-col border-t border-[#ebe7e2]',
  row: 'flex items-center gap-3 border-b border-[#ebe7e2] px-0.5 py-3.5 text-[15px]',
  row_by_state: { waiting: 'text-[#a8a29b]', live: '', done: '' },
  mark_by_state: {
    waiting: cn(round_mark, 'border border-[#d6d0c9] bg-white'),
    live: cn(round_mark, 'animate-pulse bg-brand'),
    done: cn(round_mark, 'bg-[#2f8a4c]'),
  },
  row_title: 'flex-1',
  row_time: 'font-mono text-[13px] tabular-nums text-[#7a736c]',
  visually_hidden: 'sr-only',
};
