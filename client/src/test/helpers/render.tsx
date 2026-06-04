/**
 * Custom render helper that wraps @testing-library/react render
 * with common providers (router, auth state) for component tests.
 */
import { type RenderOptions, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { setupAuthenticatedStores, setupUnauthenticatedStores } from './store-helpers';

interface CustomRenderOptions extends RenderOptions {
  /** Set up stores as authenticated before rendering. Default: true. */
  authenticated?: boolean;
}

/**
 * Render a component element with stores pre-configured.
 * By default sets up authenticated stores. Pass `authenticated: false`
 * for unauthenticated rendering.
 */
export function renderWithProviders(ui: ReactElement, opts?: CustomRenderOptions) {
  if (opts?.authenticated !== false) {
    setupAuthenticatedStores();
  } else {
    setupUnauthenticatedStores();
  }

  return render(ui);
}

export { render, screen, waitFor, within } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
