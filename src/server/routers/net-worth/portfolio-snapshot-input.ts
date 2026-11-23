import { z } from "zod/v4";
import { zCalendarDate, zDecimal } from "@/lib/utils/zod-fields";
import {
  accountCategoryEnum,
  parentCategoryEnum,
} from "@/lib/config/account-types";
import { PORTFOLIO_TAX_TYPE_VALUES } from "@/lib/config/enum-values";

export const portfolioSnapshotInput = z.object({
  snapshotDate: zCalendarDate,
  notes: z.string().nullable().optional(),
  accounts: z.array(
    z.object({
      institution: z.string().trim().min(1),
      taxType: z.enum(PORTFOLIO_TAX_TYPE_VALUES),
      accountType: z.enum(accountCategoryEnum()),
      subType: z.string().nullable().optional(),
      label: z.string().trim().nullable().optional(),
      parentCategory: z.enum(parentCategoryEnum()).default("Retirement"),
      amount: zDecimal,
      ownerPersonId: z.number().int().nullable(),
      performanceAccountId: z.number().int().nullable().optional(),
    }),
  ),
});
