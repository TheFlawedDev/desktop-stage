/**
 * Schema migrations.
 *
 * A project saved today must still open in two years. That promise is only
 * keepable if every breaking change to the document ships with a migration at
 * the same time — so the chain lives here, next to the loader, rather than
 * being remembered by whoever changed the schema.
 *
 * Rules:
 * - A migration takes the document *at version N* and returns it at N+1.
 * - Migrations are pure and must never throw. A document that cannot be
 *   migrated is still returned, and validation downstream decides what to keep.
 * - Never edit an existing migration once released; add a new one.
 */

import { SCHEMA_VERSION } from "@cutaway/types";

export type RawDocument = Record<string, unknown>;

export interface Migration {
  /** Version this migration upgrades *from*. */
  from: number;
  describe: string;
  apply: (document: RawDocument) => RawDocument;
}

/**
 * Desktop Stage content types are versioned inside the string (`…/app@1`), and
 * drafts of the extension wrote them without a version. This maps a bare family
 * name onto the version this build reads.
 */
const DESKTOP_CONTENT_BASE_TYPES: readonly string[] = [
  "desktop-stage/app",
  "desktop-stage/action",
  "desktop-stage/cursor",
  "desktop-stage/camera",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns a clip with its unversioned Desktop Stage content type stamped, or null. */
function stampClipContentType(clip: unknown): unknown | null {
  if (!isRecord(clip) || !isRecord(clip.content)) return null;

  const content = clip.content;
  if (content.kind !== "plugin" || typeof content.contentType !== "string") return null;
  if (!DESKTOP_CONTENT_BASE_TYPES.includes(content.contentType)) return null;

  return { ...clip, content: { ...content, contentType: `${content.contentType}@1` } };
}

/**
 * Stamps the current version onto unversioned Desktop Stage plugin content.
 *
 * Only ever reached by documents that predate the versioned content types: any
 * document this build writes already carries `@1`, and an `@2` payload is left
 * untouched so validation can report it as unsupported rather than silently
 * downgrading it.
 */
function stampDesktopContentVersions(document: RawDocument): RawDocument {
  const entities = isRecord(document.entities) ? document.entities : null;
  const clips = entities && isRecord(entities.clips) ? entities.clips : null;
  if (!entities || !clips) return document;

  let changed = false;
  const nextClips: Record<string, unknown> = {};

  for (const [id, clip] of Object.entries(clips)) {
    const stamped = stampClipContentType(clip);
    if (stamped) {
      nextClips[id] = stamped;
      changed = true;
    } else {
      nextClips[id] = clip;
    }
  }

  if (!changed) return document;
  return { ...document, entities: { ...entities, clips: nextClips } };
}

/**
 * Ordered migration chain.
 *
 * Version 1 is the first released schema, so the only entry handles documents
 * that were never stamped at all — drafts, hand-authored files, and anything
 * recovered from a partial write. The machinery exists now, before it is needed:
 * retrofitting migrations after users have saved projects means the earliest
 * documents are already unreadable.
 */
export const MIGRATIONS: Migration[] = [
  {
    from: 0,
    describe: "Stamp Desktop Stage plugin content versions",
    apply: stampDesktopContentVersions,
  },
];

export interface MigrationResult {
  document: RawDocument;
  /** Human-readable log of what ran, surfaced when a project is opened. */
  applied: string[];
  /** True when the document is newer than this build understands. */
  fromFuture: boolean;
}

export function migrateDocument(input: RawDocument): MigrationResult {
  const applied: string[] = [];
  let document = input;

  const rawVersion = document.schemaVersion;
  let version = typeof rawVersion === "number" && Number.isFinite(rawVersion) ? rawVersion : 0;

  // A document from a newer build may contain fields this one will drop on
  // save. Flagged so the UI can warn before silently downgrading the user's work.
  if (version > SCHEMA_VERSION) {
    return { document, applied, fromFuture: true };
  }

  while (version < SCHEMA_VERSION) {
    const migration = MIGRATIONS.find((candidate) => candidate.from === version);
    if (!migration) {
      // No path forward. Stamp the current version and let validation repair
      // what it can rather than refusing to open the project at all.
      document = { ...document, schemaVersion: SCHEMA_VERSION };
      break;
    }

    document = migration.apply(document);
    applied.push(migration.describe);
    version += 1;
    document = { ...document, schemaVersion: version };
  }

  return { document, applied, fromFuture: false };
}
