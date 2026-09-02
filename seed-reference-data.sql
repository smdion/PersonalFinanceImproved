-- Reference data: IRS contribution limits and federal tax withholding brackets.
-- Seeded automatically on fresh databases when tables are empty.
-- Update yearly when IRS publishes new limits.

INSERT INTO contribution_limits (tax_year, limit_type, value, notes) VALUES
  (2025, '401k_employee_limit', 23500.000000, 'IRS Notice 2024-80'),
  (2025, '401k_catchup_limit', 7500.000000, 'IRS Notice 2024-80'),
  (2025, '401k_super_catchup_limit', 11250.000000, 'SECURE 2.0 enhanced catch-up ages 60-63'),
  (2025, 'ira_limit', 7000.000000, 'IRS Notice 2024-80'),
  (2025, 'ira_catchup_limit', 1000.000000, 'Additional if age 50+'),
  (2025, 'hsa_family_limit', 8550.000000, 'IRS Rev. Proc. 2024-25'),
  (2025, 'hsa_individual_limit', 4300.000000, 'IRS Rev. Proc. 2024-25'),
  (2025, 'hsa_catchup_limit', 1000.000000, 'Additional if age 55+'),
  (2025, 'ss_wage_base', 176100.000000, 'FICA SS wage base'),
  (2025, 'fica_ss_rate', 0.062000, 'SS tax rate (employee)'),
  (2025, 'fica_medicare_rate', 0.014500, 'Medicare tax rate'),
  (2025, 'fica_medicare_surtax_rate', 0.009000, 'Additional Medicare above threshold'),
  (2025, 'fica_medicare_surtax_threshold', 200000.000000, 'Surtax threshold'),
  (2025, 'supplemental_tax_rate', 0.220000, 'Federal flat rate on bonuses'),
  (2025, 'standard_deduction_mfj', 30000.000000, 'MFJ standard deduction'),
  (2025, 'standard_deduction_single', 15000.000000, 'Single standard deduction'),
  (2025, 'standard_deduction_hoh', 22500.000000, 'HoH standard deduction'),
  (2025, 'additional_std_deduction_65_married', 1600.000000, 'IRC 63(f) age-65+ additional standard deduction, per spouse, MFJ/MFS/QSS (Rev. Proc. 2024-40)'),
  (2025, 'additional_std_deduction_65_unmarried', 2000.000000, 'IRC 63(f) age-65+ additional standard deduction, Single/HoH (Rev. Proc. 2024-40)'),
  (2025, 'obbba_senior_deduction_per_person', 6000.000000, 'OBBBA temporary senior deduction, 2025-2028, per qualifying person 65+ (not CPI-indexed)'),
  (2025, 'obbba_senior_deduction_phaseout_start_mfj', 150000.000000, 'OBBBA senior deduction MAGI phaseout START, MFJ'),
  (2025, 'obbba_senior_deduction_phaseout_start_unmarried', 75000.000000, 'OBBBA senior deduction MAGI phaseout START, Single/HoH/MFS'),
  (2025, 'obbba_senior_deduction_phaseout_rate', 0.060000, 'OBBBA senior deduction phaseout rate — 6% of MAGI over threshold'),
  (2025, 'obbba_senior_deduction_sunset_year', 2028.000000, 'Last tax year OBBBA senior deduction is authorized — engine gates on this, not a hardcoded literal'),
  (2025, 'roth_ira_magi_limit_mfj', 236000.000000, 'Roth IRA MAGI phaseout START, MFJ'),
  (2026, '401k_employee_limit', 24500.000000, 'IRS Notice 2025-67'),
  (2026, '401k_catchup_limit', 8000.000000, 'Age 50+ catch-up (2026)'),
  (2026, '401k_super_catchup_limit', 11250.000000, 'SECURE 2.0 ages 60-63'),
  (2026, 'ira_limit', 7500.000000, 'IRS Notice 2025-67'),
  (2026, 'ira_catchup_limit', 1100.000000, 'Age 50+ catch-up (2026)'),
  (2026, 'hsa_family_limit', 8750.000000, 'Family HDHP coverage'),
  (2026, 'hsa_individual_limit', 4400.000000, 'Self-only HDHP coverage'),
  (2026, 'hsa_catchup_limit', 1000.000000, 'Age 55+'),
  (2026, 'ss_wage_base', 184500.000000, 'SSA 2026 wage base'),
  (2026, 'fica_ss_rate', 0.062000, '6.2% employee share'),
  (2026, 'fica_medicare_rate', 0.014500, '1.45% employee share'),
  (2026, 'fica_medicare_surtax_rate', 0.009000, '0.9% Additional Medicare Tax'),
  (2026, 'fica_medicare_surtax_threshold', 200000.000000, 'Single/HoH; MFJ is 250k'),
  (2026, 'supplemental_tax_rate', 0.220000, 'Flat supplemental rate'),
  (2026, 'standard_deduction_mfj', 32200.000000, 'IRS Rev. Proc. 2025-XX'),
  (2026, 'standard_deduction_single', 16100.000000, 'IRS Rev. Proc. 2025-XX'),
  (2026, 'standard_deduction_hoh', 24150.000000, 'IRS Rev. Proc. 2025-XX'),
  (2026, 'additional_std_deduction_65_married', 1650.000000, 'IRC 63(f) age-65+ additional standard deduction, per spouse, MFJ/MFS/QSS (Rev. Proc. 2025-32)'),
  (2026, 'additional_std_deduction_65_unmarried', 2050.000000, 'IRC 63(f) age-65+ additional standard deduction, Single/HoH (Rev. Proc. 2025-32)'),
  (2026, 'obbba_senior_deduction_per_person', 6000.000000, 'OBBBA temporary senior deduction, 2025-2028, per qualifying person 65+ (not CPI-indexed)'),
  (2026, 'obbba_senior_deduction_phaseout_start_mfj', 150000.000000, 'OBBBA senior deduction MAGI phaseout START, MFJ'),
  (2026, 'obbba_senior_deduction_phaseout_start_unmarried', 75000.000000, 'OBBBA senior deduction MAGI phaseout START, Single/HoH/MFS'),
  (2026, 'obbba_senior_deduction_phaseout_rate', 0.060000, 'OBBBA senior deduction phaseout rate — 6% of MAGI over threshold'),
  (2026, 'obbba_senior_deduction_sunset_year', 2028.000000, 'Last tax year OBBBA senior deduction is authorized — engine gates on this, not a hardcoded literal'),
  (2026, 'roth_ira_magi_limit_mfj', 236000.000000, 'Roth IRA MAGI phaseout START, MFJ')
