/**
 * The Rasmalai wordmark: "Ras" in blue, "malai" in berry.
 *
 * One component rather than the same two spans copied into the header, the drawer and the landing
 * page — three copies of a brand mark drift, and the sizes already differ between the three.
 *
 * The two halves are separate spans with no whitespace between them, so the accessible name stays
 * the single word "Rasmalai" rather than "Ras malai".
 *
 * The blue is `--color-blueberry-deep`, the saturated blue-family analogue of `--color-berry`:
 * `--color-sky` is a pale pastel fill that would sit at roughly 1.3:1 on cream, but blueberry-deep
 * clears about 4.7:1, well past AA for the bold 18px+ text this wordmark always renders at.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display font-bold ${className}`}>
      <span className="text-blueberry-deep">Ras</span>
      <span className="text-berry">malai</span>
    </span>
  );
}
