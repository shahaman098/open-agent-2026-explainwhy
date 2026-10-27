import { ReferenceFinancials, type ReferenceFinancialsT } from "@/reference/schemas";

/**
 * NIKE, Inc. publicly reported results, cached for context only.
 * Source: NIKE, Inc. press release "NIKE, Inc. Reports Fiscal 2027 First Quarter
 * Results", released October 1, 2026, retrieved 2026-10-24 from investors.nike.com.
 *
 * These figures are the real company's published numbers and have NOTHING to do
 * with the simulator's generated revenue, which is synthetic and GBP-denominated.
 */
export const NIKE_Q1_FY27_RESULTS: ReferenceFinancialsT = ReferenceFinancials.parse({
  referenceId: "nike_q1_fy2027_results",
  company: "NIKE, Inc.",
  fiscalPeriod: "Q1 FY2027",
  periodEndedOn: "2026-08-31",
  releasedOn: "2026-10-01",
  currency: "USD",
  figures: [
    { label: "Total NIKE, Inc. revenues", valueUsdMillions: 11213, priorYearUsdMillions: 11720, reportedChangePercent: -4, currencyNeutralChangePercent: -5 },
    { label: "Total NIKE Brand revenues", valueUsdMillions: 10952, priorYearUsdMillions: 11362, reportedChangePercent: -4, currencyNeutralChangePercent: -4 },
    { label: "NIKE Brand sales to wholesale customers", valueUsdMillions: 6804, priorYearUsdMillions: 6839, reportedChangePercent: -1, currencyNeutralChangePercent: -1 },
    { label: "NIKE Brand sales through NIKE Direct", valueUsdMillions: 4142, priorYearUsdMillions: 4514, reportedChangePercent: -8, currencyNeutralChangePercent: -9 },
    { label: "Converse revenues", valueUsdMillions: 263, priorYearUsdMillions: 366, reportedChangePercent: -28, currencyNeutralChangePercent: -28 },
    { label: "North America revenues", valueUsdMillions: 5127, priorYearUsdMillions: 5020, reportedChangePercent: 2, currencyNeutralChangePercent: 2 },
    { label: "Europe, Middle East & Africa revenues", valueUsdMillions: 3176, priorYearUsdMillions: 3331, reportedChangePercent: -5, currencyNeutralChangePercent: -5 },
    { label: "Greater China revenues", valueUsdMillions: 1180, priorYearUsdMillions: 1512, reportedChangePercent: -22, currencyNeutralChangePercent: -26 },
    { label: "Asia Pacific & Latin America revenues", valueUsdMillions: 1463, priorYearUsdMillions: 1490, reportedChangePercent: -2, currencyNeutralChangePercent: 0 },
    { label: "Net income", valueUsdMillions: 712, priorYearUsdMillions: 727, reportedChangePercent: -2 },
  ],
  grossMarginPercent: 42.8,
  dilutedEpsUsd: 0.48,
  sourceUrl: "https://investors.nike.com/news-events/press-releases/detail/575/nike-inc-reports-fiscal-2027-first-quarter-results",
  dataOrigin: "official_public",
  retrievedAt: "2026-10-24T00:00:00.000Z",
  relationshipToSimulator: "context_only_not_simulated_revenue",
});
