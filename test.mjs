// Bulk test for bankgen: runs the page's generators and validators against
// independent re-implementations, published fixtures and negative cases.
// Usage: node test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const html = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "index.html"),
  "utf8",
);
const code = html.split("<script>")[1].split("</script>")[0];
const api = eval(
  code +
    `;({
    genericIban, countries, IBAN_REGISTRY, genBic, genQrReference, genScorReference,
    isValidIban, isValidNormalIban, isValidQrIban, isValidBic, isValidQrReference, isValidScorReference,
})`,
);

let failures = 0;
let checks = 0;
function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    if (failures <= 25) console.error("FAIL:", message);
  }
}

// --- independent re-implementations (deliberately not the page's code) ---

function bigIntMod97Is1(value) {
  let s = "";
  for (const ch of value.slice(4) + value.slice(0, 4)) {
    s += ch >= "0" && ch <= "9" ? ch : String(ch.charCodeAt(0) - 55);
  }
  return BigInt(s) % 97n === 1n;
}

function specRegex(code, spec) {
  let body = "";
  for (const [, n, t] of spec.matchAll(/(\d+)([nac])/g)) {
    body += (t === "a" ? "[A-Z]" : t === "n" ? "[0-9]" : "[0-9A-Z]") + `{${n}}`;
  }
  return new RegExp(`^${code}[0-9]{2}${body}$`);
}

function frRibValid(bban) {
  // bank || branch || account || key must be divisible by 97
  return BigInt(bban) % 97n === 0n;
}

function esControlValid(bban) {
  const check = (digits) => {
    const weights = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6];
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += Number(digits[i]) * weights[i];
    const r = 11 - (sum % 11);
    return r === 11 ? 0 : r === 10 ? 1 : r;
  };
  return (
    bban.slice(8, 10) ===
    `${check("00" + bban.slice(0, 8))}${check(bban.slice(10))}`
  );
}

function itCinValid(bban) {
  const odd = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21];
  let sum = 0;
  for (let i = 0; i < 22; i++) {
    const d = Number(bban[1 + i]);
    sum += i % 2 === 0 ? odd[d] : d;
  }
  return bban[0] === String.fromCharCode(65 + (sum % 26));
}

// Backend's matrix encoding of the recursive mod-10 (rotation of the flat table)
const MOD10_MATRIX = [
  [0, 9, 4, 6, 8, 2, 7, 1, 3, 5],
  [9, 4, 6, 8, 2, 7, 1, 3, 5, 0],
  [4, 6, 8, 2, 7, 1, 3, 5, 0, 9],
  [6, 8, 2, 7, 1, 3, 5, 0, 9, 4],
  [8, 2, 7, 1, 3, 5, 0, 9, 4, 6],
  [2, 7, 1, 3, 5, 0, 9, 4, 6, 8],
  [7, 1, 3, 5, 0, 9, 4, 6, 8, 2],
  [1, 3, 5, 0, 9, 4, 6, 8, 2, 7],
  [3, 5, 0, 9, 4, 6, 8, 2, 7, 1],
  [5, 0, 9, 4, 6, 8, 2, 7, 1, 3],
];

function qrrValid(ref) {
  if (!/^\d{27}$/.test(ref)) return false;
  let carry = 0;
  for (const d of ref) carry = MOD10_MATRIX[carry][Number(d)];
  return carry === 0;
}

// Backend's BIC regex, verbatim
const BACKEND_BIC_REGEX =
  /^([a-zA-Z]{4})([a-zA-Z]{2})(([2-9a-zA-Z]{1})([0-9a-np-zA-NP-Z]{1}))((([0-9a-wy-zA-WY-Z]{1})([0-9a-zA-Z]{2}))|([xX]{3})|)$/;

const qrIid = (iban) => Number(iban.slice(4, 9));
const inQrRange = (iban) => qrIid(iban) >= 30000 && qrIid(iban) <= 31999;

const RIB_FAMILY = new Set(["FR", "MC", "MR", "TN"]); // BBAN ≡ 0 (mod 97)
const M9710_FAMILY = new Set(["PT", "RS", "ME", "MK", "BA", "TL"]); // BBAN ≡ 1 (mod 97)

function noNationalValid(bban) {
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(bban[i]) * w[i];
  return Number(bban[10]) === (11 - (sum % 11)) % 11;
}

// --- published fixtures ---

