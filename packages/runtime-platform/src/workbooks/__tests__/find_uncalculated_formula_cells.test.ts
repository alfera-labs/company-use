import { build_stored_zip } from '@runtime-platform/workbooks/__tests__/build_stored_zip';
import { find_uncalculated_formula_cells } from '@runtime-platform/workbooks/find_uncalculated_formula_cells';
import { describe, expect, it } from 'vitest';

function sheet_xml(cells: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet><sheetData><row r="2">' +
    cells +
    '</row></sheetData></worksheet>'
  );
}

function workbook_with_sheet(cells: string): Uint8Array {
  return build_stored_zip([{ name: 'xl/worksheets/sheet1.xml', content: sheet_xml(cells) }]);
}

describe('find_uncalculated_formula_cells', () => {
  it('does not flag a formula cell with a cached zero value', () => {
    const file_bytes = workbook_with_sheet('<c r="D2" s="3"><f>C2-B2</f><v>0</v></c>');
    expect(find_uncalculated_formula_cells(file_bytes)).toEqual([]);
  });

  it('flags a numeric formula cell with an empty cached value', () => {
    const file_bytes = workbook_with_sheet('<c r="D2" s="3"><f>C2-B2</f><v></v></c>');
    expect(find_uncalculated_formula_cells(file_bytes)).toEqual([
      { sheet_path: 'xl/worksheets/sheet1.xml', cell: 'D2' },
    ]);
  });

  it('accepts an intentionally blank cached string result', () => {
    const file_bytes = workbook_with_sheet(
      '<c r="D2" s="3" t="str"><f>IF(C2=0,"",C2)</f><v></v></c>',
    );
    expect(find_uncalculated_formula_cells(file_bytes)).toEqual([]);
  });

  it('flags a formula cell with no cached value tag at all', () => {
    const file_bytes = workbook_with_sheet('<c r="D3"><f>A1+A2</f></c>');
    expect(find_uncalculated_formula_cells(file_bytes)).toEqual([
      { sheet_path: 'xl/worksheets/sheet1.xml', cell: 'D3' },
    ]);
  });

  it('returns nothing for a workbook with no formulas', () => {
    const file_bytes = workbook_with_sheet('<c r="A1"><v>42</v></c>');
    expect(find_uncalculated_formula_cells(file_bytes)).toEqual([]);
  });

  it('fails open on garbage bytes instead of throwing', () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(() => find_uncalculated_formula_cells(garbage)).not.toThrow();
    expect(find_uncalculated_formula_cells(garbage)).toEqual([]);
  });

  it('stops collecting after the cap instead of scanning unbounded', () => {
    const cells = Array.from({ length: 80 }, (_, i) => `<c r="A${i}"><f>A${i}+1</f></c>`).join('');
    const file_bytes = workbook_with_sheet(cells);
    expect(find_uncalculated_formula_cells(file_bytes).length).toBe(50);
  });
});
