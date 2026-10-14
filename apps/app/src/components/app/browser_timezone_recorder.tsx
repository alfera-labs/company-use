import { useMyTimezone } from '@/components/app/use_my_timezone';

export function BrowserTimezoneRecorder() {
  useMyTimezone();
  return null;
}
