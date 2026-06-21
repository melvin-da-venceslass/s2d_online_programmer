try:
    from .program_editor import app
except ImportError:
    from program_editor import app

__all__ = ["app"]

if __name__ == "__main__":
    import uvicorn

    try:
        from .config import settings
    except ImportError:
        from config import settings

    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
