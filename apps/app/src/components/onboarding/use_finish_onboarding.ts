import { format_error_message } from '@coworker/shared';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { type CompanyScanFinding, complete_onboarding } from '@/lib/api';

export function useFinishOnboarding(return_to: string) {
  const finish_onboarding = useMutation({
    mutationFn: complete_onboarding,
    onError: (error) => {
      toast.error(format_error_message(error, 'Could not finish onboarding.'));
    },
  });

  const picked_job_name = useRef<string | undefined>(undefined);
  const remember_picked_job = useCallback((job: CompanyScanFinding | undefined) => {
    picked_job_name.current = job?.name;
  }, []);

  const { mutateAsync: complete_onboarding_now } = finish_onboarding;
  const leaving_ref = useRef(false);
  const finish_and_leave = useCallback(
    async (destination: string | null) => {
      if (leaving_ref.current) return;
      leaving_ref.current = true;
      try {
        const record = await complete_onboarding_now(picked_job_name.current);
        if (return_to !== '/') {
          window.location.replace(return_to);
          return;
        }
        if (destination) {
          window.location.href = destination;
          return;
        }
        window.location.replace(
          record.first_session_id ? `/chats/${record.first_session_id}` : '/',
        );
      } catch {
        leaving_ref.current = false;
      }
    },
    [complete_onboarding_now, return_to],
  );

  return { is_finishing: finish_onboarding.isPending, finish_and_leave, remember_picked_job };
}
