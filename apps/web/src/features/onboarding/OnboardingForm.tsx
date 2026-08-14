'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/design-system/Button';
import { Card } from '@/design-system/Card';
import { SelectField, TextField } from '@/design-system/Field';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { AVATARS, LOCATION_OPTIONS } from './avatars';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type FieldErrors = Record<string, string>;

export function OnboardingForm({ suggestedName }: { suggestedName: string }) {
  const router = useRouter();
  const [avatarKey, setAvatarKey] = useState<string>('rasmalai');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFormError(undefined);

    const form = new FormData(event.currentTarget);
    const payload = {
      actualName: String(form.get('actualName') ?? ''),
      nickname: String(form.get('nickname') ?? ''),
      birthYear: Number(form.get('birthYear') ?? 0),
      avatarKey,
      partnerLabelName: String(form.get('partnerLabelName') ?? ''),
      partnerLabelNickname: String(form.get('partnerLabelNickname') ?? ''),
      firstMetDate: String(form.get('firstMetDate') ?? ''),
      locationType: String(form.get('locationType') ?? ''),
    };

    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push('/');
        return;
      }

      const response = await fetch(`${API_BASE}/api/onboarding`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        router.push('/dashboard');
        router.refresh();
        return;
      }

      const body = (await response.json()) as {
        error?: { message?: string; fields?: FieldErrors };
      };
      setErrors(body.error?.fields ?? {});
      setFormError(body.error?.fields ? undefined : (body.error?.message ?? 'Something went wrong.'));
    } catch {
      setFormError('Could not reach Rasmalai. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <Card className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-semibold text-ink">About you</h2>
        <TextField
          label="Your name"
          name="actualName"
          defaultValue={suggestedName}
          autoComplete="name"
          maxLength={60}
          required
          {...(errors.actualName ? { error: errors.actualName } : {})}
        />
        <TextField
          label="Your nickname"
          name="nickname"
          maxLength={30}
          required
          {...(errors.nickname ? { error: errors.nickname } : {})}
        />
        <TextField
          label="Birth year"
          name="birthYear"
          type="number"
          inputMode="numeric"
          min={1900}
          max={new Date().getFullYear()}
          required
          {...(errors.birthYear ? { error: errors.birthYear } : {})}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="font-display text-sm font-semibold text-ink">Pick an avatar</legend>
          <div className="flex flex-wrap gap-2">
            {AVATARS.map((avatar) => {
              const selected = avatar.key === avatarKey;
              return (
                <button
                  key={avatar.key}
                  type="button"
                  onClick={() => setAvatarKey(avatar.key)}
                  aria-pressed={selected}
                  aria-label={avatar.label}
                  className={`flex size-12 items-center justify-center rounded-pill text-2xl transition-transform duration-quick ease-bounce active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry ${
                    selected ? 'bg-berry shadow-soft' : 'bg-blush'
                  }`}
                >
                  {avatar.glyph}
                </button>
              );
            })}
          </div>
        </fieldset>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-semibold text-ink">About them</h2>
        <p className="text-sm text-muted">
          Just for you — this is how they will show up on your side. They never see it, and they
          pick their own name for you.
        </p>
        <TextField
          label="Their name"
          name="partnerLabelName"
          maxLength={60}
          required
          {...(errors.partnerLabelName ? { error: errors.partnerLabelName } : {})}
        />
        <TextField
          label="What you call them"
          name="partnerLabelNickname"
          maxLength={30}
          required
          {...(errors.partnerLabelNickname ? { error: errors.partnerLabelNickname } : {})}
        />
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-semibold text-ink">About the two of you</h2>
        <TextField
          label="The day you met"
          name="firstMetDate"
          type="date"
          max={new Date().toISOString().slice(0, 10)}
          required
          {...(errors.firstMetDate ? { error: errors.firstMetDate } : {})}
        />
        <SelectField
          label="Where you are"
          name="locationType"
          options={LOCATION_OPTIONS}
          defaultValue="different_city"
          {...(errors.locationType ? { error: errors.locationType } : {})}
        />
      </Card>

      {formError && (
        <p className="text-center text-sm text-berry" role="alert">
          {formError}
        </p>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : 'All done ❤️'}
      </Button>
    </form>
  );
}
