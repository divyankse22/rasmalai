-- Rasmalai 0003 — gender on the profile.
--
-- Collected during onboarding and required, because the interface colours each person's name by it.
--
-- Added as NOT NULL with no default on purpose. If rows already existed this migration would fail
-- loudly, which is the right outcome: the alternative is inventing a gender for people who never
-- stated one, and a wrong guess is worse than a failed migration.

alter table public.users
  add column if not exists gender text not null
    check (gender in ('male', 'female'));
