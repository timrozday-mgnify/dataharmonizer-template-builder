"""Command-line entrypoint for the backend server."""

from __future__ import annotations

import uvicorn


def main() -> None:
    """Run the FastAPI development server."""
    uvicorn.run(
        "dataharmonizer_template_builder.api:app",
        host="127.0.0.1",
        port=8765,
        reload=True,
    )


if __name__ == "__main__":
    main()
