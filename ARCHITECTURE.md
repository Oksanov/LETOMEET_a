# LETOMEET application structure

`main.py` remains the application entry point and owns Flask configuration, SQLAlchemy initialization,
shared helpers, request middleware, and error handlers.

`extensions.py` creates the shared SQLAlchemy extension. `main.py` configures Flask and calls
`db.init_app(app)`. `models.py` contains the SQLAlchemy model classes and imports `db` from
`extensions.py`.

`routes/` contains endpoint modules. Each module registers its routes on the shared Flask `app` after
the application and models have been initialized:

- `pages.py` — HTML pages and favicon
- `events.py` — event listing, details, comments, create/edit/delete, QR
- `registrations.py` — joining/leaving events and personal registrations
- `auth.py` — registration, login, logout, current session
- `profile.py` — profile updates and personal events
- `admin.py` — administration, moderation, statistics and users
- `media.py` — media delivery, image uploads and scheduled maintenance endpoint

Run locally using the same command as before:

```bash
python main.py
```

The existing `main:app` WSGI import target is preserved. No database migration is required for this
structural refactor.