assert(
  api.isValidIban("CH9300762011623852957"),
  "fixture: CH93... is a valid IBAN",
);
assert(
  api.isValidNormalIban("CH9300762011623852957"),
  "fixture: CH93... (IID 00762) is a normal IBAN",
);
assert(
  !api.isValidQrIban("CH9300762011623852957"),
  "fixture: CH93... is not a QR-IBAN",
);
assert(
  !api.isValidIban("CH9300762011623852958"),
  "fixture: bad checksum rejected",
);
assert(
  !api.isValidIban("CH930076201162385295"),
  "fixture: bad length rejected",
);
assert(
  !api.isValidIban("XX0012345678901"),
  "fixture: unknown country rejected",
);
assert(
  api.isValidQrReference("210000000003139471430009017"),
  "fixture: published QRR is valid",
);
assert(
  !api.isValidQrReference("210000000003139471430009018"),
  "fixture: bad QRR check digit rejected",
);
assert(
  api.isValidScorReference("RF18539007547034"),
  "fixture: published SCOR is valid",
);
assert(
  !api.isValidScorReference("RF18539007547035"),
  "fixture: bad SCOR checksum rejected",
);
// RF00123456 passes raw mod-97 (00 is a twin of the canonical 97), but ISO 11649
// restricts check digits to 02..98, so it must still be rejected.
assert(
  bigIntMod97Is1("RF00123456"),
  "fixture: RF00123456 really is a mod-97 twin",
);
assert(
  !api.isValidScorReference("RF00123456"),
  "fixture: non-canonical SCOR check digits rejected",
);
assert(
  !api.isValidScorReference("RFAB1234"),
  "fixture: letters in SCOR check-digit slots rejected",
);
// Same twin situation for IBAN check digits: find a BBAN whose canonical check
// digits are 97, then make sure its 00-twin is rejected despite passing mod-97.
{
  let bban = null;
  for (let i = 0; i < 10000 && bban === null; i++) {
    const candidate = String(i).padStart(17, "0");
    if (bigIntMod97Is1("CH00" + candidate)) bban = candidate;
  }
  assert(bban !== null, "fixture: found a check-digit-00 twin BBAN");
  assert(
    api.isValidIban("CH97" + bban),
    "fixture: canonical CH97 IBAN accepted",
  );
  assert(
    !api.isValidIban("CH00" + bban),
    "fixture: non-canonical CH00 twin rejected",
  );
}
assert(
  api.isValidBic("UBSWCHZH80A", "CH"),
  "fixture: real BIC UBSWCHZH80A accepted",
);
assert(api.isValidBic("DEUTDEFF", "DE"), "fixture: real BIC DEUTDEFF accepted");
assert(
  !api.isValidBic("ABCDCHAO", "CH"),
  "fixture: letter O as 2nd location char rejected",
);
assert(
  !api.isValidBic("ABCDCH0A", "CH"),
  "fixture: 0 as 1st location char rejected",
);
assert(
  !api.isValidBic("ABCDCHA2X12", "CH"),
  "fixture: branch starting with X rejected",
);

// --- national checksum algorithms, anchored on official registry example IBANs ---
// The FR example contains a letter (RIB letter conversion), which the
// digits-only page validator deliberately does not support; checked separately.

const NATIONAL_EXAMPLES = {
  BE: "BE68539007547034",
  NO: "NO9386011117947",
  FI: "FI2112345600000785",
  EE: "EE382200221020145685",
  PL: "PL61109010140000071219812874",
  HU: "HU42117730161111101800000000",
  AL: "AL47212110090000000235698741",
  CZ: "CZ6508000000192000145399",
  SK: "SK3112000000198742637541",
  HR: "HR1210010051863000160",
  IS: "IS140159260076545510730339",
  MK: "MK07250120000058984",
  PT: "PT50000201231234567890154",
  RS: "RS35260005601001611379",
  ME: "ME25505000012345678951",
  BA: "BA391290079401028494",
  TL: "TL380080012345678910157",
  MC: "MC5811222000010123456789030",
  MR: "MR1300020001010000123456753",
  TN: "TN5910006035183598478831",
  SM: "SM86U0322509800000000270100",
  IT: "IT60X0542811101000000123456",
  ES: "ES9121000418450200051332",
};
for (const [cc, iban] of Object.entries(NATIONAL_EXAMPLES)) {
  assert(bigIntMod97Is1(iban), `registry example mod-97 (${cc}): ${iban}`);
  assert(api.isValidIban(iban), `registry example accepted (${cc}): ${iban}`);
}
{
  const iban = "FR1420041010050500013M02606";
  assert(bigIntMod97Is1(iban), `registry example mod-97 (FR): ${iban}`);
  const RIB_LETTERS = "123456789123456789234567892345678".slice(0, 26); // A..Z
  const converted = [...iban.slice(4)]
    .map((ch) =>
      ch >= "0" && ch <= "9" ? ch : RIB_LETTERS[ch.charCodeAt(0) - 65],
    )
    .join("");
  assert(
    BigInt(converted) % 97n === 0n,
    `FR registry example RIB key: ${iban}`,
  );
}

