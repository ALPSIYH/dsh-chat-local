import { mkdir, rename, rm } from "node:fs/promises";

/** A real kernel write failure at the configured destination, with exact recovery. */
export async function blockStateFile(path) {
  const original = `${path}.test-original`;
  await rename(path, original);
  await mkdir(path);
  let blocked = true;
  return async () => {
    if (!blocked) return;
    blocked = false;
    await rm(path, { recursive: true });
    await rename(original, path);
  };
}
