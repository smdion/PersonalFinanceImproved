/** The privacy-mode cookie, and the browser-side flag the formatters read. */

/**
 * Privacy mode (hide dollar amounts). Cookie name shared by the browser
 * toggle (PrivacyProvider) and the server, which skips page prefetch while
 * it's set so the server render never contains amounts.
 */
export const PRIVACY_COOKIE = "ledgr-privacy";

// Module-level so plain formatCurrency calls need no hook. Set only in the
// browser: on the server it would leak one user's choice into another's render
// (the server never renders amounts while privacy is on; see prefetchForPage).
let privacyMode = false;

export function setPrivacyMode(on: boolean): void {
  privacyMode = on;
}

export function isPrivacyMode(): boolean {
  return privacyMode;
}
