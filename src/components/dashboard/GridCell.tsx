/**
 * The shared shell of a Flex Day grid cell, and the cell that says "nothing is
 * meant to be here".
 *
 * Both grids that lay a day out as clubs × rotations draw these: the admin
 * Coverage page, where a cell is editable, and the read-only Building board.
 * They are here rather than in either one because a hatched cell that meant
 * something subtly different on the two screens would undo the distinction it
 * exists to draw.
 *
 * No hooks and no state, so a server component may render it directly and the
 * client Coverage grid may import it just as freely.
 */

export const CELL_SHELL =
  "relative min-w-0 border-b border-l border-gray-100 dark:border-gray-700/50 px-3 py-3";

/**
 * A rotation this row does not take part in.
 *
 * Deliberately recessive — it is there to hold the row's shape so the cells
 * either side of it stay aligned with every other row, and to say the quiet
 * part a three-column layout could not: nothing is missing here, nothing is
 * wanted here. An empty white cell would read as an unfilled slot, which is the
 * one thing it must not be confused with.
 */
export function NotScheduledCell({ label }: { label: string }) {
  return (
    <div
      // Hatched rather than merely pale. A plain empty cell was indistinguishable
      // from a slot nobody had filled in yet — the exact confusion this cell
      // exists to prevent — whereas a hatch reads as "no entry expected here" at
      // a glance and stays out of the way of the cells either side of it. The
      // dash is kept for high-contrast modes, which drop background images.
      className={`${CELL_SHELL} flex items-center justify-center bg-gray-50 dark:bg-gray-800/50 bg-[repeating-linear-gradient(45deg,transparent,transparent_5px,rgb(0_0_0/0.05)_5px,rgb(0_0_0/0.05)_10px)] dark:bg-[repeating-linear-gradient(45deg,transparent,transparent_5px,rgb(255_255_255/0.045)_5px,rgb(255_255_255/0.045)_10px)]`}
    >
      {/* The hatch carries no meaning to a screen reader, so the row's actual
          state is spelled out rather than left to a title tooltip. */}
      <span className="sr-only">{label}</span>
      <span
        aria-hidden
        className="text-lg leading-none text-gray-400 dark:text-gray-600"
      >
        –
      </span>
    </div>
  );
}
