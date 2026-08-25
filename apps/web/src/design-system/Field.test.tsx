import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SelectField, TextField } from './Field';

/*
 * The contract that matters here is the accessibility wiring, not the look: the label reaches the
 * control, and an error is announced *and* marked on the input rather than only being tinted red.
 * `docs/06` requires that colour is never the only signal, and this is where that is enforced for
 * form errors.
 */

const OPTIONS = [
  { value: 'chick', label: 'Chick' },
  { value: 'fox', label: 'Fox' },
] as const;

describe('TextField', () => {
  it('associates its label with the input', () => {
    render(<TextField label="Your nickname" />);
    expect(screen.getByLabelText('Your nickname')).toBeInTheDocument();
  });

  it('reports what was typed', async () => {
    const onChange = vi.fn();
    render(<TextField label="Your nickname" onChange={onChange} />);

    await userEvent.type(screen.getByLabelText('Your nickname'), 'Mira');

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0].target.value).toBe('Mira');
  });

  it('announces an error and marks the input invalid', () => {
    render(<TextField label="Your nickname" error="That name is taken." />);

    expect(screen.getByRole('alert')).toHaveTextContent('That name is taken.');
    expect(screen.getByLabelText(/Your nickname/)).toHaveAttribute('aria-invalid', 'true');
  });

  /*
   * Characterizing current behaviour, not endorsing it.
   *
   * `Wrapper` renders the error <span> INSIDE the <label>, so an errored field's accessible name
   * becomes "Your nickname That name is taken." rather than "Your nickname". A screen reader does
   * hear the error, so this is not broken — but the conventional wiring is `aria-describedby`,
   * which keeps the name stable and still announces the message.
   *
   * Pinned here so that fixing it is a deliberate, visible change rather than an accident. This is
   * a pre-existing behaviour and out of scope for a restyle.
   */
  it('currently folds the error text into the accessible name', () => {
    render(<TextField label="Your nickname" error="That name is taken." />);

    // The bare label no longer matches exactly...
    expect(screen.queryByLabelText('Your nickname', { exact: true })).not.toBeInTheDocument();
    // ...because the error text has been folded into the name alongside it.
    expect(screen.getByLabelText(/Your nickname[\s\S]*That name is taken\./)).toBeInTheDocument();
  });

  it('is neither invalid nor alerting when there is no error', () => {
    render(<TextField label="Your nickname" />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Your nickname')).not.toHaveAttribute('aria-invalid');
  });

  it('forwards input attributes', () => {
    render(<TextField label="Partner code" placeholder="6 characters" maxLength={6} required />);

    const input = screen.getByLabelText('Partner code');
    expect(input).toHaveAttribute('placeholder', '6 characters');
    expect(input).toHaveAttribute('maxLength', '6');
    expect(input).toBeRequired();
  });
});

describe('SelectField', () => {
  it('associates its label with the select', () => {
    render(<SelectField label="Avatar" options={OPTIONS} />);
    expect(screen.getByLabelText('Avatar')).toBeInTheDocument();
  });

  it('renders every option, labelled by label and valued by value', () => {
    render(<SelectField label="Avatar" options={OPTIONS} />);

    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Chick', 'Fox']);
    expect(options.map((o) => o.getAttribute('value'))).toEqual(['chick', 'fox']);
  });

  it('reports a selection', async () => {
    const onChange = vi.fn();
    render(<SelectField label="Avatar" options={OPTIONS} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText('Avatar'), 'fox');

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0].target.value).toBe('fox');
  });

  it('announces an error and marks the select invalid', () => {
    render(<SelectField label="Avatar" options={OPTIONS} error="Pick one to carry on." />);

    expect(screen.getByRole('alert')).toHaveTextContent('Pick one to carry on.');
    expect(screen.getByLabelText(/Avatar/)).toHaveAttribute('aria-invalid', 'true');
  });
});
