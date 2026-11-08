/** A check's outcome (a connection test): `ok` says whether it passed,
 *  and a failure carries why. */
export type ProbeResult<
  Pass extends object = object,
  Fail extends object = { error: string },
> = ({ ok: true } & Pass) | ({ ok: false } & Fail);

/** A save's acknowledgement: a ProbeResult that never fails. */
export type Ack = { ok: true };
