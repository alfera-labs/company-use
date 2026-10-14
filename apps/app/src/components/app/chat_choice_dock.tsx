import type { PresentChoices, PresentChoicesQuestion } from '@coworker/shared';
import { cn } from '@coworker/ui/lib/utils';
import { ChevronLeft, ChevronRight, CornerDownLeft, ListChecks, Pencil, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityChevron,
  ActivityGlyph,
  activity_row_class_name,
} from '@/components/app/chat_activity_row';
import { useChatUiStore } from '@/components/app/chat_ui_store';

type ChoiceAnswer = string | null;

const skipped_answer_words =
  'skipped - make a reasonable assumption and tell me which one you made';

export const not_answerable_yet_words = 'Getting ready to take your answer…';

export function combined_choice_reply(
  questions: readonly PresentChoicesQuestion[],
  answers: readonly ChoiceAnswer[],
) {
  const [only_question] = questions;
  if (questions.length === 1 && only_question) return answers[0] ?? skipped_answer_words;
  return (
    questions
      .map(
        (question, index) =>
          `${question_as_label(question.question)}: ${answers[index] ?? skipped_answer_words}`,
      )
      // Paragraph breaks, not single newlines: the reply renders as markdown, which folds a lone
      // newline into a space and turns three answers into one run-on line.
      .join('\n\n')
  );
}

const trailing_question_punctuation_re = /[\s?:]+$/u;

function question_as_label(question: string) {
  return question.replace(trailing_question_punctuation_re, '');
}

export function record_choice_answer(
  questions: readonly PresentChoicesQuestion[],
  answers: readonly ChoiceAnswer[],
  question_index: number,
  answer: ChoiceAnswer,
) {
  const next_answers = [...answers];
  next_answers[question_index] = answer;
  const is_last_question = question_index === questions.length - 1;
  return {
    answers: next_answers,
    next_question_index: is_last_question ? question_index : question_index + 1,
    reply: is_last_question ? combined_choice_reply(questions, next_answers) : '',
  };
}

const panel_entrance_transition = { duration: 0.34, ease: [0.22, 1, 0.36, 1] as const };

export function ChatChoiceDock({
  choiceKey,
  choices,
  isAnswerable,
  onAnswer,
}: {
  choiceKey: string;
  choices: PresentChoices;
  isAnswerable: boolean;
  onAnswer: (message_text: string) => Promise<boolean>;
}) {
  return (
    <ChoicePanel
      choices={choices}
      isAnswerable={isAnswerable}
      key={choiceKey}
      onAnswer={onAnswer}
    />
  );
}

