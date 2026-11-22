# Deploy ProductForge to production

This guide covers the production site at `https://productforge-l5ep.vercel.app`. Pushes to `main` deploy to
production. Pull requests still get preview deploys.

You need access to the Vercel project `productforge-l5ep` and to the Supabase project for ProductForge.

## What is already done

1. `main` is protected by a ruleset. A pull request must pass both CI checks before it merges, and force pushes are
   blocked. This was set up on 2026-11-20 (ADR-025), so there is nothing to do here.
2. Vercel builds this repository and runs functions in the `bom1` region (Mumbai, next to the database).
3. Preview deploys have no Supabase variables, so they run in demo mode. You do not need to change them.

## Before you start: two checks on your own computer

Both of these have never been run, and each one can block the pull request. Do them before you merge anything.

1. `corepack pnpm install --frozen-lockfile`. The `tsx` entry in `pnpm-lock.yaml` was written by hand, and this is
   the command CI runs. If it fails, run `corepack pnpm install`, commit the lockfile it writes, and push.
2. `corepack pnpm db:seed` with no arguments. It should print the usage line and stop. The seed has never been run
   by `tsx`, and this proves the script loads at all before you depend on it at step 7.

## Production variables

Set these in Vercel → your project → Settings → Environment Variables. For each one, choose **Production** only.

Copy the values from Supabase and your own accounts. Never paste a value into a file in the repository or into
a chat.

1. `NEXT_PUBLIC_SUPABASE_URL`: the project URL. Find it in Supabase → Project Settings → API Keys.
2. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the publishable key from the same page. Use the new key, not the
   legacy anon key.
3. `DATABASE_URL`: the transaction pooler connection string (port 6543). Find it in Supabase → Project Settings →
   Database.
4. `DATA_DRIVER`: set it to `postgres`.
5. `APP_URL`: set it to `https://productforge-l5ep.vercel.app`.
6. `LOG_LEVEL`: set it to `info`.

These variables are optional:

- `OPENAI_API_KEY`: your OpenAI key. Without it, the demo AI engine answers instead of a real model.
- `OPENAI_MODEL`: the model name. Leave it empty to use the default.
- `AI_RUNS_PER_USER_PER_MINUTE`: how many AI runs one user may start in a minute.
- `AI_MONTHLY_TOKEN_BUDGET_PER_WORKSPACE`: how many tokens one workspace may use in a calendar month (UTC).
- `AUTH_OAUTH_PROVIDERS`: leave it unset unless you have turned on GitHub sign-in in Supabase.

The two `NEXT_PUBLIC_` values are built into the site. If you change either one, deploy again so the change takes
effect.

Do not set these variables in Vercel:

- `AUTH_DRIVER` must be unset in Production. If it is set to `demo`, production runs without sign-in. If you see it
  under Production, delete it.
- `SUPABASE_SECRET_KEY` and `DATABASE_DIRECT_URL` stay on your own computer. The app does not read them. Only the
  migration and check scripts use `DATABASE_DIRECT_URL`.

## Supabase redirect URL

Set these by hand. Do not use the Supabase–Vercel integration. It changed these settings before and broke sign-in
(ADR-025, follow-up of 2026-11-20).

1. Open Supabase → Authentication → URL Configuration.
2. Set **Site URL** to `https://productforge-l5ep.vercel.app`.
3. Under **Redirect URLs**, add `https://productforge-l5ep.vercel.app/auth/callback?**`. The `?**` at the end is
   required.
4. Keep `http://localhost:3000/auth/callback?**` in the list, so local development still works.
5. Save.

## Order of steps

Do these steps in this order.

1. Merge the open `m0-platform` pull request into `main`.
2. On your computer, run `corepack pnpm db:migrate`, then `corepack pnpm db:check`, then `corepack pnpm db:audit`.
   All three must succeed before you go on. `db:audit` is the one that proves no table can be read without a policy.
3. Set the production variables in Vercel, as described above.
4. Set the Supabase redirect URL, as described above.
5. Merge the `launch` pull request. Production deploys start from `main`, so this is the first production deploy.
6. Open the production site and sign in once with an email link.
7. On your computer, run `corepack pnpm db:seed -- --email <your email>`, using the email you signed in with at
   step 6. The seed adds the demo project to that account. It runs on your computer, against the production
   database, and reads four values from your local `.env.local`:
   - `DATA_DRIVER=postgres` — without it the seed refuses to run.
   - `DATABASE_URL` — the same transaction pooler string you used for Production.
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — the same values as Production. The
     seed does not sign anyone in, but the data layer reads them on the way up and throws if either is missing.

## Smoke test

Check these items on the production site after the last step.

1. Sign in with an email link. You should land on the dashboard.

   **Expect trouble here until PF-017 is done, and do not treat it as a failed deploy.** Supabase's built-in email
   only reaches the Supabase project's own team, a few messages an hour, so no other address will receive
   anything. The link also carries a `code` that only works in the browser that asked for it, so opening the mail
   on your phone fails. Both are fixed by PF-017 (custom SMTP and a `token_hash` template); the callback already
   accepts `token_hash`. If sign-in is the only check that fails, go on to PF-017 rather than rolling back.
2. The dashboard lists the demo project.
3. Open each project page. Each page should load without an error.
4. Create a new project, add a source, and run discovery. The progress view should finish without an error.
5. Open Vercel → your project → Logs. The logs should show no errors.
6. Open the browser's developer tools, go to the Network tab, and reload the page. The response should include a
   `Content-Security-Policy` header with a nonce.

If a check other than sign-in fails, read the rollback section below before you touch anything — on this first
deploy, rolling back is the wrong move. Tell the developer which check failed.

## Rollback

**On this first production deploy, fix forward instead of rolling back.** There is no good deployment to go back
to: the only earlier production build is the one from before this work, and it answers 500 on `/dashboard`
because it has no Supabase variables. Promoting it would replace one broken site with another.

So if a check fails:

1. Check the production variables against the list above — a missing or misspelled one is by far the likeliest
   cause, and `DATA_DRIVER` or either `NEXT_PUBLIC_SUPABASE_*` being absent produces exactly this 500.
2. Read Vercel → your project → Logs for the first error, and fix it on a branch.
3. Redeploy from `main`.

Once a deploy has succeeded, an earlier good deployment exists and the normal rollback applies: Vercel → your
project → Deployments, find that deployment, open its menu and promote it to production. Know before you do that
Vercel's Instant Rollback **stops production domains being assigned automatically**, so later pushes to `main`
will build but will not go live until you turn it off again.

## Known limit

Production currently uses the same Supabase project as development, in the Mumbai region. Development test projects
are visible to the same accounts. Before you add real customer data, create a separate Supabase project and rotate
the keys (PF-078).
