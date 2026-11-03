"""Inputs for the engine ledgers. Pure data: every figure a ledger depends on is here.
All money is whole dollars in as-of-year (2026) terms unless a field says otherwise."""

COMMON = {
    "asOfDate": "2026-01-01",          # year 0 is a whole year: no proration in any ledger (UD-01)
    "taxYearBase": 2026,               # tax-data/us-federal/2026.json, set as the pinned tax year
    "inflation": "0.03",               # one flat general rate
    "limitGrowth": "0.02",             # ENG-38 default; unrounded (UD-12)
    "taxMultiplier": 1,                # DESIGN: "with a tax multiplier"; 1 = none
    "spendingStrategy": "fixed",       # wave 4 owns the others
    "withdrawalRouting": "waterfall",  # wave 4 owns bracket filling and percentage
    "rothConversions": "off",          # UD-08: no ledger until the tax source is decided
    "qcdAnnual": 0,                    # UD-09
    "lumpSums": [],
}

HOUSEHOLDS = [
 dict(COMMON, id="H1", name="One earner, married, Portfolio savings alongside",
  purpose="One job, spouse with no job and no accounts. Accumulation, Portfolio scope, retirement at 65, "
          "Social Security claims, first RMD at 75.",
  filingStatus="MFJ",
  people=[
   dict(id="A", primary=True, birthDate="1971-01-15", ssAnnualToday=36000, ssStartAge=67,
        jobs=[dict(employer="J1", start="2010-01-01", end="2035-12-31", salary=120000, salaryGrowth="0.03")]),
   dict(id="B", primary=False, birthDate="1973-01-15", ssAnnualToday=18000, ssStartAge=67, jobs=[]),
  ],
  accounts=[
   dict(id="A-401k-trad", owner="A", category="401k", tax="traditional", parent="Retirement", balance=900000),
   dict(id="A-ira-roth", owner="A", category="ira", tax="roth", parent="Retirement", balance=80000),
   dict(id="A-hsa", owner="A", category="hsa", tax="hsa", parent="Retirement", balance=30000),
   dict(id="P-brokerage", owner="A", category="brokerage", tax="brokerage", parent="Portfolio", balance=100000, basis=70000),
  ],
  contributions=[
   dict(person="A", account="A-401k-trad", kind="percent", value="0.15", payroll="pretax", group="401k",
        match=dict(rate="0.5", capPercent="0.06", account="A-401k-trad")),
   dict(person="A", account="A-hsa", kind="fixed", value=5000, payroll="section125", group=None),
   dict(person="A", account="P-brokerage", kind="fixed", value=6000, payroll="aftertax", group=None),
  ],
  returnRates=[dict(fromAge=0, rate="0.06")],
  annualSpendingToday=70000,
  waterfall=["A-401k-trad", "A-ira-roth", "A-hsa"],
  endYear=2047),

 dict(COMMON, id="H2", name="Two earners, one stops four-plus years early",
  purpose="Per-owner contributions and growth, gap years funded by take-home plus draws, phase change when "
          "the last job ends, RMDs for each owner in different years.",
  filingStatus="MFJ",
  people=[
   dict(id="A", primary=True, birthDate="1964-01-15", ssAnnualToday=32000, ssStartAge=67,
        jobs=[dict(employer="J1", start="2005-01-01", end="2027-12-31", salary=110000, salaryGrowth="0.03")]),
   dict(id="B", primary=False, birthDate="1968-01-15", ssAnnualToday=28000, ssStartAge=67,
        jobs=[dict(employer="J2", start="2008-01-01", end="2032-12-31", salary=85000, salaryGrowth="0.03")]),
  ],
  accounts=[
   dict(id="A-403b-trad", owner="A", category="403b", tax="traditional", parent="Retirement", balance=1500000),
   dict(id="B-401k-trad", owner="B", category="401k", tax="traditional", parent="Retirement", balance=350000),
   dict(id="B-401k-roth", owner="B", category="401k", tax="roth", parent="Retirement", balance=60000),
  ],
  contributions=[
   dict(person="A", account="A-403b-trad", kind="percent", value="0.05", payroll="pretax", group="401k"),
   dict(person="B", account="B-401k-trad", kind="percent", value="0.10", payroll="pretax", group="401k",
        match=dict(rate="1", capPercent="0.04", account="B-401k-trad")),
   dict(person="B", account="B-401k-roth", kind="percent", value="0.02", payroll="roth", group="401k"),
  ],
  returnRates=[dict(fromAge=0, rate="0.05")],
  annualSpendingToday=105000,
  waterfall=["A-403b-trad", "B-401k-roth", "B-401k-trad"],
  endYear=2044),

 dict(COMMON, id="H3", name="Retired couple, Social Security and RMDs, no job ever",
  purpose="Decumulation from year 0, age add-ons and senior deduction through 2028, first RMDs for each spouse "
          "(73 in 2027, 75 in 2035), RMD above the need, reinvestment into a projection-only brokerage.",
  filingStatus="MFJ",
  people=[
   dict(id="A", primary=True, birthDate="1954-01-15", ssAnnualToday=34000, ssStartAge=67, jobs=[]),
   dict(id="B", primary=False, birthDate="1960-01-15", ssAnnualToday=22000, ssStartAge=62, jobs=[]),
  ],
  accounts=[
   dict(id="A-401k-trad", owner="A", category="401k", tax="traditional", parent="Retirement", balance=2400000),
   dict(id="B-ira-trad", owner="B", category="ira", tax="traditional", parent="Retirement", balance=450000),
   dict(id="A-ira-roth", owner="A", category="ira", tax="roth", parent="Retirement", balance=200000),
  ],
  contributions=[],
  returnRates=[dict(fromAge=0, rate="0.05")],
  annualSpendingToday=110000,
  waterfall=["A-401k-trad", "B-ira-trad", "A-ira-roth"],
  endYear=2037),

 dict(COMMON, id="H4", name="Early retiree living on a Retirement-parented brokerage",
  purpose="Decumulation from year 0 at 48, brokerage draws with average-cost gains, 0% LTCG stacking, "
          "gross-up on gains, brokerage running out mid-year into Traditional, first RMD at 75.",
  filingStatus="Single",
  people=[dict(id="A", primary=True, birthDate="1978-01-15", ssAnnualToday=20000, ssStartAge=67, jobs=[])],
  accounts=[
   dict(id="A-brokerage", owner="A", category="brokerage", tax="brokerage", parent="Retirement", balance=1000000, basis=600000),
   dict(id="A-ira-trad", owner="A", category="ira", tax="traditional", parent="Retirement", balance=500000),
   dict(id="A-ira-roth", owner="A", category="ira", tax="roth", parent="Retirement", balance=100000),
  ],
  contributions=[],
  returnRates=[dict(fromAge=0, rate="0.05")],
  annualSpendingToday=60000,
  waterfall=["A-brokerage", "A-ira-trad", "A-ira-roth"],
  endYear=2054),

 dict(COMMON, id="H5", name="Single, retires mid-plan at 60",
  purpose="Deferral limit binds and overflows to a Retirement brokerage, catch-up at 50, lump sum, Portfolio savings, "
          "return rate step at 60, full phase change in 2039, designated Roth exempt from RMD, first RMD at 75.",
  filingStatus="Single",
  people=[dict(id="A", primary=True, birthDate="1979-01-15", ssAnnualToday=30000, ssStartAge=67,
               jobs=[dict(employer="J1", start="2012-01-01", end="2038-12-31", salary=130000, salaryGrowth="0.03")])],
  accounts=[
   dict(id="A-401k-trad", owner="A", category="401k", tax="traditional", parent="Retirement", balance=700000),
   dict(id="A-401k-roth", owner="A", category="401k", tax="roth", parent="Retirement", balance=50000),
   dict(id="A-brokerage", owner="A", category="brokerage", tax="brokerage", parent="Retirement", balance=40000, basis=30000),
   dict(id="P-brokerage", owner="A", category="brokerage", tax="brokerage", parent="Portfolio", balance=60000, basis=50000),
  ],
  contributions=[
   dict(person="A", account="A-401k-roth", kind="fixed", value=36000, payroll="roth", group="401k",
        overflowTo="A-brokerage",
        match=dict(rate="1", capPercent="0.03", account="A-401k-trad"),
        note="Fixed dollars above the limit on purpose. All deferrals are Roth, so the mandatory Roth catch-up is satisfied."),
   dict(person="A", account="P-brokerage", kind="fixed", value=6000, payroll="aftertax", group=None),
  ],
  lumpSums=[dict(year=2031, amount=50000, account="A-brokerage", note="Inheritance, not taxable. A retirement lump sum.")],
  returnRates=[dict(fromAge=0, rate="0.07"), dict(fromAge=60, rate="0.05")],
  annualSpendingToday=62000,
  waterfall=["A-401k-trad", "A-brokerage", "A-401k-roth"],
  endYear=2056),

 dict(COMMON, id="H6", name="Early retiree with only a Traditional IRA",
  purpose="Early-withdrawal penalty priced in the gross-up, 59 1/2 reached exactly on January 1, RMD above the need "
          "for a single person, reinvestment. One account, so every step can be checked by hand.",
  filingStatus="Single",
  people=[dict(id="A", primary=True, birthDate="1977-07-01", ssAnnualToday=0, ssStartAge=67, jobs=[])],
  accounts=[dict(id="A-ira-trad", owner="A", category="ira", tax="traditional", parent="Retirement", balance=2000000)],
  contributions=[],
  returnRates=[dict(fromAge=0, rate="0.06")],
  annualSpendingToday=40000,
  waterfall=["A-ira-trad"],
  endYear=2054),

 dict(COMMON, id="H7", name="Plan that fails: Traditional runs out",
  purpose="First RMD at 73 inside a normal draw, the depletion year, unmet need, Social Security alone afterwards.",
  filingStatus="Single",
  people=[dict(id="A", primary=True, birthDate="1956-01-15", ssAnnualToday=20000, ssStartAge=67, jobs=[])],
  accounts=[dict(id="A-ira-trad", owner="A", category="ira", tax="traditional", parent="Retirement", balance=250000)],
  contributions=[],
  returnRates=[dict(fromAge=0, rate="0.05")],
  annualSpendingToday=50000,
  waterfall=["A-ira-trad"],
  endYear=2036),
]