// --- IBANs: every registry country, generator output must satisfy both the
// --- independent checks and the page validators ---

const N = 300;
for (const [cc, , spec] of api.IBAN_REGISTRY) {
  const re = specRegex(cc, spec);
  for (let i = 0; i < N; i++) {
    const iban = api.genericIban(cc);
    assert(re.test(iban), `${cc} structure/length: ${iban}`);
    assert(bigIntMod97Is1(iban), `${cc} mod-97: ${iban}`);
    assert(api.isValidNormalIban(iban), `${cc} page validator: ${iban}`);
    const bban = iban.slice(4);
    if (RIB_FAMILY.has(cc))
      assert(frRibValid(bban), `${cc} RIB family key: ${iban}`);
    if (M9710_FAMILY.has(cc))
      assert(BigInt(bban) % 97n === 1n, `${cc} 97-10 national check: ${iban}`);
    if (cc === "ES") assert(esControlValid(bban), `ES control: ${iban}`);
    if (cc === "IT" || cc === "SM")
      assert(itCinValid(bban), `${cc} CIN: ${iban}`);
    if (cc === "BE")
      assert(
        Number(bban.slice(10)) === (Number(bban.slice(0, 10)) % 97 || 97),
        `BE national check: ${iban}`,
      );
    if (cc === "NO") assert(noNationalValid(bban), `NO national check: ${iban}`);
    if (cc === "CH" || cc === "LI")
      assert(!inQrRange(iban), `${cc} normal IBAN in QR-IID range: ${iban}`);
  }
}

// --- Swiss QR-IBANs ---

const ch = api.countries.find((c) => c.code === "CH");
for (let i = 0; i < 3000; i++) {
  const iban = ch.gen(true);
  assert(bigIntMod97Is1(iban), `QR-IBAN mod-97: ${iban}`);
  assert(inQrRange(iban), `QR-IBAN outside QR-IID range: ${iban}`);
  assert(api.isValidQrIban(iban), `QR-IBAN page validator: ${iban}`);
  assert(
    !api.isValidNormalIban(iban),
    `QR-IBAN wrongly accepted as normal: ${iban}`,
  );
}

// --- BICs ---

for (let i = 0; i < 5000; i++) {
  const cc = api.IBAN_REGISTRY[i % api.IBAN_REGISTRY.length][0];
  const bic = api.genBic(cc);
  assert(BACKEND_BIC_REGEX.test(bic), `backend BIC regex: ${bic}`);
  assert(api.isValidBic(bic, cc), `BIC page validator: ${bic}`);
  assert(bic.slice(4, 6) === cc, `BIC country: ${bic} != ${cc}`);
  assert(bic[7] !== "O", `BIC 2nd location char is O: ${bic}`);
  assert(
    !"01".includes(bic[6]) && !"01".includes(bic[7]),
    `BIC test-marker location char: ${bic}`,
  );
}

// --- references ---

for (let i = 0; i < 5000; i++) {
  const ref = api.genQrReference();
  assert(qrrValid(ref), `QRR independent check: ${ref}`);
  assert(api.isValidQrReference(ref), `QRR page validator: ${ref}`);
}
for (let i = 0; i < 5000; i++) {
  const ref = api.genScorReference();
  assert(/^RF\d{2}\d{5,21}$/.test(ref), `SCOR structure: ${ref}`);
  assert(bigIntMod97Is1(ref), `SCOR independent mod-97: ${ref}`);
  assert(api.isValidScorReference(ref), `SCOR page validator: ${ref}`);
}

if (failures === 0) {
  console.log(
    `PASS: ${checks} checks (${api.IBAN_REGISTRY.length} countries x ${N} IBANs, 3000 QR-IBANs, 5000 BICs, 2x5000 references, fixtures)`,
  );
} else {
  console.error(`${failures}/${checks} checks failed`);
  process.exit(1);
}
