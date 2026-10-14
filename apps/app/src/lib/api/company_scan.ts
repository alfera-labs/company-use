export type CompanyScanFinding = {
  name?: string;
  offer?: string;
  steps?: string[];
  title: string;
  body: string;
  prompt: string;
  evidence?: string;
  source_url?: string;
  tools?: { name: string; logo_url: string }[];
};

export type CompanyScan = {
  company_name: string;
  company_kind?: string;
  summary: string;
  scan_facts: string[];
  findings: CompanyScanFinding[];
  sources?: { label: string; url: string }[];
  gaps?: string[];
  scanned_url: string | null;
  scanned_at: string;
};

export type CompanyScanResult = {
  company_scan: CompanyScan | null;
  reason?: 'scan_failed';
};

type ScanCarrier = { company_scan?: CompanyScan | null; email_domain?: string | null };

export function read_company_scan(payload: object | null | undefined): CompanyScan | null {
  return (payload as ScanCarrier | null | undefined)?.company_scan ?? null;
}

export function read_email_domain(payload: object | null | undefined): string | null {
  return (payload as ScanCarrier | null | undefined)?.email_domain ?? null;
}
