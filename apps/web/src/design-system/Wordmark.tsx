/**
 * The Rasmalai wordmark: "Ras" in blue, "malai" in berry.
 *
 * One component rather than the same two spans copied into the header, the drawer and the landing
 * page — three copies of a brand mark drift, and the sizes already differ between the three.
 *
 * The two halves are separate spans with no whitespace between them, so the accessible name stays
 * the single word "Rasmalai" rather than "Ras malai".
 *
 * The blue is `--color-name-male`, the palette's only blue dark enough to read as text: `--color-sky`
 * is a pale pastel fill that would sit at roughly 1.3:1 on cream. At #2f6fd0 this is about 4.4:1,
 * which clears AA for large text — and the wordmark is bold at 18px or above everywhere it appears.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display font-bold ${className}`}>
      <span className="text-name-male">Ras</span>
      <span className="text-berry">malai</span>
    </span>
  );
}