ON CONFLICT DO NOTHING;

-- tax_brackets: IRS Publication 15-T Percentage Method Tables for Automated
-- Payroll Systems (Worksheet 1A), ANNUAL pay period. `w4_checkbox = false` is
-- the STANDARD Withholding Rate Schedule; `w4_checkbox = true` is the
-- "Form W-4, Step 2, Checkbox" schedule. Transcribed 2026-09-01 directly from
-- the official IRS PDFs (p15t--2025.pdf p.11, p15t--2026.pdf p.12) and
-- forward-cascade-verified (each row's tentative amount = prior row's amount +
-- prior rate x threshold delta). This replaced an earlier data set (R58) in
-- which every 2025 row was byte-identical to its 2026 twin: the MFJ rows had
-- held real-2026 data on both years, the Single/HOH rows real-2025 on both.
-- Fixing it also caught two stragglers in the rows that HAD been the right
-- year: 2025 Single/standard's 37% tentative amount (183,647.25 -> 188,769.75)
-- and 2025 HOH/checkbox's 32% threshold (109,000 -> 109,900).
INSERT INTO tax_brackets (tax_year, filing_status, w4_checkbox, brackets) VALUES
  (2025, 'MFJ', false, '[{"rate": 0, "threshold": 0, "baseWithholding": 0}, {"rate": 0.1, "threshold": 17100, "baseWithholding": 0}, {"rate": 0.12, "threshold": 40950, "baseWithholding": 2385}, {"rate": 0.22, "threshold": 114050, "baseWithholding": 11157}, {"rate": 0.24, "threshold": 223800, "baseWithholding": 35302}, {"rate": 0.32, "threshold": 411700, "baseWithholding": 80398}, {"rate": 0.35, "threshold": 518150, "baseWithholding": 114462}, {"rate": 0.37, "threshold": 768700, "baseWithholding": 202154.5}]'),
  (2025, 'MFJ', true, '[{"rate": 0, "threshold": 0, "baseWithholding": 0}, {"rate": 0.1, "threshold": 15000, "baseWithholding": 0}, {"rate": 0.12, "threshold": 26925, "baseWithholding": 1192.5}, {"rate": 0.22, "threshold": 63475, "baseWithholding": 5578.5}, {"rate": 0.24, "threshold": 118350, "baseWithholding": 17651}, {"rate": 0.32, "threshold": 212300, "baseWithholding": 40199}, {"rate": 0.35, "threshold": 265525, "baseWithholding": 57231}, {"rate": 0.37, "threshold": 390800, "baseWithholding": 101077.25}]'),
  (2025, 'Single', false, '[{"rate": 0, "threshold": 0, "baseWithholding": 0}, {"rate": 0.1, "threshold": 6400, "baseWithholding": 0}, {"rate": 0.12, "threshold": 18325, "baseWithholding": 1192.5}, {"rate": 0.22, "threshold": 54875, "baseWithholding": 5578.5}, {"rate": 0.24, "threshold": 109750, "baseWithholding": 17651}, {"rate": 0.32, "threshold": 203700, "baseWithholding": 40199}, {"rate": 0.35, "threshold": 256925, "baseWithholding": 57231}, {"rate": 0.37, "threshold": 632750, "baseWithholding": 188769.75}]'),
  (2025, 'Single', true, '[{"rate": 0, "threshold": 0, "baseWithholding": 0}, {"rate": 0.1, "threshold": 7500, "baseWithholding": 0}, {"rate": 0.12, "threshold": 13463, "baseWithholding": 596.25}, {"rate": 0.22, "threshold": 31738, "baseWithholding": 2789.25}, {"rate": 0.24, "threshold": 59175, "baseWithholding": 8825.5}, {"rate": 0.32, "threshold": 106150, "baseWithholding": 20099.5}, {"rate": 0.35, "threshold": 132763, "baseWithholding": 28615.5}, {"rate": 0.37, "threshold": 320675, "baseWithholding": 94384.88}]'),
  (2025, 'HOH', false, '[{"rate": 0, "threshold": 0, "baseWithholding": 0}, {"rate": 0.1, "threshold": 13900, "baseWithholding": 0}, {"rate": 0.12, "threshold": 30900, "baseWithholding": 1700}, {"rate": 0.22, "threshold": 78750, "baseWithholding": 7442}, {"rate": 0.24, "threshold": 117250, "baseWithholding": 15912}, {"rate": 0.32, "threshold": 211200, "baseWithholding": 38460}, {"rate": 0.35, "threshold": 264400, "baseWithholding": 55484}, {"rate": 0.37, "threshold": 640250, "baseWithholding": 187031.5}]'),
  (2025, 'HOH', true, '[{"rate": 0, "threshold": 0, "baseWithholding": 0}, {"rate": 0.1, "threshold": 11250, "baseWithholding": 0}, {"rate": 0.12, "threshold": 19750, "baseWithholding": 850}, {"rate": 0.22, "threshold": 43675, "baseWithholding": 3721}, {"rate": 0.24, "threshold": 62925, "baseWithholding": 7956}, {"rate": 0.32, "threshold": 109900, "baseWithholding": 19230}, {"rate": 0.35, "threshold": 136500, "baseWithholding": 27742}, {"rate": 0.37, "threshold": 324425, "baseWithholding": 93515.75}]'),
  (2026, 'MFJ', false, '[{"rate": 0, "threshold": 0, "baseWithholding": 0}, {"rate": 0.1, "threshold": 19300, "baseWithholding": 0}, {"rate": 0.12, "threshold": 44100, "baseWithholding": 2480}, {"rate": 0.22, "threshold": 120100, "baseWithholding": 11600}, {"rate": 0.24, "threshold": 230700, "baseWithholding": 35932}, {"rate": 0.32, "threshold": 422850, "baseWithholding": 82048}, {"rate": 0.35, "threshold": 531750, "baseWithholding": 116896}, {"rate": 0.37, "threshold": 788000, "baseWithholding": 206583.5}]'),
  (2026, 'MFJ', true, '[{"rate": 0, "threshold": 0, "baseWithholding": 0}, {"rate": 0.1, "threshold": 16100, "baseWithholding": 0}, {"rate": 0.12, "threshold": 28500, "baseWithholding": 1240}, {"rate": 0.22, "threshold": 66500, "baseWithholding": 5800}, {"rate": 0.24, "threshold": 121800, "baseWithholding": 17966}, {"rate": 0.32, "threshold": 217875, "baseWithholding": 41024}, {"rate": 0.35, "threshold": 272325, "baseWithholding": 58448}, {"rate": 0.37, "threshold": 400450, "baseWithholding": 103291.75}]'),
  (2026, 'Single', false, '[{"rate": 0, "threshold": 0, "baseWithholding": 0}, {"rate": 0.1, "threshold": 7500, "baseWithholding": 0}, {"rate": 0.12, "threshold": 19900, "baseWithholding": 1240}, {"rate": 0.22, "threshold": 57900, "baseWithholding": 5800}, {"rate": 0.24, "threshold": 113200, "baseWithholding": 17966}, {"rate": 0.32, "threshold": 209275, "baseWithholding": 41024}, {"rate": 0.35, "threshold": 263725, "baseWithholding": 58448}, {"rate": 0.37, "threshold": 648100, "baseWithholding": 192979.25}]'),
  (2026, 'Single', true, '[{"rate": 0, "threshold": 0, "baseWithholding": 0}, {"rate": 0.1, "threshold": 8050, "baseWithholding": 0}, {"rate": 0.12, "threshold": 14250, "baseWithholding": 620}, {"rate": 0.22, "threshold": 33250, "baseWithholding": 2900}, {"rate": 0.24, "threshold": 60900, "baseWithholding": 8983}, {"rate": 0.32, "threshold": 108938, "baseWithholding": 20512}, {"rate": 0.35, "threshold": 136163, "baseWithholding": 29224}, {"rate": 0.37, "threshold": 328350, "baseWithholding": 96489.63}]'),
  (2026, 'HOH', false, '[{"rate": 0, "threshold": 0, "baseWithholding": 0}, {"rate": 0.1, "threshold": 15550, "baseWithholding": 0}, {"rate": 0.12, "threshold": 33250, "baseWithholding": 1770}, {"rate": 0.22, "threshold": 83000, "baseWithholding": 7740}, {"rate": 0.24, "threshold": 121250, "baseWithholding": 16155}, {"rate": 0.32, "threshold": 217300, "baseWithholding": 39207}, {"rate": 0.35, "threshold": 271750, "baseWithholding": 56631}, {"rate": 0.37, "threshold": 656150, "baseWithholding": 191171}]'),
  (2026, 'HOH', true, '[{"rate": 0, "threshold": 0, "baseWithholding": 0}, {"rate": 0.1, "threshold": 12075, "baseWithholding": 0}, {"rate": 0.12, "threshold": 20925, "baseWithholding": 885}, {"rate": 0.22, "threshold": 45800, "baseWithholding": 3870}, {"rate": 0.24, "threshold": 64925, "baseWithholding": 8077.5}, {"rate": 0.32, "threshold": 112950, "baseWithholding": 19603.5}, {"rate": 0.35, "threshold": 140175, "baseWithholding": 28315.5}, {"rate": 0.37, "threshold": 332375, "baseWithholding": 95585.5}]')
