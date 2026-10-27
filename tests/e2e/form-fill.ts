import { expect, type Page } from '@playwright/test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Use the configured React form filler and require its committed-state report. */
export async function fillVerified(page: Page, answers: Record<string, string>) {
  const modulePath=process.env.REACT_FORM_FILL_SCRIPT ?? join(homedir(),'.codex/skills/react-form-fill/scripts/form-fill.mjs');
  const {fillForm}=await import(pathToFileURL(modulePath).href);
  const dry=await fillForm(page,answers,{dryRun:true});
  expect(dry.ok,JSON.stringify(dry.report)).toBe(true);
  const result=await fillForm(page,answers);
  expect(result.ok,JSON.stringify(result.report)).toBe(true);
}
