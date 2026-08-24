import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Wordmark } from './Wordmark';

describe('Wordmark', () => {
  /*
   * The whole risk of splitting a word across two elements: if any whitespace creeps between the
   * spans, the brand reads as "Ras malai" to a screen reader and to every text query in the suite.
   */
  it('still reads as one word', () => {
    const { container } = render(<Wordmark />);

    // Raw textContent, not a normalizing matcher: normalization would collapse exactly the stray
    // space this test exists to catch.
    expect(container.firstElementChild?.textContent).toBe('Rasmalai');
  });

  it('splits the two halves so they can be coloured apart', () => {
    render(<Wordmark />);

    expect(screen.getByText('Ras')).toHaveClass('text-name-male');
    expect(screen.getByText('malai')).toHaveClass('text-berry');
  });

  it('takes its size from the caller', () => {
    const { container } = render(<Wordmark className="text-5xl" />);
    expect(container.firstElementChild).toHaveClass('text-5xl');
  });
});
