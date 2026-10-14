/**
 * Writing a user-controlled key onto a plain object.
 *
 * Entity ids, media ids, and effect-parameter names all come straight from the
 * file, and `JSON.parse('{"__proto__": 1}')` produces an *own* `"__proto__"`
 * data property. A plain `map["__proto__"] = value` assignment never stores it:
 * it invokes the `Object.prototype` setter, silently replacing the map's
 * prototype — the value vanishes from `Object.keys`/`Object.values`/`JSON`,
 * and an inherited object answers for that key instead.
 *
 * `Object.defineProperty` bypasses the setter and always creates an own
 * enumerable property. Keep every write on a map keyed by file data going
 * through here: the reader half of this class is in `validate.ts`.
 */
export function setOwn<T>(map: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(map, key, { value, enumerable: true, writable: true, configurable: true });
}