function ChoicePanel({
  choices,
  isAnswerable,
  onAnswer,
}: {
  choices: PresentChoices;
  isAnswerable: boolean;
  onAnswer: (message_text: string) => Promise<boolean>;
}) {
  const reduce_motion = useReducedMotion();
  const set_choice_panel_open = useChatUiStore((state) => state.set_choice_panel_open);
  const [question_index, set_question_index] = useState(0);
  const [answers, set_answers] = useState<ChoiceAnswer[]>([]);
  const [highlights, set_highlights] = useState<Record<number, number>>({});
  const [writing_by_question, set_writing_by_question] = useState<Record<number, boolean>>({});
  const [is_sent, set_is_sent] = useState(false);
  const question = choices.questions[question_index];
  const options = question?.options ?? [];
  const write_in_index = options.length;
  const highlight = highlights[question_index] ?? recommended_option_index(question) ?? 0;
  const is_writing = writing_by_question[question_index] ?? question?.kind === 'text';
  const enter_disarmed_until = useRef(0);

  function set_writing(writing: boolean) {
    set_writing_by_question({ ...writing_by_question, [question_index]: writing });
    if (writing) set_highlights({ ...highlights, [question_index]: write_in_index });
  }

  function answer_question(answer: ChoiceAnswer) {
    const step = record_choice_answer(choices.questions, answers, question_index, answer);
    set_answers(step.answers);
    set_question_index(step.next_question_index);
    if (step.next_question_index !== question_index) {
      enter_disarmed_until.current = performance.now() + 400;
      return;
    }
    void send_reply(step.reply);
  }

  async function send_reply(reply: string) {
    set_is_sent(true);
    if (!(await onAnswer(reply))) set_is_sent(false);
  }

  function answer_the_rest_as_skipped() {
    void send_reply(combined_choice_reply(choices.questions, answers));
  }

  useEffect(() => {
    if (!question) return;
    function read_key(event: KeyboardEvent) {
      if (!question || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!isAnswerable || is_typing_somewhere()) return;
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= options.length) {
        event.preventDefault();
        answer_question(options[digit - 1]?.label ?? null);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (step !== 0) {
        event.preventDefault();
        const row_count = options.length + 1;
        set_highlights({
          ...highlights,
          [question_index]: (highlight + step + row_count) % row_count,
        });
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (performance.now() < enter_disarmed_until.current) return;
        if (highlight === write_in_index) set_writing(true);
        else answer_question(options[highlight]?.label ?? null);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        answer_the_rest_as_skipped();
      }
    }
    window.addEventListener('keydown', read_key);
    return () => window.removeEventListener('keydown', read_key);
  });

  useEffect(() => {
    if (is_sent) return;
    set_choice_panel_open(true);
    return () => set_choice_panel_open(false);
  }, [is_sent, set_choice_panel_open]);

  if (!question || is_sent) return null;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="mb-2 rounded-[16px] border border-border bg-raised px-[18px] pt-[15px] pb-[13px]"
      initial={reduce_motion ? false : { opacity: 0, y: 4 }}
      role="group"
      transition={reduce_motion ? { duration: 0 } : panel_entrance_transition}
    >
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 font-medium text-[15px] text-foreground">
          {question.question}
        </p>
        {choices.questions.length > 1 ? (
          <ChoicePager
            index={question_index}
            onMove={(next) => set_question_index(next)}
            total={choices.questions.length}
          />
        ) : null}
        <button
          aria-label="Answer the rest as skipped"
          className="-mr-1 shrink-0 rounded-xl p-1 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
          disabled={!isAnswerable}
          onClick={answer_the_rest_as_skipped}
          type="button"
        >
          <X aria-hidden="true" className="size-[15px] stroke-[1.5]" />
        </button>
      </div>
      {question.stakes ? (
        <p className="mt-1 text-[13px] text-muted-foreground">{question.stakes}</p>
      ) : null}
      {isAnswerable ? null : (
        <p className="mt-1 text-[13px] text-muted-foreground">{not_answerable_yet_words}</p>
      )}
      <fieldset
        className="mt-2.5 flex min-w-0 flex-col disabled:opacity-50"
        disabled={!isAnswerable}
      >
        {options.map((option, index) => (
          <ChoiceOptionRow
            index={index}
            isHighlighted={index === highlight}
            key={option.label}
            onHighlight={() => set_highlights({ ...highlights, [question_index]: index })}
            onSelect={() => answer_question(option.label)}
            option={option}
          />
        ))}
        <ChoiceWriteInRow
          isHighlighted={highlight === write_in_index}
          isWriting={is_writing}
          key={`write-in-${question_index}`}
          onCollapse={() => set_writing(false)}
          onExpand={() => set_writing(true)}
          onSkip={() => answer_question(null)}
          onWritten={(text) => answer_question(text)}
          rowLabel={question.kind === 'text' ? 'Type your answer' : 'Something else'}
          showSeparator={options.length > 0}
          {...(question.placeholder ? { placeholder: question.placeholder } : {})}
        />
      </fieldset>
    </motion.div>
  );
}

function ChoicePager({
  index,
  onMove,
  total,
}: {
  index: number;
  onMove: (next: number) => void;
  total: number;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 text-[12.5px] text-muted-foreground">
      <PagerArrow
        disabled={index === 0}
        icon={ChevronLeft}
        label="Previous question"
        onClick={() => onMove(index - 1)}
      />
      <span className="tabular-nums">
        {index + 1} of {total}
      </span>
      <PagerArrow
        disabled={index === total - 1}
        icon={ChevronRight}
        label="Next question"
        onClick={() => onMove(index + 1)}
      />
    </div>
  );
}

function PagerArrow({
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  disabled: boolean;
  icon: typeof ChevronLeft;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="rounded-xl p-0.5 transition-colors hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" className="size-[14px] stroke-[1.75]" />
    </button>
  );
}

const option_row_class_name =
  'flex w-full items-start gap-2.5 rounded-[10px] px-2 py-[10px] text-left transition-colors hover:bg-hover';

function ChoiceOptionRow({
  index,
  isHighlighted,
  onHighlight,
  onSelect,
  option,
}: {
  index: number;
  isHighlighted: boolean;
  onHighlight: () => void;
  onSelect: () => void;
  option: NonNullable<PresentChoicesQuestion['options']>[number];
}) {
  return (
    <button
      className={cn(
        option_row_class_name,
        index > 0 && 'border-border border-t',
        isHighlighted && 'bg-hover',
      )}
      onClick={onSelect}
      onFocus={onHighlight}
      onMouseEnter={onHighlight}
      type="button"
    >
      <ChoiceChip>{index + 1}</ChoiceChip>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-[13.5px] text-foreground">{option.label}</span>
        {option.description ? (
          <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
            {option.description}
          </span>
        ) : null}
      </span>
      {isHighlighted ? (
        <CornerDownLeft
          aria-hidden="true"
          className="mt-[3px] size-[13px] shrink-0 stroke-[1.75] text-muted-foreground"
        />
      ) : null}
    </button>
  );
}

