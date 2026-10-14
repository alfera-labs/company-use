import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@coworker/ui/components/alert-dialog';
import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { create_project } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const query_client = useQueryClient();
  const [name, set_name] = useState('');

  const create = useMutation({
    mutationFn: () => create_project(name.trim()),
    onSuccess: (project) => {
      query_client.invalidateQueries({ queryKey: query_keys.projects() });
      set_name('');
      onOpenChange(false);
      navigate({ href: `/projects/${project.project_id}` });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !create.isPending) create.mutate();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>What would you like to call the project?</AlertDialogTitle>
          </AlertDialogHeader>
          <Input
            autoFocus
            className="mt-3"
            placeholder="Marketing"
            value={name}
            onChange={(event) => set_name(event.target.value)}
          />
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button disabled={!name.trim() || create.isPending} type="submit">
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Create
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
