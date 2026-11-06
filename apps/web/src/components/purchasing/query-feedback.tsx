import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';

export function QueryError({ error, retry }: { error: unknown; retry: () => unknown }) {
  return (
    <div className="alert alert-error" role="alert">
      {errorMessage(error)}{' '}
      <Button variant="outline" size="sm" onClick={() => retry()}>
        Thử lại
      </Button>
    </div>
  );
}
