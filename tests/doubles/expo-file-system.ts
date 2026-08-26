/**
 * A small in-memory filesystem standing in for `expo-file-system`.
 *
 * Only what `src/offline/media.ts` touches. The point of testing that module is
 * its delete guard: `local_uri` for a row that was never copied still points at
 * the camera cache or, worse, at the user's photo library, and deleting there
 * would destroy an original the app does not own.
 */

const files = new Map<string, number>();
const directories = new Set<string>();

export function __reset(): void {
  files.clear();
  directories.clear();
}

export function __seedFile(uri: string, size = 1024): void {
  files.set(uri, size);
}

export function __exists(uri: string): boolean {
  return files.has(uri);
}

export function __files(): string[] {
  return [...files.keys()];
}

/**
 * Join URI parts without flattening the scheme.
 *
 * Collapsing every run of slashes turns `file:///app/x` into `file:/app/x`,
 * which then fails to match anything the module wrote. Only the path after the
 * scheme is normalised.
 */
function join(...parts: string[]): string {
  const raw = parts.filter(Boolean).join("/");
  const match = raw.match(/^([a-z][a-z0-9+.-]*:\/\/)(.*)$/i);
  if (!match) return raw.replace(/\/{2,}/g, "/");
  return match[1] + match[2].replace(/\/{2,}/g, "/");
}

export class Directory {
  uri: string;

  constructor(...parts: (string | Directory)[]) {
    this.uri = join(...parts.map((part) => (typeof part === "string" ? part : part.uri)));
  }

  get exists(): boolean {
    return directories.has(this.uri);
  }

  create(_options?: { intermediates?: boolean; idempotent?: boolean }): void {
    directories.add(this.uri);
  }

  list(): (File | Directory)[] {
    return [...files.keys()]
      .filter((uri) => uri.startsWith(`${this.uri}/`))
      .map((uri) => new File(uri));
  }
}

export class File {
  uri: string;

  constructor(...parts: (string | File | Directory)[]) {
    this.uri = join(...parts.map((part) => (typeof part === "string" ? part : part.uri)));
  }

  get exists(): boolean {
    return files.has(this.uri);
  }

  get size(): number | null {
    return files.get(this.uri) ?? null;
  }

  copySync(destination: File | Directory): void {
    const target = destination instanceof File ? destination.uri : join(destination.uri, "copy");
    files.set(target, files.get(this.uri) ?? 0);
  }

  delete(): void {
    files.delete(this.uri);
  }
}

export const Paths = {
  document: new Directory("file:///app/documents"),
  cache: new Directory("file:///app/cache"),
};