ON CONFLICT DO NOTHING;

-- LTCG brackets (Long-Term Capital Gains) — IRS Revenue Procedure 2024-40 (2025), 2025-32 (2026)
INSERT INTO ltcg_brackets (tax_year, filing_status, brackets) VALUES
  (2025, 'MFJ', '[{"threshold": 94050, "rate": 0}, {"threshold": 583750, "rate": 0.15}, {"threshold": null, "rate": 0.2}]'),
  (2025, 'Single', '[{"threshold": 47025, "rate": 0}, {"threshold": 518900, "rate": 0.15}, {"threshold": null, "rate": 0.2}]'),
  (2025, 'HOH', '[{"threshold": 63000, "rate": 0}, {"threshold": 551350, "rate": 0.15}, {"threshold": null, "rate": 0.2}]'),
  (2026, 'MFJ', '[{"threshold": 98900, "rate": 0}, {"threshold": 613700, "rate": 0.15}, {"threshold": null, "rate": 0.2}]'),
  (2026, 'Single', '[{"threshold": 49450, "rate": 0}, {"threshold": 545500, "rate": 0.15}, {"threshold": null, "rate": 0.2}]'),
  (2026, 'HOH', '[{"threshold": 66200, "rate": 0}, {"threshold": 579600, "rate": 0.15}, {"threshold": null, "rate": 0.2}]')
