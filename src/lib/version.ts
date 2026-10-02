/**
 * Single place the UI reads the build identity from. Keep in sync with the `version`
 * field in package.json — it was hardcoded inside Settings markup before, where nobody
 * thinks to look when cutting a release.
 */
export const APP_NAME = 'LomifyNEXT';
export const APP_VERSION = '1.0.26';
export const APP_PACKAGE_VERSION = '1.0.26';
export const APP_CHANNEL = 'beta';
