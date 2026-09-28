/**
 * Switches for things that are built and correct but deliberately not public yet.
 *
 * A flag here is a promise that the feature still works — it is not a graveyard.
 * Anything switched off permanently should be deleted instead, so this file never
 * becomes a list of code nobody can safely remove.
 */

/**
 * The /tour page, its nav and footer links, its sitemap entry and its llms.txt
 * lines. Off since 2026-09-18 at Gobbe's request.
 *
 * Two of the four 2026 dates are not fully confirmed — Vancouver has no ticket
 * page anywhere, and the San Francisco listing does not name Yanchan — so the
 * page is hidden rather than published with dates that may move. The data in
 * `TOUR` (src/lib/content.ts) is untouched and still correct for the two
 * confirmed shows.
 *
 * Flip to `true` to restore all five surfaces at once. While it is `false`,
 * /tour answers with a temporary redirect to the homepage, so the URL keeps
 * working and search engines are told nothing permanent.
 */
// Typed `boolean`, not inferred as the literal `false`, so flipping it never
// leaves the other branch of a check looking like dead code to the compiler.
export const TOUR_PUBLIC: boolean = false;
