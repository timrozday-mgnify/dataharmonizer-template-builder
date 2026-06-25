"""Avoid stale HTML keeping references to old Vite asset hashes."""

from __future__ import annotations


class NoStoreHtmlMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path == "/" or request.path.endswith(".html"):
            response["Cache-Control"] = "no-store"
        return response
