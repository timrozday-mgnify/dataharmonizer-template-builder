from __future__ import annotations

from django.urls import path, re_path

from dataharmonizer_template_builder import views

urlpatterns = [
    path("api/health", views.health),
    path("api/frontend-config", views.frontend_config),
    path("api/schemas/import", views.import_schema),
    path("api/schemas/import-file", views.import_schema_file),
    path("api/integrations/sessions", views.integration_create_session),
    path("api/integrations/sessions/<str:session_id>/tables", views.integration_update_tables),
    path("api/integrations/sessions/<str:session_id>/yaml", views.integration_session_yaml),
    path("api/sessions/<str:session_id>", views.get_session),
    path("api/sessions/<str:session_id>/tables", views.update_tables),
    path("api/sessions/<str:session_id>/generate", views.generate),
    path("api/sessions/<str:session_id>/export", views.export_schema),
    path("api/dh-builder/build", views.dh_builder_build),
    path("api/dh-builder/build/status/<str:job_id>", views.dh_builder_build_status),
    path("assets/<str:asset_name>", views.frontend_asset),
    path("dh-preview/", views.serve_dh_preview),
    re_path(r"^dh-preview/(?P<path>.*)$", views.serve_dh_preview),
    path("", views.serve_frontend),
    re_path(r"^(?P<path>.*)$", views.serve_frontend),
]
