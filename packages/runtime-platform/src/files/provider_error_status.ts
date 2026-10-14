export function provider_error_status(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  if ('status' in error && typeof (error as { status?: unknown }).status === 'number') {
    return (error as { status: number }).status;
  }
  return undefined;
}
