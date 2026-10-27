// SPDX-License-Identifier: MPL-2.0
// CPU sampling estimates time by function; it does not time guest instructions.
export function summarizeProfile(profile, blocks = []) {
  const { nodes, samples, timeDeltas } = profile;
  if (!Array.isArray(nodes) || !Array.isArray(samples) || !Array.isArray(timeDeltas) ||
      samples.length !== timeDeltas.length) throw Error('Incomplete CPU sample timing');
  const byId = new Map(nodes.map(node => [node.id, node])), parents = new Map(), rows = new Map();
  for (const node of nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const metadata = new Map(blocks.map(block => [block.name, block]));
  let sampledUs = 0;
  for (let i = 0; i < samples.length; i++) {
    const us = timeDeltas[i];
    if (!Number.isFinite(us) || us < 0 || !byId.has(samples[i])) throw Error('Invalid CPU sample');
    sampledUs += us;
    const visitedNodes = new Set(), visitedFunctions = new Set();
    let id = samples[i];
    while (id !== undefined) {
      if (visitedNodes.has(id)) throw Error('Cyclic CPU stack');
      visitedNodes.add(id);
      const node = byId.get(id);
      if (!node) throw Error('Missing CPU stack node');
      const f = node.callFrame, key = JSON.stringify([f.scriptId, f.functionName, f.url, f.lineNumber, f.columnNumber]);
      if (!rows.has(key)) rows.set(key, { ...f, selfUs: 0, inclusiveUs: 0, selfSamples: 0,
        block: metadata.get(f.functionName) });
      const row = rows.get(key);
      if (id === samples[i]) { row.selfUs += us; row.selfSamples++; }
      // Recursion contributes once to the function's inclusive time per sample.
      if (!visitedFunctions.has(key)) { row.inclusiveUs += us; visitedFunctions.add(key); }
      id = parents.get(id);
    }
  }
  return { samples: samples.length, sampledMs: sampledUs / 1000,
    wallMs: (profile.endTime - profile.startTime) / 1000,
    attribution: 'Sampled function time; instruction composition is static, not per-instruction timing.',
    functions: [...rows.values()].sort((a, b) => b.selfUs - a.selfUs).map(({ selfUs, inclusiveUs, ...row }) =>
      ({ ...row, selfMs: selfUs / 1000, inclusiveMs: inclusiveUs / 1000 })) };
}

// Counts bracket CDP start/stop and therefore span a different interval from samples.
export function profileWindow(before, after, requestedMode) {
  const modes = { timing: 'timing-names', counts: 'tci-counts' };
  if (requestedMode && !modes[requestedMode]) throw Error('Unknown requested profile mode');
  if (requestedMode && (!before || before.mode !== modes[requestedMode]))
    throw Error('Requested profile mode does not match worker instrumentation');
  if (!before && !after) return null;
  if (!before || !after || before.mode !== after.mode) throw Error('Profile changed during sampling');
  const prior = new Map(before.blocks.map(block => [block.name, block.entries]));
  const delta = field => Object.fromEntries(Object.entries(after[field] ?? {}).map(([name, value]) =>
    [name, value - (before[field]?.[name] ?? 0)]));
  return { ...after, opcodes: delta('opcodes'), callSites: delta('callSites'),
    counterWindow: { startMs: before.snapshotTimeMs, endMs: after.snapshotTimeMs,
      durationMs: after.snapshotTimeMs - before.snapshotTimeMs,
      meaning: 'Worker performance.now boundaries; includes CDP command delays outside CPU sampling. Do not divide sampled time by these counts as instruction timings.' },
    blocks: after.blocks.map(block => ({ ...block,
      entries: block.entries === null ? null : block.entries - (prior.get(block.name) ?? 0) })) };
}
