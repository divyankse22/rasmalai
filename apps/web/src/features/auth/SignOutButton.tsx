import { Button } from '@/design-system/Button';

export function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <Button type="submit" variant="ghost">
        Sign out
      </Button>
    </form>
  );
}
