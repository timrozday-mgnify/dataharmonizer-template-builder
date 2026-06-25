"""Django settings: HTTP layer only (views.py, urls.py).

No database, auth, or sessions are used — this app holds no persisted or
multi-user state (see ``dataharmonizer_template_builder/sessions.py``'s
in-process ``SessionStore`` and ``views.py``'s in-process ``_jobs`` dict).
``DATABASES`` below is an unused SQLite placeholder so ``manage.py`` runs;
no app ever touches it.
"""

from __future__ import annotations

import os

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dhtb-insecure-dev-key")

DEBUG = (os.environ.get("DJANGO_DEBUG", "") or "").strip().lower() in ("1", "true", "yes")

ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = ["corsheaders"]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "dataharmonizer_template_builder.middleware.NoStoreHtmlMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

# Deliberately wide open: this app is meant to be embedded cross-origin
# (iframe + postMessage) by host apps such as mimicc-ena-submission-assistant,
# and has no cookie-based auth for CSRF to protect.
CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}

USE_TZ = True
