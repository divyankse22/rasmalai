import { REACTIONS } from '@rasmalai/shared';
import { Card } from '@/design-system/Card';
import { SignInButton } from '@/features/auth/SignInButton';

const ERROR_MESSAGES: Record<string, string> = {
  declined: 'No problem — come back whenever you are ready.',
  missing_code: 'That sign-in link was incomplete. Give it another go.',
  sign_in_failed: 'Something went wrong signing you in. Try again in a moment.',
};

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorKey = typeof params.error === 'string' ? params.error : undefined;
  const errorMessage = errorKey ? (ERROR_MESSAGES[errorKey] ?? ERROR_MESSAGES.sign_in_failed) : undefined;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-8 px-6 py-12">
      <header className="flex flex-col items-center gap-2 text-center">
        <h1 className="font-display text-5xl font-bold tracking-tight text-berry">Rasmalai</h1>
        <p className="text-lg text-muted">a tiny world for two</p>
      </header>

      <Card className="flex w-full flex-col items-center gap-4 text-center">
        <p className="text-balance text-ink">
          Play quick, silly games with your favourite person — wherever they are.
        </p>

        <SignInButton />

        {errorMessage && (
          <p className="text-sm text-berry" role="alert">
            {errorMessage}
          </p>
        )}
      </Card>

      <ul className="flex items-center gap-3 text-2xl" aria-label="in-game reactions">
        {REACTIONS.map((reaction) => (
          <li key={reaction}>{reaction}</li>
        ))}
      </ul>
    </main>
  );
}
