import path from "node:path";

// Optional isolated configuration/state for local integration checks. All callers
// still explicitly pass --local; this helper never selects a remote database.
function localPath(name) {
  const value = process.env[name];
  if (!value) return [];
  const resolved = path.resolve(value);
  const relative = path.relative(process.cwd(), resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(`${name} must stay inside this project`);
  return [resolved];
}
const config = localPath("PM_TEST_CONFIG");
const state = localPath("PM_TEST_PERSIST");
export const localConfigArgs = config.length ? ["--config", ...config] : [];
export const localStateArgs = state.length ? ["--persist-to", ...state] : [];
