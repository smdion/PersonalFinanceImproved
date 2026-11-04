/** The engine's key for one individual account. `makeIndKey` (engine)
 *  builds it from the display name, category, tax type and owner. */
export type IndKeyFn = (ia: {
  name: string;
  category: string;
  taxType: string;
  ownerPersonId?: number;
}) => string;
