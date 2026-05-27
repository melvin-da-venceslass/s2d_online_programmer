from program_editor import app

__all__ = ["app"]

if __name__ == "__main__":
    import uvicorn

    from config import settings

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
