// IRS Joint and Last Survivor Table (Treas. Reg. § 1.401(a)(9)-9(d); Pub 590-B Table II), the RMD
// divisor for a sole-beneficiary spouse over 10 years younger (Reg. -5(c)(2)), keyed from the
// regulation; where Pub 590-B's printed cell differs (90/76: 14.8), the regulation governs.

/** Rows for owner ages 72 to 120 ("120 and over"): the divisor at spouse age 0, then each next
 *  spouse age's drop in tenths as a letter ("a" none to "k" 1.0); spouse ages run to owner − 11,
 *  the 120 row to the "120 and over" column. Stored by drops to keep page bundles small. */
// prettier-ignore
const ROWS: Readonly<Record<number, readonly [number, string]>> = {
  72: [84.7, "jkkjkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjjkjkjkjjkjjjjjjjjijiiiiiihh"],
  73: [84.6, "ikkkjkkkkkkjkkkkjkkkjkkkjkjkkjkjkjkjkjkjjkjjjkjjjjijjiijiihihh"],
  74: [84.6, "ikkkjkkkkkkjkkkkkjkkkjkkjkkjkjkjkjkjkjkjkjjkjjjjjjjjjijiiiiihhi"],
  75: [84.6, "ikkkjkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkjkjkjjkjjkjjjjjjijijiiiiihhi"],
  76: [84.6, "ikkkjkkkkkkkjkkkkjkkkjkkkjkjkkjkjkjkjkjkjkjjkjjjkjjijjijiiiiiihhi"],
  77: [84.6, "ikkkkjkkkkkkjkkkkkjkkkjkkjkkjkjkjkjkjkjkjkjkjjkjjjjjjjijiijihiihhi"],
  78: [84.6, "ikkkkjkkkkkkkjkkkkjkkkjkkjkkjkjkjkkjkjkjkjkjjkjjjkjjijjjiijiihiihhh"],
  79: [84.6, "ikkkkjkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkjkjkjkjkjjkjjjjjjjijiijiihiihhh"],
  80: [84.6, "ikkkkjkkkkkkkjkkkkjkkkkjkkjkjkkjkjkjkjkjkkjjkjkjjjkjjijjijiijiihihihh"],
  81: [84.6, "ikkkkjkkkkkkkjkkkkkjkkkjkkjkjkkjkjkjkkjkjkjkjkjjkjjjjjjijjiiijihiihhih"],
  82: [84.6, "ikkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkjkjkkjkjkjkjkjjkjjjjjjjjijiiiiiiihihhh"],
  83: [84.6, "jjkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkjkkjkjkjkjkjkjkjjkjjjjijjijiiiiiihihihh"],
  84: [84.6, "jjkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkjkjkkjkjjkjkjjjjjjjijiijiiiihihihhh"],
  85: [84.6, "jjkkkkjkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkjkkjkjkjkjjkjjjjjjjjijiiijihiihihhhh"],
  86: [84.6, "jjkkkkjkkkkkkkjkkkkjkkkkjkkjkjkjkkjkjkkjkjkjkjkjkjjjkjjijjjiijiiiiiihihihhg"],
  87: [84.6, "jjkkkkjkkkkkkkjkkkkkjkkkjkkjkjkkjkjkjkkjkjkjkjkjkjjkjjjjjijijiijiiihiihihhhg"],
  88: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkjkkjkjkjkkjkjkjkkjjkjkjjjjjjjijijiiiiiiiihihhhhg"],
  89: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkjkkjkjkjkkjkjkkjkjkjjkjjjjjjjijjiiijiiihiihihhhgh"],
  90: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkjkkjkjkkjkjkjkkjkjkjjkjjjjjjjjijijiiiiiiihihihhghg"],
  91: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkjkkjkjkjkkjkjkjkjjjkjjijjijijiiiiiiiiihhihghgg"],
  92: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkjkkjkjkkjkjkjkjkjjjkjjjijjijiijiiiiihiihhhhhghf"],
  93: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkjkkjkjkkjkjkjkjkjjkjjjjijjijijiiiiiiiihihhhhgggg"],
  94: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkjkkjkjkkjkjkjkjkjjkjjjjjijjiijiiiiiiiiihhihghgggg"],
  95: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkjkkjkjkkjkjkjkjkjjkjjjjjijjijiiiiijihiihihhhhggggf"],
  96: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkjkkjkjkkjkjkjkjkjkjjjjjjjijijiiijiiiihiihihhghggfgf"],
  97: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkjkkjkjkkjkjkjkjkjkjjjjjjjijijiijiiiiiihiihhhhgggggfe"],
  98: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkjkkjkjkkjkjkjkjkjkjjjjjjjijijijiiiiiiiihihhhhhgggffff"],
  99: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkjkkjkjkkjkjkjkjkjkjjjjjjjijjiijiiiiiiiiihhihghghfgfffe"],
  100: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkjkkjkjkkjkjkkjkjjkjjjjjjjjijiijiiiiiiiiihihhhghggfgfeee"],
  101: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkjkkjkjkkjkjkkjkjjkjjjjjjjjijiijiiiiiiiiihihhhhggggfffeee"],
  102: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkjkkjkjkkjkjkkjkjjkjjjjjjjjijijiiiiijihiiihhhhhghfgffffede"],
  103: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkjkkjkjkkjkjjkjjjjjjjjijijiiiijiihiiihhhhhhggfgffeeede"],
  104: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkjkkjkjkkjkjjkjjjjjjjjijijiiiijiiihiihhihghgggfffeeeedd"],
  105: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkkjkjkjkkjkjjkjjjjjjjjijijiiiijiiihiihihhghgggffffeededc"],
  106: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkkjkjkjkkjkjjkjjjjjjjjijijiiiijiiihiihihhghgggffffeededdc"],
  107: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkkjkjkjkkjkjjkjjjjjjjjijijiiiijiiihiihihhghgggffffeededdcd"],
  108: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkkjkjkjkkjkjjkjjjjjjjjijijiiiijiiihiihihhghgggfgefeeeddddcc"],
  109: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkkjkjkjkkjkjjkjjjjjjjjijijiiijiiiiihihihhhggggfgefeeeddddccc"],
  110: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkkjkjkjkkjkjjkjjjjjjjjijijiiijiiiiihihihhhgggggfefeeeddddcccc"],
  111: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkkjkjkjkkjkjjkjjjjjjjjijijiiijiiiiihihihhhgggggffeeeeddddccccc"],
  112: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkkjkjkjkkjkjjkjjjjjjjjijijiiijiiiiihihihhhgggggffeeeeddddcdcbcb"],
  113: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkkjkjkjkkjkjjkjjjjjjjjijijiiijiiiiihihihhhghgfgffefdeeddcdcccbbc"],
  114: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkkjkjkjkkjkjjkjjjjjjjjijijiiijiiiiihiihhhhghgfgffefededddccccbcbb"],
  115: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkkjkjkjkkjkjjkjjjjjjjjijijiiijiiiiihiihhhhghggffffeeeddddcccccbbbb"],
  116: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkkjkjkjkkjkjjkjjjjjjjjijijiiijiiiiiihihhhhhgggfgefeeeeddcdccccbbbbb"],
  117: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkkjkjkjkkjkjjkjjjjjjjjijijiijiiiiiiihihhhhhggggffefeedddddcccbcbbbba"],
  118: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkkjkjkjkkjkjjkjjjjjjjjijjiiijiiiiiiihihihghghfgfffefdeddddccccbcbbaba"],
  119: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkkjkjkjkkjkjjkjjjjjjjjjijiiijiiiiiiiihhihhghggfgffeeeeddddcdccbcbbabaa"],
  120: [84.6, "jjkkkkjkkkkkkkkjkkkkjkkkjkkjkkjkjkkjkjkkjkjkjkkjkjjkjjjkijjjjijiijiiiiiiiiihihhhhggggffffeeedddddccccbcbbaabaaaababaccdb"],
};

/** Table II's divisor for an owner age (72 to 120) and a spouse age in its row; undefined outside. */
export function jointLifeDivisor(
  ownerAge: number,
  spouseAge: number,
): number | undefined {
  const row = ROWS[ownerAge];
  if (!row || !Number.isInteger(spouseAge) || spouseAge < 0) return undefined;
  if (spouseAge > row[1].length) return undefined;
  let tenths = Math.round(row[0] * 10);
  for (let i = 0; i < spouseAge; i++) tenths -= row[1].charCodeAt(i) - 97;
  return tenths / 10;
}
