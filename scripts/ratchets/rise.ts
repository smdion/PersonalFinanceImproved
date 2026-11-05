/** One loosened ratchet: the file that holds it and what rose. */
export type Rise = { file: string; text: string };
/** A file's text at one side of the comparison (undefined: no such file). */
export type Tree = (file: string) => string | undefined;
