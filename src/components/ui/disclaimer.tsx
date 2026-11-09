/** The one disclaimer on every page that gives advice or a projection
 *  (Recommendations, Milestones, the Checkup, Projection Health, Retirement and
 *  the printed report). */
export function Disclaimer({ className = "" }: { className?: string }) {
  return (
    <p className={`text-caption text-faint ${className}`.trim()}>
      Estimates from the figures and assumptions you entered. Not financial, tax
      or legal advice.
    </p>
  );
}
