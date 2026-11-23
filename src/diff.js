/** Word-level diff. With `removed`, marks the words of `a` that are gone in `b`; otherwise the words of `b` that are new. */
export function diffWords(a, b, removed = false) {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  if (removed) {
    while (i < n) {
      if (j < m && A[i] === B[j]) { out.push({ text: A[i], changed: false }); i++; j++; }
      else if (j < m && L[i][j + 1] > L[i + 1][j]) j++;
      else { out.push({ text: A[i], changed: /\S/.test(A[i]) }); i++; }
    }
  } else {
    while (j < m) {
      if (i < n && A[i] === B[j]) { out.push({ text: B[j], changed: false }); i++; j++; }
      else if (i < n && L[i + 1][j] >= L[i][j + 1]) i++;
      else { out.push({ text: B[j], changed: /\S/.test(B[j]) }); j++; }
    }
  }
  out.forEach((part, k) => {
    if (!/\S/.test(part.text) && out[k - 1]?.changed && out[k + 1]?.changed) part.changed = true;
  });
  return out;
}
