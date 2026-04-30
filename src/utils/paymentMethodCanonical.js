function toPlain(value) {
  return value?.toObject ? value.toObject() : (value || {});
}

function cleanText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\u0980-\u09FF]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value) {
  return cleanText(value).replace(/\s+/g, '');
}

function stripVariantSuffix(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return '';

  // bKash 1, bKash-2, bKash_3, bKash no 4, bKash copy -> bKash
  const withoutNumberSuffix = cleaned
    .replace(/\s*(?:no|number|num|serial|sr)?\s*[#:_-]*\s*\d+$/i, '')
    .replace(/\s*(?:copy|duplicate)$/i, '')
    .trim();

  // bkash2 -> bkash, nagad03 -> nagad. Keeps names that do not end in digits unchanged.
  const compact = compactText(withoutNumberSuffix || cleaned);
  const compactWithoutNumberSuffix = compact.replace(/\d+$/g, '');

  return compactWithoutNumberSuffix || compact;
}

export function canonicalDepositMethodTitle(methodOrTitle) {
  const method = typeof methodOrTitle === 'object' ? toPlain(methodOrTitle) : { title: methodOrTitle };

  const fromTitle = stripVariantSuffix(method.title);
  if (fromTitle) return fromTitle;

  return stripVariantSuffix(method.key) || compactText(method.key) || String(method._id || '');
}

export function canonicalDepositMethodKey(method) {
  const plain = toPlain(method);
  return canonicalDepositMethodTitle(plain) || stripVariantSuffix(plain.key) || String(plain._id || '');
}

export function normalizePaymentMethodKey(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizePaymentMethodKeyList(keys) {
  if (!Array.isArray(keys)) return [];

  return [...new Set(
    keys
      .map(normalizePaymentMethodKey)
      .filter(Boolean)
  )];
}

function methodSortValue(method) {
  const plain = toPlain(method);
  const createdAt = plain.createdAt ? new Date(plain.createdAt).getTime() : 0;

  return [
    plain.isActive === false ? 1 : 0,
    Number.isFinite(Number(plain.displayOrder)) ? Number(plain.displayOrder) : 100,
    createdAt || 0,
    String(plain.key || ''),
  ];
}

function compareMethods(a, b) {
  const av = methodSortValue(a);
  const bv = methodSortValue(b);

  for (let index = 0; index < av.length; index += 1) {
    if (av[index] < bv[index]) return -1;
    if (av[index] > bv[index]) return 1;
  }

  return 0;
}

export function groupDepositMethodsByTitle(methods = []) {
  const groups = new Map();

  for (const method of methods || []) {
    const plain = toPlain(method);
    const canonicalKey = canonicalDepositMethodKey(plain);
    if (!canonicalKey) continue;

    if (!groups.has(canonicalKey)) {
      groups.set(canonicalKey, {
        canonicalKey,
        methods: [],
      });
    }

    groups.get(canonicalKey).methods.push(plain);
  }

  return [...groups.values()]
    .map((group) => {
      group.methods.sort(compareMethods);
      group.primary = group.methods[0] || null;
      group.duplicateKeys = group.methods.slice(1).map((method) => method.key).filter(Boolean);
      return group;
    })
    .sort((a, b) => compareMethods(a.primary, b.primary));
}

export function dedupeDepositMethodsByTitle(methods = []) {
  return groupDepositMethodsByTitle(methods).map((group) => ({
    ...group.primary,
    canonicalKey: group.canonicalKey,
    duplicateKeys: group.duplicateKeys,
    duplicateCount: group.methods.length - 1,
  }));
}

export function findDuplicateDepositMethod(methods = [], payload = {}, ignoreKey = '') {
  const canonicalKey = canonicalDepositMethodKey(payload);
  const ignored = normalizePaymentMethodKey(ignoreKey);

  if (!canonicalKey) return null;

  return (methods || [])
    .map(toPlain)
    .find((method) => {
      if (ignored && normalizePaymentMethodKey(method.key) === ignored) return false;
      return canonicalDepositMethodKey(method) === canonicalKey;
    }) || null;
}

export function pickPrimaryDepositMethod(methods = []) {
  return [...(methods || [])].map(toPlain).sort(compareMethods)[0] || null;
}
