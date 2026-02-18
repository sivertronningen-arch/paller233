# Butikk-kart (demo)

Funksjoner:
- Butikkplan som bakgrunn (static/plan.png)
- Klikkbare paller (rektangler)
- Søk på artikkelnummer -> markerer pall(er)
- Redigering av artikkelnummer per pall
- Opprette nye paller ved å tegne rektangel på kartet
- Passordbeskyttelse (innlogging)

## Passord
Standard passord er: **233**

På hosting bør du sette miljøvariabel:
- `APP_PASSWORD` (f.eks. 233)
- `SECRET_KEY` (en lang tilfeldig streng)

## Kjør lokalt (PC i butikken)
1) Installer Python 3.10+
2) Installer avhengigheter:
   ```bash
   pip install -r requirements.txt
   ```
3) Start:
   ```bash
   python app.py
   ```
4) Åpne:
- Samme PC: http://localhost:5000
- Andre PC-er i samme nett: http://<IP-ADRESSEN-TIL-DENNE-PCEN>:5000

## Kjør i skyen (anbefalt: Postgres)
Appen støtter to databaser:
- SQLite (standard): `data.sqlite3` (bra lokalt)
- Postgres (anbefalt i sky): sett `DATABASE_URL`

### Start-kommando for produksjon
På hosting (f.eks. Render):
```bash
gunicorn app:app
```

## Miljøvariabler (oppsummering)
- `APP_PASSWORD` = passord (default 233)
- `SECRET_KEY` = hemmelig nøkkel for innlogging (må være lang og tilfeldig i produksjon)
- `DATABASE_URL` = Postgres-URL (hvis du vil ha vedvarende data i skyen)
- `PORT` = settes ofte av hosting automatisk (Render gjør det)

