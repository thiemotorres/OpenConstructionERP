"""Serve frontend static files from the installed package or dev build.

When running via `openestimate serve` or with SERVE_FRONTEND=true,
the FastAPI app serves the pre-built React frontend directly — no Nginx needed.

Frontend is found in two locations (checked in order):
1. app/_frontend_dist/ — bundled inside the Python wheel (pip install)
2. ../frontend/dist/   — development mode (repo checkout)
"""

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.requests import Request
from starlette.responses import FileResponse, Response

logger = logging.getLogger(__name__)


def get_frontend_dir() -> Path:
    """Find the bundled frontend dist directory.

    Returns:
        Path to the directory containing index.html and assets/.

    Raises:
        FileNotFoundError: If no frontend build is found.
    """
    # Option 1: installed as package (pip install openestimate)
    pkg_dir = Path(__file__).parent / "_frontend_dist"
    if pkg_dir.is_dir() and (pkg_dir / "index.html").exists():
        return pkg_dir

    # Option 2: development — frontend/dist relative to repo root
    repo_root = Path(__file__).resolve().parent.parent.parent  # backend/app/../../
    dev_dist = repo_root / "frontend" / "dist"
    if dev_dist.is_dir() and (dev_dist / "index.html").exists():
        return dev_dist

    raise FileNotFoundError(
        "Frontend dist not found. Run 'npm run build' in frontend/ or install the openestimate wheel."
    )


def mount_frontend(app: FastAPI) -> None:
    """Mount frontend static files on the FastAPI app.

    Serves:
    - /assets/* — hashed JS/CSS bundles (long cache)
    - /favicon.svg, /logo.svg — static resources
    - /{path:path} catch-all (added last) — index.html for SPA routing

    Must be called AFTER all API routers and module routers are registered,
    so the catch-all route is placed last in the route list and only fires
    for paths that genuinely have no matching API route.

    NOTE: Do NOT use @app.exception_handler(404) for the SPA fallback here.
    Starlette's ExceptionMiddleware is built once (on the first ASGI call,
    i.e. lifespan startup) and snapshots exception_handlers at that point.
    Any handler registered after that moment — such as one added during the
    startup event — is silently ignored.  A catch-all route lives in
    app.routes, which is checked dynamically on every request, so it works
    correctly when added during startup.
    """
    try:
        frontend_dir = get_frontend_dir()
    except FileNotFoundError:
        logger.warning("Frontend dist not found — serving API only")
        return

    logger.info("Serving frontend from %s", frontend_dir)

    # Serve hashed assets (JS, CSS)
    assets_dir = frontend_dir / "assets"
    if assets_dir.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=str(assets_dir)),
            name="frontend-assets",
        )

    # Serve individual static files at the root (favicon, logo, etc.)
    index_path = frontend_dir / "index.html"

    for static_name in ("favicon.svg", "logo.svg"):
        static_path = frontend_dir / static_name
        if static_path.exists():
            def _make_static_handler(fpath: Path):  # noqa: ANN202
                async def _handler() -> Response:
                    return FileResponse(str(fpath))
                return _handler

            app.get(f"/{static_name}", include_in_schema=False)(_make_static_handler(static_path))

    # Collect root-level static file extensions for direct serving
    _root_static_extensions = {".ico", ".png", ".svg", ".webmanifest", ".json", ".txt", ".xml"}

    # ── SPA catch-all route (must be registered last) ───────────────────
    # Uses a wildcard route instead of exception_handler(404) because
    # exception handlers are frozen into ExceptionMiddleware at startup
    # and cannot be added afterwards.
    from fastapi.responses import JSONResponse

    async def _spa_catchall(request: Request, path: str = "") -> Response:
        """Serve index.html for frontend routes; JSON 404 for missing API paths."""
        full_path = request.url.path

        # API paths with no matching route → return JSON 404
        if full_path.startswith("/api"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})

        # Root-level static files (robots.txt, manifest.json, …) served directly
        if path:
            candidate = frontend_dir / path
            if candidate.is_file() and candidate.suffix in _root_static_extensions:
                return FileResponse(str(candidate))

        # All other paths → SPA index.html (client-side routing)
        return FileResponse(str(index_path))

    app.add_api_route(
        "/{path:path}",
        _spa_catchall,
        methods=["GET"],
        include_in_schema=False,
    )
