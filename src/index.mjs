export { scanTree } from './scan.mjs';
export { decodeBuffer, isZstd } from './decode.mjs';
export { classify, signature, groupOf, core, silentMarks, decodeProjectName, RULES, GROUP_LABEL } from './classify.mjs';
export { analyze, toJson, toMarkdown, renderText } from './report.mjs';
export { makeAdapter } from './adapters/generic.mjs';
export * as dshAdapter from './adapters/dsh.mjs';
export { defaultCachePath } from './cache.mjs';
