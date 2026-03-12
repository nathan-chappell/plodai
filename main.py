import uvicorn


if __name__ == "__main__":
    uvicorn.run(
        "backend.app.main:app",
        # NOTE: hardwired to deployment strategy in railway.
        host="0.0.0.0",
        port=8000,
    )
