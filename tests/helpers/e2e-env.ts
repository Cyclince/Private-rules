/** Shared by Playwright configuration and tests, including CSRF headers and extra contexts. */
export const E2E_PORT = process.env.E2E_PORT || '5180';
export const E2E_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;
