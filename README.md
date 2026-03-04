# Torgplan

## Gratis ukentlig backup (GitHub Actions)

Denne repoen er satt opp med en GitHub Action som tar en **ukentlig pg_dump-backup** av Supabase-databasen og lagrer den i `backups/`.

### Slik aktiverer du
1. Opprett et GitHub-repo og push prosjektet dit.
2. I GitHub: **Settings → Secrets and variables → Actions → New repository secret**
3. Legg inn secret:
   - `DATABASE_URL` = samme PostgreSQL-URI som du bruker i Render (Supabase connection string)

### Kjøring
- Automatisk: hver mandag kl. 03:00 UTC
- Manuelt: Actions → "Weekly Supabase Backup" → Run workflow

### Resultat
Backup-filer havner i `backups/` som `supabase_YYYY-MM-DDTHHMMSSZ.sql.gz`.

### Opprydding (gratis)
Workflowen sletter automatisk gamle backup-filer og **beholder de siste 90 dagene**.
Hvis du vil endre dette, åpne `.github/workflows/supabase-backup.yml` og juster `RETENTION_DAYS`.

> Tips: Dette er en ekstra sikkerhet for 1-årskravet. Supabase lagrer data vedvarende, men gratis backup i GitHub gir deg en “livbøye” om noe uventet skulle skje.

## Render (miljøvariabler)
I Render → Service → Environment:
- `APP_PASSWORD` = `233`
- `SECRET_KEY` = tilfeldig lang streng
- `SUPABASE_URL` = Supabase Project URL (finnes i Supabase: Project Settings → API)
- `SUPABASE_SERVICE_ROLE_KEY` = Service role key (finnes i Supabase: Project Settings → API Keys)

> Vi bruker Supabase HTTPS API (port 443). Det fungerer stabilt fra Render selv når direkte Postgres-tilkobling (5432) ikke gjør det.

## Supabase: lag tabellen `kv`
Kjør dette én gang i Supabase → SQL Editor:

```sql
create table if not exists kv (
  k text primary key,
  v jsonb not null,
  updated_at timestamptz not null default now()
);
```