function ChoiceWriteInRow({
  isHighlighted,
  isWriting,
  onCollapse,
  onExpand,
  onSkip,
  onWritten,
  placeholder,
  rowLabel,
  showSeparator,
}: {
  isHighlighted: boolean;
  isWriting: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onSkip: () => void;
  onWritten: (text: string) => void;
  placeholder?: string | undefined;
  rowLabel: string;
  showSeparator: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 pr-2 pl-0',
        showSeparator && 'border-border border-t',
      )}
    >
      {isWriting ? (
        <ChoiceWriteInInput
          onCollapse={onCollapse}
          onWritten={onWritten}
          placeholder={placeholder ?? 'Type your answer...'}
        />
      ) : (
        <button
          className={cn(option_row_class_name, 'flex-1 items-center', isHighlighted && 'bg-hover')}
          onClick={onExpand}
          type="button"
        >
          <ChoiceChip>
            <Pencil aria-hidden="true" className="size-[11px] stroke-[1.75]" />
          </ChoiceChip>
          <span className="min-w-0 flex-1 text-[13.5px] text-muted-foreground">{rowLabel}</span>
          {isHighlighted ? (
            <CornerDownLeft
              aria-hidden="true"
              className="size-[13px] shrink-0 stroke-[1.75] text-muted-foreground"
            />
          ) : null}
        </button>
      )}
      <button
        className="shrink-0 rounded-full border border-border px-[13px] py-[5px] text-[12.5px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        onClick={onSkip}
        type="button"
      >
        Skip
      </button>
    </div>
  );
}

function ChoiceWriteInInput({
  onCollapse,
  onWritten,
  placeholder,
}: {
  onCollapse: () => void;
  onWritten: (text: string) => void;
  placeholder: string;
}) {
  const [text, set_text] = useState('');

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-[10px]">
      <ChoiceChip>
        <Pencil aria-hidden="true" className="size-[11px] stroke-[1.75]" />
      </ChoiceChip>
      <input
        className="min-w-0 flex-1 rounded-[10px] border border-border border-dashed bg-transparent px-2.5 py-[7px] text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground focus:border-solid"
        onChange={(event) => set_text(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && text.trim()) {
            event.preventDefault();
            onWritten(text.trim());
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onCollapse();
          }
        }}
        placeholder={placeholder}
        ref={(node) => node?.focus()}
        type="text"
        value={text}
      />
    </div>
  );
}

function ChoiceChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-px flex size-[19px] shrink-0 items-center justify-center rounded-[6px] bg-hover font-medium text-[11px] text-muted-foreground">
      {children}
    </span>
  );
}

export function ChoiceTraceRow({ words }: { words: string }) {
  return (
    <div className={cn(activity_row_class_name, 'w-fit max-w-full')}>
      <ActivityChevron expandable={false} open={false} />
      <ActivityGlyph icon={ListChecks} />
      <span className="min-w-0">
        Asked you to choose
        <span className="ml-1 text-muted-foreground">{words}</span>
      </span>
    </div>
  );
}

export function ChoiceAnsweredRow({ question, reply }: { question: string; reply: string }) {
  return (
    <div className={cn(activity_row_class_name, 'w-fit max-w-full')}>
      <ActivityChevron expandable={false} open={false} />
      <ActivityGlyph icon={ListChecks} />
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">{question}</span>
        {chosen_labels_of(reply).map((chosen) => (
          <span
            className="max-w-[16rem] truncate rounded-full bg-hover px-2 py-0.5 text-[12px] text-foreground"
            key={chosen.line}
          >
            {chosen.label}
          </span>
        ))}
      </span>
    </div>
  );
}

function chosen_labels_of(reply: string) {
  return reply
    .split('\n')
    .map((line) => ({ line, label: label_of_reply_line(line) }))
    .filter((chosen) => chosen.label)
    .slice(0, 3);
}

function label_of_reply_line(line: string) {
  const label = line.slice(line.lastIndexOf(': ') + 1).trim();
  return label === skipped_answer_words ? 'Skipped' : label;
}

function recommended_option_index(question: PresentChoicesQuestion | undefined) {
  const index = (question?.options ?? []).findIndex(
    (option) => option.label === question?.recommended_option,
  );
  return index === -1 ? undefined : index;
}

const typing_element_names = new Set(['INPUT', 'TEXTAREA']);

function is_typing_somewhere() {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  return typing_element_names.has(active.tagName) || active.isContentEditable;
}
