import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Keep fresh browser evidence separate from the committed demonstration records. */
export function artifactPath(relative: string): string {
  const path=join(process.env.E2E_ARTIFACT_DIR??join(tmpdir(),'normal-e2e-artifacts'),relative);
  mkdirSync(dirname(path),{recursive:true});
  return path;
}
