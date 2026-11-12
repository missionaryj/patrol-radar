#!/usr/bin/env node
// Compatibility entry point. Replaces the permissive legacy importer.
import { build } from './build-verified-stop-heat.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
export const buildStopHeat = ({ workDir, cache, outDir, only, offline } = {}) => build({ cache: cache ?? workDir, out: outDir, only, offline });
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const arg = k => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined;
    await build({ cache: arg('--cache'), out: arg('--out'), only: arg('--only')?.split(','), offline: process.argv.includes('--offline') });
}
