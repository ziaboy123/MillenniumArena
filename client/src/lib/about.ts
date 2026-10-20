// What the site says about itself: where its source code is (AGPL-3.0 section 13: everyone using it can get the
// exact source it's running), who the cards belong to, and where the data comes from.
export const REPO = 'https://github.com/ziaboy123/MillenniumArena';
/** The source of exactly this build. */
export const SOURCE_URL = __COMMIT__ ? `${REPO}/tree/${__COMMIT__}` : REPO;
export const VERSION = __COMMIT__ ? __COMMIT__.slice(0, 7) : 'development';
export const KONAMI = 'Yu-Gi-Oh! is a trademark of Konami Digital Entertainment. Card names, text and artwork © Studio Dice/SHUEISHA, TV TOKYO, KONAMI. '
  + 'This is an unofficial fan project, not affiliated with or endorsed by Konami.';
export const CONTACT = 'mail@daniyalzia.co.uk';
