/**
 * `@cutaway/project-io` — reading, writing, migrating, and repairing projects.
 *
 * Pure and DOM-free. Storage lives elsewhere; this package only turns bytes
 * into a document you can trust, and back again. That includes the portable
 * `.desktopstage` archive, which takes a blob store as a parameter rather than
 * importing one, so the package stays testable without a browser.
 */

export * from "./migrate";
export * from "./validate";
export * from "./serialize";
export * from "./archive";
