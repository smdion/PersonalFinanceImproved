/** A check's outcome (a connection test): `success` says whether it passed,
 *  and a failure carries why. */
export type ProbeResult<
  Pass extends object = object,
  Fail extends object = { error: string },
> = ({ success: true } & Pass) | ({ success: false } & Fail);

/** A save's acknowledgement: never false, unlike a ProbeResult's `success`. */
export type Ack = { ok: true };
