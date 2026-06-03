import { FileQuestion, Home, RotateCcw, ShieldOff, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router';
import { Button } from '@/components/ui/button';

interface ErrorPresentation {
  code: string;
  title: string;
  description: string;
  icon: ReactNode;
}

// Maps an HTTP-ish status (from a thrown route Response or a no-match 404) to
// user-facing copy. Falls back to a generic "something went wrong" for runtime
// errors (status 0) and any status we don't special-case.
function presentationFor(status: number, statusText?: string): ErrorPresentation {
  switch (status) {
    case 404:
      return {
        code: '404',
        title: 'Page not found',
        description: "The page you're looking for doesn't exist or may have been moved.",
        icon: <FileQuestion className="h-7 w-7" />,
      };
    case 401:
    case 403:
      return {
        code: String(status),
        title: 'Access denied',
        description: "You don't have permission to view this page.",
        icon: <ShieldOff className="h-7 w-7" />,
      };
    case 500:
      return {
        code: '500',
        title: 'Server error',
        description: 'Something went wrong on our end. Please try again in a moment.',
        icon: <TriangleAlert className="h-7 w-7" />,
      };
    default:
      return {
        code: status > 0 ? String(status) : 'Error',
        title: statusText || 'Something went wrong',
        description: 'An unexpected error occurred. Try reloading the page.',
        icon: <TriangleAlert className="h-7 w-7" />,
      };
  }
}

// Standalone error page. Rendered both as the router's `errorElement` (catching
// thrown errors and React Router's synthetic 404 for unmatched URLs) and via the
// catch-all route. Self-contained so it works without the Shell chrome.
export function ErrorView() {
  const error = useRouteError();
  const navigate = useNavigate();

  let status = 0;
  let statusText: string | undefined;
  let detail: string | undefined;

  if (isRouteErrorResponse(error)) {
    status = error.status;
    statusText = error.statusText;
    detail = typeof error.data === 'string' ? error.data : undefined;
  } else if (error instanceof Error) {
    detail = error.message;
  }

  const { code, title, description, icon } = presentationFor(status, statusText);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
        <p className="mt-5 font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {code}
        </p>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
        {detail && detail !== title && (
          <p className="mt-4 max-h-32 overflow-y-auto rounded-lg border border-border bg-muted/50 px-3 py-2 text-left font-mono text-xs text-muted-foreground">
            {detail}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button type="button" onClick={() => navigate('/')} className="h-10 gap-2">
            <Home className="h-4 w-4" />
            Back to home
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(0)}
            className="h-10 gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Reload
          </Button>
        </div>
      </div>
    </div>
  );
}
