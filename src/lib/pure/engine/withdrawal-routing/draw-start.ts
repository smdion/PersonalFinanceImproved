/** Where bracket filling's discretionary draw starts, from routing's bracket input. */
import { safeDivide } from "../../../utils/math";
import { SS_TAX_TIER1_INCLUSION_RATE } from "../../../config/ss-tax";
import { computeTaxableSS } from "../tax-estimation";
import type { DrawState } from "../draw-position";
import type { RouteBracketInfo } from "./types";

/** The base floor (taxable SS, Traditional, reserved conversion room), with the
 *  year's benefits taxed at the provisional income before the draw (no
 *  conversion: `taxableSSFor`'s rule). */
export function drawStart(
  bracketInfo: RouteBracketInfo,
  traditionalDrawn: number,
  reservedRoom: number,
): Omit<DrawState, "brokerageBasisRatio"> {
  const { ssIncome, filingStatus, rothProRata: proRata } = bracketInfo;
  const benefits =
    filingStatus && ssIncome && ssIncome.gross > 0
      ? { ...ssIncome, filingStatus }
      : undefined;
  const otherIncome = benefits && benefits.otherIncome + traditionalDrawn;
  const ordinaryIncome =
    (benefits && otherIncome !== undefined
      ? benefits.otherIncome +
        computeTaxableSS(benefits.gross, otherIncome, benefits.filingStatus)
      : bracketInfo.taxableSS) +
    traditionalDrawn +
    reservedRoom;
  return {
    filingStatus,
    ordinaryIncome,
    gains: 0,
    magi: bracketInfo.magiBeforeThisDraw ?? ordinaryIncome,
    taxBrackets: bracketInfo.taxBrackets ?? [],
    ltcgBrackets: bracketInfo.ltcgBrackets,
    standardDeduction: bracketInfo.standardDeduction,
    // The share of a pro_rata Roth dollar that is unqualified growth.
    rothProRataTaxableShare: proRata
      ? Math.min(
          1,
          Math.max(
            0,
            safeDivide(
              proRata.balance - proRata.qualifiedBalance - proRata.basis,
              proRata.balance,
            ),
          ),
        )
      : 0,
    ...(benefits &&
      otherIncome !== undefined && {
        socialSecurity: {
          gross: benefits.gross,
          provisionalIncome:
            otherIncome + SS_TAX_TIER1_INCLUSION_RATE * benefits.gross,
        },
      }),
    discretionaryWithdrawalOrder: bracketInfo.discretionaryWithdrawalOrder,
  };
}
