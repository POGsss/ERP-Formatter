from contextlib import asynccontextmanager
from os import getenv
from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from database import init_db
from routers import router as api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="ERP Formatter", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

root_router = APIRouter()


@root_router.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "erp-formatter"}


app.include_router(root_router)
app.include_router(api_router, prefix="/api")

frontend_dist_dir = getenv("FRONTEND_DIST_DIR")
if frontend_dist_dir and Path(frontend_dist_dir).is_dir():
    app.mount(
        "/",
        StaticFiles(directory=frontend_dist_dir, html=True),
        name="frontend",
    )
