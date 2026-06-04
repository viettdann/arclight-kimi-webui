/**
 * Shared react-router mock for component tests.
 *
 * Usage:
 *   import { mockRouter } from '../helpers/mock-router';
 *   mockRouter({ params: { id: 'sess-1' }, pathname: '/session/sess-1' });
 *
 * Call in beforeEach or at the top of a describe block. Subsequent calls
 * update the holder object in-place so the mock stays current.
 */
import { vi } from 'vitest';

export interface RouterHolder {
  params: Record<string, string | undefined>;
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
}

/** Mutable holder — tests can update fields between tests. */
export const routerHolder: RouterHolder = {
  params: {},
  pathname: '/',
  search: '',
  hash: '',
  state: null,
};

/**
 * Install the react-router mock. Call once per test file (or per describe).
 * Updates `routerHolder` fields; the mock reads from it on every render.
 */
export function mockRouter(overrides?: Partial<RouterHolder>) {
  Object.assign(routerHolder, overrides);

  vi.mock('react-router', async () => {
    const actual = await vi.importActual<typeof import('react-router')>('react-router');
    return {
      ...actual,
      useParams: () => routerHolder.params,
      useLocation: () => ({
        pathname: routerHolder.pathname,
        search: routerHolder.search,
        hash: routerHolder.hash,
        state: routerHolder.state,
        key: 'default',
      }),
      useNavigate: () => vi.fn(),
      useSearchParams: () => [new URLSearchParams(routerHolder.search), vi.fn()],
    };
  });
}