ON CONFLICT DO NOTHING;

-- IRMAA brackets (Medicare premium surcharges) — CMS 2026 projected thresholds
INSERT INTO irmaa_brackets (tax_year, filing_status, brackets) VALUES
  (2026, 'MFJ', '[{"magiThreshold": 206000, "annualSurcharge": 1056}, {"magiThreshold": 258000, "annualSurcharge": 2640}, {"magiThreshold": 322000, "annualSurcharge": 4224}, {"magiThreshold": 386000, "annualSurcharge": 5808}, {"magiThreshold": 750000, "annualSurcharge": 6924}]'),
  (2026, 'Single', '[{"magiThreshold": 103000, "annualSurcharge": 1056}, {"magiThreshold": 129000, "annualSurcharge": 2640}, {"magiThreshold": 161000, "annualSurcharge": 4224}, {"magiThreshold": 193000, "annualSurcharge": 5808}, {"magiThreshold": 375000, "annualSurcharge": 6924}]'),
  (2026, 'HOH', '[{"magiThreshold": 103000, "annualSurcharge": 1056}, {"magiThreshold": 129000, "annualSurcharge": 2640}, {"magiThreshold": 161000, "annualSurcharge": 4224}, {"magiThreshold": 193000, "annualSurcharge": 5808}, {"magiThreshold": 375000, "annualSurcharge": 6924}]')
ON CONFLICT DO NOTHING;
