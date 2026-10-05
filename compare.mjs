// Compare a document-wide word stream so moved page breaks do not cause false changes.
export function compareTokens(left, right, diffArrays) {
  const parts = diffArrays(left, right, { comparator: (a, b) => a.text === b.text, timeout: 15000 });
  if (!parts) throw new Error('This comparison is too large to finish. Please compare smaller PDFs.');
  const changes = []; let pending = null, li = 0, ri = 0;
  for (const part of parts) {
    if (!part.added && !part.removed) { pending = null; li += part.count; ri += part.count; continue; }
    if (!pending) { pending = { old: [], revised: [], leftAnchor: li, rightAnchor: ri }; changes.push(pending); }
    if (part.removed) { pending.old.push(...left.slice(li, li + part.count)); li += part.count; }
    if (part.added) { pending.revised.push(...right.slice(ri, ri + part.count)); ri += part.count; }
  }
  return changes;
}
