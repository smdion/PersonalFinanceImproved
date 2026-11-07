/** A check's outcome (a connection test): `success` says whether it passed,
 *  and a failure carries why. A save acknowledges with `{ ok: true }`:
 *  "did the test pass" isn't "was it saved". */
export type ProbeResult<
  Pass extends object = object,
  Fail extends object = { error: string },
> = ({ success: true } & Pass) | ({ success: false } & Fail);
