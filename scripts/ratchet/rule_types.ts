import type ts from 'typescript';

export type RatchetViolation = { readonly line: number; readonly message: string; readonly weight?: number };

export type RatchetRuleInput = { readonly file_path: string; readonly source_text: string; readonly source_file: ts.SourceFile };

export type RatchetRuleSample = { readonly file_path: string; readonly source_text: string; readonly expected_count: number };

export type RatchetRule = {
  readonly rule_id: string;
  readonly summary: string;
  readonly why: string;
  readonly how_to_fix: string;
  readonly applies_to: (file_path: string) => boolean;
  readonly find_violations: (input: RatchetRuleInput) => readonly RatchetViolation[];
  readonly self_test_samples?: readonly RatchetRuleSample[];
};
